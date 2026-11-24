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
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.LazyPoster
import ch.schmidtbit.shelfmark.data.server.OkHttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.repo.SocialRepository
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.work.Notifier
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Locale
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** Hand-rolled dependency container. One instance lives in [ShelfmarkApp]. */
@OptIn(FlowPreview::class)
class AppContainer(
    context: Context,
    val database: AppDatabase = AppDatabase.create(context),
    lookupOverride: BookLookup? = null,
    settingsStore: DataStore<Preferences>? = null,
    private val coverProbeOverride: ImageProbe? = null,
    /** The server this build talks to. Tests pass their own, a real build takes it from the build settings. */
    serverConfig: ServerConfig? = ServerConfig.of(BuildConfig.SERVER_URL, BuildConfig.SERVER_KEY),
    serverPoster: HttpPoster? = null,
    /** Where the website is published, if the build knows. */
    websiteUrl: String = BuildConfig.WEBSITE_URL,
) {
    private val appContext = context.applicationContext

    /** The address of the website without a slash at the end, or empty. */
    val website: String = websiteUrl.trim().trimEnd('/').takeIf { it.startsWith("http") }.orEmpty()

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
                    // Without a key of its own Google answers some of the time. The other catalogues cover the rest.
                    GoogleBooksApi(fetcher) { "" },
                    ITunesApi(fetcher),
                    LobidApi(fetcher),
                    SruCatalogue.dnb(fetcher),
                    SruCatalogue.k10plus(fetcher),
                    SruCatalogue.swisscovery(fetcher),
                ),
            )
        }
    }

    /** How the server is reached: with every kind of call, a picture as well as a question. */
    val poster: HttpPoster = serverPoster ?: LazyPoster { OkHttpPoster(httpClient) }

    /** Where a library is put aside before the reader's choice replaces it as a whole. */
    val replacedDir = java.io.File(appContext.filesDir, "replaced")

    /** The account: one library on every device and on the website, and friends. Does nothing until somebody signs in. */
    val server = ServerSync(
        db = database,
        settings = settings,
        social = social,
        backup = backup,
        covers = covers,
        config = serverConfig,
        poster = poster,
        baseFile = java.io.File(appContext.filesDir, "vault_base.json"),
        replacedDir = replacedDir,
        website = website,
        // Whoever looked at the server (the screen, a tap, the check in the background),
        // what a friend did to a loan is said in one place.
        announce = { Notifier.announce(appContext, it) },
    )

    /** What was last asked of the user about an account and a device that both hold books. */
    val choice = MutableStateFlow<SyncResult.Choose?>(null)

    val coverFinder: CoverFinder by lazy { CoverFinder(lookup, coverProbeOverride ?: OkHttpImageProbe(httpClient)) }

    /**
     * Scope for writes started from the UI. It outlives any screen, so a save is not
     * cut short when the user navigates away right after tapping the button.
     */
    val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            // Work that goes on behind the screens has nobody to report to. What it trips over
            // is written down, and the app stays open with everything the reader was doing.
            CoroutineExceptionHandler { _, problem -> runCatching { android.util.Log.e("Shelfmark", "Work in the background failed", problem) } },
    )

    fun launch(block: suspend CoroutineScope.() -> Unit): Job = scope.launch(block = block)

    // How many jobs are running that change many books in a row, and a sign for when one of them ends.
    private val bulkJobs = MutableStateFlow(0)
    private val bulkEnded = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /**
     * Runs a job that changes many books one after the other (an import, the search for
     * covers). The library goes to the account once when it is through, not after every
     * book: each time would send the whole library again.
     */
    suspend fun <T> bulk(job: suspend () -> T): T {
        bulkJobs.update { it + 1 }
        try {
            return job()
        } finally {
            bulkJobs.update { it - 1 }
            bulkEnded.tryEmit(Unit)
        }
    }

    init {
        // A change to the library goes to the account a few seconds after the last one, so that
        // the website and other devices see it without anybody pressing a button.
        if (serverConfig != null) {
            scope.launch {
                merge(
                    database.invalidationTracker.createFlow("books", "shelves", "book_shelf", "quotes", "sessions", "notes", "goals", "purchases", "ornaments", emitInitialState = false).map { },
                    settings.settings.map { it.vaultPrefs() }.distinctUntilChanged().drop(1).map { },
                    bulkEnded,
                ).debounce(AUTO_SYNC_MS).collect {
                    // One sync that goes wrong must not be the last one that is tried.
                    try {
                        if (bulkJobs.value == 0 && settings.current().signedIn) remember(server.sync())
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        android.util.Log.w("Shelfmark", "The sync after a change failed", e)
                    }
                }
            }
        }
    }

    /** Keeps a question the sync could not answer by itself, for the screen to ask. */
    fun remember(result: SyncResult): SyncResult {
        if (result is SyncResult.Choose) choice.value = result
        return result
    }

    private var lastRefresh = 0L

    /**
     * Looks for news from friends and does the daily check-in. It holds back when it ran
     * within the last minute, unless [force] is set.
     */
    suspend fun refreshFriends(force: Boolean = false): SyncResult {
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && lastRefresh != 0L && now - lastRefresh < WATCH_MS) return SyncResult.Off
        lastRefresh = now
        return try {
            remember(server.dailyCheck())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The look once a minute goes on, whatever one of them ran into.
            SyncResult.Failed(ServerSync.UNEXPECTED)
        }
    }

    /**
     * Asks the server for news once a minute, for as long as the caller lets it run. A loan
     * takes two people tapping in turn, and neither should have to leave the app and come
     * back to see that the other one did. The screen starts this when the app comes to the
     * front and cancels it when the app leaves: in the background nothing is asked, that is
     * what the daily check is for.
     */
    suspend fun watchServer() {
        if (!server.available) return
        while (true) {
            // Coming to the front again and again (a rotation, a glance at another app) does not ask more often.
            val wait = lastRefresh + WATCH_MS - android.os.SystemClock.elapsedRealtime()
            if (lastRefresh != 0L && wait > 0) delay(wait)
            refreshFriends(force = true)
        }
    }

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
        // Taken at once, so that a second tap does not start a second search.
        coverJob.value = 0 to 0
        launch {
            try {
                bulk {
                    val books = library.booksWithoutCover()
                    coverJob.value = 0 to books.size
                    books.forEachIndexed { index, book ->
                        val url = runCatching { coverFinder.best(book.title, book.authors, book.isbn, Locale.getDefault().language.ifBlank { "en" }) }.getOrNull()
                        if (url != null) library.modify(book.id) { if (it.coverUrl.isBlank() && it.coverPath.isBlank()) it.copy(coverUrl = url) else it }
                        coverJob.value = (index + 1) to books.size
                    }
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

    companion object {
        private const val WATCH_MS = 60_000L

        /** How long after the last change the library goes to the account. */
        const val AUTO_SYNC_MS = 4_000L
    }
}
