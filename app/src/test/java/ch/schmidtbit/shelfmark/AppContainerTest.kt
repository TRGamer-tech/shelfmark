package ch.schmidtbit.shelfmark

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.BookSource
import ch.schmidtbit.shelfmark.data.remote.ImageProbe
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** What the app's container does by itself, behind the screens: when it syncs, and how it reaches the server. */
@RunWith(RobolectricTestRunner::class)
class AppContainerTest {
    @get:Rule val folder = TemporaryFolder()
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val server = FakeServer()
    private var made: AppContainer? = null

    @After fun tearDown() {
        // Nothing of the app may run once its database is gone.
        made?.let { it.scope.cancel(); it.database.close() }
        scope.cancel()
    }

    private fun container(lookup: BookLookup? = null, poster: HttpPoster? = server) = AppContainer(
        context = context,
        database = AppDatabase.inMemory(context),
        lookupOverride = lookup,
        settingsStore = PreferenceDataStoreFactory.create(scope = scope) { File(folder.root, "container.preferences_pb") },
        coverProbeOverride = ImageProbe { false },
        serverConfig = ServerConfig("https://example.supabase.co", "sb_publishable_test"),
        serverPoster = poster,
    ).also { made = it }

    /** Has the app do [block] and waits for it while the main thread keeps turning (see the same helper in AppFlowTest). */
    private fun <T> appDoes(block: suspend () -> T): T {
        val work = scope.async { block() }
        val giveUp = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        while (!work.isCompleted) {
            ShadowLooper.idleMainLooper()
            Thread.sleep(1)
            check(System.nanoTime() < giveUp) { "The app did not get done with what it was asked to do." }
        }
        return runBlocking { work.await() }
    }

    /**
     * Lets [ms] of the app's time pass, or less when [until] says so. The app counts its
     * seconds on the main thread, whose clock stands still in a test until it is moved.
     */
    private fun pass(ms: Long, until: () -> Boolean = { false }) {
        var left = ms
        while (left > 0 && !until()) {
            ShadowLooper.idleMainLooper(100, TimeUnit.MILLISECONDS)
            Thread.sleep(2)
            left -= 100
        }
    }

    private fun pushes() = server.calls["shelfmark_vault_push"] ?: 0

    @Test fun aJobOverManyBooksSyncsOnceWhenItIsThrough() {
        // A catalogue that takes its time: longer for one book than the app waits after a change before it syncs.
        val slow = object : BookSource {
            override val name = "slow"
            override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> {
                delay(AppContainer.AUTO_SYNC_MS + 2_000)
                return listOf(RemoteBook(title = query, coverUrl = "https://covers.example/" + query.lowercase() + ".jpg"))
            }
            override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? = null
        }
        val app = container(lookup = BookLookup(listOf(slow)))
        appDoes {
            listOf("Emma", "Dune", "Momo").forEach { app.library.addBook(Book(title = it)) }
            assertTrue(app.server.signUp("anna@shelfmark.test", "geheim-anna") is SyncResult.Done)
        }
        // Whatever adding the books set off has run its course.
        pass(3 * AppContainer.AUTO_SYNC_MS)
        pass(5_000) { !app.server.status.value.running }
        val before = pushes()

        app.findMissingCovers()
        pass(1_000)
        assertTrue(app.coverJob.value != null)
        pass(120_000) { app.coverJob.value == null }
        assertEquals(null, app.coverJob.value)
        assertEquals(setOf("https://covers.example/emma.jpg", "https://covers.example/dune.jpg", "https://covers.example/momo.jpg"), appDoes { app.library.allBooks() }.map { it.coverUrl }.toSet())
        // Three books were changed, seconds apart, and the library was not sent after any of them.
        assertEquals(before, pushes())

        // It is sent once, a moment after the job is through.
        val giveUp = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (pushes() == before && System.nanoTime() < giveUp) pass(500)
        pass(3 * AppContainer.AUTO_SYNC_MS)
        pass(5_000) { !app.server.status.value.running }
        assertEquals(before + 1, pushes())
        assertEquals(1L + before, server.revisionOf("anna@shelfmark.test"))
    }

    @Test fun theAppsOwnPosterSendsPicturesAndNotOnlyQuestions() {
        val app = container(poster = null)
        // Nobody listens at this address. What counts is that the call is made at all: a poster that
        // only knows questions answers a picture with "not implemented" without sending anything.
        val outcome = appDoes { runCatching { app.poster.send("DELETE", "http://127.0.0.1:9/storage/v1/object/shelfmark-covers/me/photo.jpg", emptyMap(), null) } }
        assertTrue(outcome.toString(), outcome.exceptionOrNull() is IOException || outcome.getOrNull()?.let { it.code != 501 } == true)
    }
}
