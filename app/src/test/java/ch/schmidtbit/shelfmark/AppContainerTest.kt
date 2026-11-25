package ch.schmidtbit.shelfmark

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import ch.schmidtbit.shelfmark.data.cart.Cart
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.BookSource
import ch.schmidtbit.shelfmark.data.remote.ImageProbe
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.work.DailyCheckWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
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

    @Test fun shelvingTheCartIsOneJobAndTheAccountHearsOfItOnce() {
        val nothing = object : BookSource {
            override val name = "nothing"
            override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> = emptyList()
            override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? = null
        }
        val app = container(lookup = BookLookup(listOf(nothing)))
        val holiday = appDoes {
            assertTrue(app.server.signUp("ben@shelfmark.test", "geheim-ben") is SyncResult.Done)
            app.library.addBook(Book(title = "Momo", authors = "Michael Ende"))
            app.library.createShelf("Ferien")
        }
        appDoes {
            app.cart.change { cart ->
                cart.put(Book(title = "Emma", authors = "Jane Austen")).put(Book(title = "Dune", authors = "Frank Herbert")).put(Book(title = "Momo", authors = "Michael Ende"))
                    .put(Book(title = "Faust", authors = "Goethe"))
                    .forAll { it.withList(holiday, true) }
                    .forOne(Cart.keyOf(Book(title = "Faust", authors = "Goethe"))) { it.withStatus(ReadingStatus.READ) }
            }
        }
        // Whatever the books and the list set off has run its course.
        pass(3 * AppContainer.AUTO_SYNC_MS)
        pass(5_000) { !app.server.status.value.running }
        val before = pushes()

        // Momo is on the shelf already and stays there once.
        assertEquals(3, appDoes { app.shelveCart() })
        assertEquals(0, app.cart.cart.value.count)
        val books = appDoes { app.library.allBooks() }
        assertEquals(listOf("Dune", "Emma", "Faust", "Momo"), books.map { it.title }.sorted())
        assertEquals(ReadingStatus.READ, books.single { it.title == "Faust" }.status)
        val onHoliday = appDoes { app.library.links.first() }.filter { it.shelfId == holiday }.map { it.bookId }.toSet()
        assertEquals(books.filter { it.title != "Momo" }.map { it.id }.toSet(), onHoliday)

        // The three books reach the account with one sync, and nothing comes after it.
        val giveUp = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (pushes() == before && System.nanoTime() < giveUp) pass(500)
        pass(3 * AppContainer.AUTO_SYNC_MS)
        pass(5_000) { !app.server.status.value.running }
        assertEquals(before + 1, pushes())
    }

    @Test fun theLookInTheBackgroundComesEveryQuarterOfAnHourInPlaceOfTheOldOne() {
        // What is asked of Android: every fifteen minutes, with a network, and nothing that wakes the phone or jumps a queue.
        val spec = DailyCheckWorker.request().workSpec
        assertEquals(TimeUnit.MINUTES.toMillis(15), spec.intervalDuration)
        assertEquals(NetworkType.CONNECTED, spec.constraints.requiredNetworkType)
        assertTrue(!spec.expedited && !spec.constraints.requiresCharging() && !spec.constraints.requiresDeviceIdle())

        val work = try {
            WorkManager.getInstance(context)
        } catch (e: IllegalStateException) {
            WorkManager.initialize(context, Configuration.Builder().build())
            WorkManager.getInstance(context)
        }
        fun scheduled() = work.getWorkInfosForUniqueWork(DailyCheckWorker.NAME).get(20, TimeUnit.SECONDS).filter { !it.state.isFinished }
        // A phone that comes from an earlier version has the look scheduled twice a day.
        val old = PeriodicWorkRequestBuilder<DailyCheckWorker>(12, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        work.enqueueUniquePeriodicWork(DailyCheckWorker.NAME, ExistingPeriodicWorkPolicy.KEEP, old).result.get(20, TimeUnit.SECONDS)
        assertEquals(listOf(TimeUnit.HOURS.toMillis(12)), scheduled().map { it.periodicityInfo?.repeatIntervalMillis })

        // The app starts in its new version: the one look there is, is now the quarter-hourly one.
        DailyCheckWorker.schedule(context)
        work.getWorkInfosForUniqueWork(DailyCheckWorker.NAME).get(20, TimeUnit.SECONDS)
        val giveUp = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (scheduled().map { it.periodicityInfo?.repeatIntervalMillis } != listOf(TimeUnit.MINUTES.toMillis(15)) && System.nanoTime() < giveUp) Thread.sleep(20)
        assertEquals(listOf(TimeUnit.MINUTES.toMillis(15)), scheduled().map { it.periodicityInfo?.repeatIntervalMillis })
        try {
            // Starting the app again and again neither doubles it nor changes it.
            repeat(3) { DailyCheckWorker.schedule(context) }
            Thread.sleep(200)
            assertEquals(listOf(TimeUnit.MINUTES.toMillis(15)), scheduled().map { it.periodicityInfo?.repeatIntervalMillis })
        } finally {
            // Nothing stays scheduled for the tests that run after this one in the same process.
            work.cancelAllWork().result.get(20, TimeUnit.SECONDS)
            work.pruneWork().result.get(20, TimeUnit.SECONDS)
        }
    }

    @Test fun theAppsOwnPosterSendsPicturesAndNotOnlyQuestions() {
        val app = container(poster = null)
        // Nobody listens at this address. What counts is that the call is made at all: a poster that
        // only knows questions answers a picture with "not implemented" without sending anything.
        val outcome = appDoes { runCatching { app.poster.send("DELETE", "http://127.0.0.1:9/storage/v1/object/shelfmark-covers/me/photo.jpg", emptyMap(), null) } }
        assertTrue(outcome.toString(), outcome.exceptionOrNull() is IOException || outcome.getOrNull()?.let { it.code != 501 } == true)
    }
}
