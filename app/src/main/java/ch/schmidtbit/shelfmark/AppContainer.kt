package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.CoverFinder
import ch.schmidtbit.shelfmark.data.remote.ITunesApi
import ch.schmidtbit.shelfmark.data.remote.ImageProbe
import ch.schmidtbit.shelfmark.data.remote.LobidApi
import ch.schmidtbit.shelfmark.data.remote.OkHttpImageProbe
import ch.schmidtbit.shelfmark.data.remote.SruCatalogue
import ch.schmidtbit.shelfmark.data.remote.GoogleBooksApi
import ch.schmidtbit.shelfmark.data.remote.OkHttpFetcher
import ch.schmidtbit.shelfmark.data.remote.OpenLibraryApi
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.repo.BackupManager
import ch.schmidtbit.shelfmark.data.repo.CoverStore
import ch.schmidtbit.shelfmark.data.repo.LibraryRepository
import ch.schmidtbit.shelfmark.data.repo.ServerSync
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.OkHttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.repo.SocialRepository
import ch.schmidtbit.shelfmark.data.model.Book
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.util.Locale
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** Hand-rolled dependency container. One instance lives in [ShelfmarkApp]. */
class AppContainer(
    context: Context,
    val database: AppDatabase = AppDatabase.create(context),
    lookupOverride: BookLookup? = null,
    settingsStore: DataStore<Preferences>? = null,
    private val coverProbeOverride: ImageProbe? = null,
    /** The server this build talks to. Tests pass their own, a real build takes it from the build settings. */
    serverConfig: ServerConfig? = ServerConfig.of(BuildConfig.SERVER_URL, BuildConfig.SERVER_KEY),
    serverPoster: HttpPoster? = null,
) {
    private val appContext = context.applicationContext

    val settings = SettingsRepository(settingsStore ?: appContext.dataStore)
    val covers = CoverStore(appContext)
    val library = LibraryRepository(database, covers)
    val social = SocialRepository(database, settings)
    val backup = BackupManager(database, covers)

    val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    val lookup: BookLookup by lazy {
        lookupOverride ?: run {
            val fetcher = OkHttpFetcher(httpClient)
            // Ordered by how much a hit is worth: full records with covers first,
            // then the library catalogues that fill in what those do not know.
            BookLookup(
                listOf(
                    OpenLibraryApi(fetcher),
                    GoogleBooksApi(fetcher) { settings.current().googleBooksKey },
                    ITunesApi(fetcher),
                    LobidApi(fetcher),
                    SruCatalogue.dnb(fetcher),
                    SruCatalogue.k10plus(fetcher),
                    SruCatalogue.swisscovery(fetcher),
                ),
            )
        }
    }

    /** Friends through the server. Does nothing until a server is set up and the user connects. */
    val server = ServerSync(database, settings, social, serverConfig, serverPoster ?: HttpPoster { url, headers, body -> OkHttpPoster(httpClient).post(url, headers, body) })

    val coverFinder: CoverFinder by lazy { CoverFinder(lookup, coverProbeOverride ?: OkHttpImageProbe(httpClient)) }

    /**
     * Scope for writes started from the UI. It outlives any screen, so a save is not
     * cut short when the user navigates away right after tapping the button.
     */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun launch(block: suspend CoroutineScope.() -> Unit): Job = scope.launch(block = block)

    /** How far the search for missing covers has come: (books checked, books to check), or null when idle. */
    val coverJob = MutableStateFlow<Pair<Int, Int>?>(null)

    /** Looks for a cover for a freshly added book that came without one. Runs in the background. */
    fun findCoverLater(bookId: Long) {
        launch {
            val book = library.getBook(bookId) ?: return@launch
            if (book.coverUrl.isNotBlank() || book.coverPath.isNotBlank()) return@launch
            val url = runCatching { coverFinder.best(book.title, book.authors, book.isbn, Locale.getDefault().language.ifBlank { "en" }) }.getOrNull() ?: return@launch
            library.modify(bookId) { if (it.coverUrl.isBlank() && it.coverPath.isBlank()) it.copy(coverUrl = url) else it }
        }
    }

    /** Goes through every book without a cover, e.g. after importing a list from another app. */
    fun findMissingCovers() {
        if (coverJob.value != null) return
        launch {
            val books = library.booksWithoutCover()
            coverJob.value = 0 to books.size
            try {
                books.forEachIndexed { index, book ->
                    val url = runCatching { coverFinder.best(book.title, book.authors, book.isbn, Locale.getDefault().language.ifBlank { "en" }) }.getOrNull()
                    if (url != null) library.modify(book.id) { if (it.coverUrl.isBlank() && it.coverPath.isBlank()) it.copy(coverUrl = url) else it }
                    coverJob.value = (index + 1) to books.size
                }
            } finally {
                coverJob.value = null
            }
        }
    }

    /** Hands a book from the scanner or the search to the edit form without squeezing it through a route. */
    var draft: Book? = null

    /** Text shared into the app from elsewhere, waiting to become a quote. */
    var pendingQuoteText: String? = null

    /** The last catalogue hit the user looked at, kept for the preview sheet across rotation. */
    var lastPreview: RemoteBook? = null
}
