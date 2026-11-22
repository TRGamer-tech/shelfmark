package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.GoogleBooksApi
import ch.schmidtbit.shelfmark.data.remote.OkHttpFetcher
import ch.schmidtbit.shelfmark.data.remote.OpenLibraryApi
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.repo.BackupManager
import ch.schmidtbit.shelfmark.data.repo.CoverStore
import ch.schmidtbit.shelfmark.data.repo.LibraryRepository
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.repo.SocialRepository
import ch.schmidtbit.shelfmark.data.model.Book
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** Hand-rolled dependency container. One instance lives in [ShelfmarkApp]. */
class AppContainer(
    context: Context,
    val database: AppDatabase = AppDatabase.create(context),
    lookupOverride: BookLookup? = null,
    settingsStore: DataStore<Preferences>? = null,
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
            BookLookup(
                listOf(
                    OpenLibraryApi(fetcher),
                    GoogleBooksApi(fetcher) { settings.current().googleBooksKey },
                ),
            )
        }
    }

    /**
     * Scope for writes started from the UI. It outlives any screen, so a save is not
     * cut short when the user navigates away right after tapping the button.
     */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun launch(block: suspend CoroutineScope.() -> Unit): Job = scope.launch(block = block)

    /** Hands a book from the scanner or the search to the edit form without squeezing it through a route. */
    var draft: Book? = null

    /** Text shared into the app from elsewhere, waiting to become a quote. */
    var pendingQuoteText: String? = null

    /** The last catalogue hit the user looked at, kept for the preview sheet across rotation. */
    var lastPreview: RemoteBook? = null
}
