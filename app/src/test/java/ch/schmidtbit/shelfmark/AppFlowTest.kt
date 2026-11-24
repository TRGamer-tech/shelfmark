package ch.schmidtbit.shelfmark

import android.content.Intent
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.SampleBooks
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanAction
import ch.schmidtbit.shelfmark.data.model.LoanNews
import ch.schmidtbit.shelfmark.data.model.LoanNewsKind
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.withStatus
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.BookSource
import ch.schmidtbit.shelfmark.data.remote.ImageProbe
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.repo.SyncResult
import ch.schmidtbit.shelfmark.data.repo.TimerState
import ch.schmidtbit.shelfmark.data.server.ServerApi
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.work.Notifier
import ch.schmidtbit.shelfmark.data.repo.ImportResult
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.repo.SocialRepository
import ch.schmidtbit.shelfmark.data.repo.ViewMode
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.util.Dates
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.util.concurrent.TimeUnit

/** A catalogue that answers from memory, so the add-a-book flows can run without a network. */
private object FakeCatalogue : BookSource {
    override val name = "fake"
    val vorleser = RemoteBook(
        title = "Der Vorleser", authors = listOf("Bernhard Schlink"), isbn = "9783257229530", publisher = "Diogenes", year = "1997",
        pageCount = 206, description = "Sie ist reizbar, rätselhaft und viel älter als er.", format = BookFormat.PAPERBACK, language = "de",
    )
    val queries = mutableListOf<Pair<String, Boolean>>()

    override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> {
        queries += query to partial
        return if (query.contains("vorl", ignoreCase = true)) listOf(vorleser.copy(description = ""), RemoteBook("Vorlesungen", authors = listOf("G. W. F. Hegel"), year = "1837")) else emptyList()
    }

    override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? = vorleser.takeIf { it.isbn == isbn }
}

/**
 * Drives the real activity, in German, through the things a person does with the app.
 * Every step also writes a screenshot to build/outputs/roborazzi.
 */
@OptIn(ExperimentalRoborazziApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-w412dp-h915dp-420dpi")
class AppFlowTest {
    @get:Rule val compose = createEmptyComposeRule()
    @get:Rule val folder = TemporaryFolder()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var app: ShelfmarkApp
    private lateinit var container: AppContainer
    private var scenario: ActivityScenario<MainActivity>? = null

    private val fakeServer = FakeServer()
    private val serverConfig = ServerConfig("https://example.supabase.co", "sb_publishable_test")

    /** Rebuilds the app's container with a server to talk to. Call before [start]. */
    private fun useServer() {
        container.scope.cancel()
        container.database.close()
        container = AppContainer(
            context = app,
            database = AppDatabase.inMemory(app),
            lookupOverride = BookLookup(listOf(FakeCatalogue)),
            settingsStore = PreferenceDataStoreFactory.create(scope = scope) { File(folder.root, "online.preferences_pb") },
            coverProbeOverride = ImageProbe { false },
            serverConfig = serverConfig,
            serverPoster = fakeServer,
            // With a slash at the end, as somebody might type it into the build settings.
            websiteUrl = "https://shelfmark.example/",
        )
        app.container = container
        // Asking for the permission would open a system dialog that nobody answers here.
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    @Before fun setUp() {
        FakeCatalogue.queries.clear()
        // FileProvider remembers the cache directory of the first test in a static map,
        // while every Robolectric test gets a fresh data directory.
        androidx.core.content.FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }
            .let { (it.get(null) as MutableMap<*, *>).clear() }
        app = ApplicationProvider.getApplicationContext()
        container = AppContainer(
            context = app,
            database = AppDatabase.inMemory(app),
            lookupOverride = BookLookup(listOf(FakeCatalogue)),
            settingsStore = PreferenceDataStoreFactory.create(scope = scope) { File(folder.root, "ui.preferences_pb") },
            // No picture is ever "found" online, so adding a book does not start to download anything.
            coverProbeOverride = ImageProbe { false },
            // No server unless a test asks for one with useServer().
            serverConfig = null,
        )
        app.container = container
        // The clock is advanced by hand in waitFor, so an endless animation (a blinking
        // cursor, a progress spinner) cannot keep a test waiting for "idle" forever.
        compose.mainClock.autoAdvance = false
    }

    @After fun tearDown() {
        scenario?.close()
        // The app syncs a few seconds after a change. Nothing of it may run once the database is gone.
        container.scope.cancel()
        container.database.close()
        scope.cancel()
    }

    // ---- helpers ----

    private fun start(intent: Intent? = null, onboarded: Boolean = true, samples: Boolean = false) {
        runBlocking {
            if (onboarded) container.settings.setOnboarded()
            if (samples) SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
        }
        scenario = if (intent == null) ActivityScenario.launch(MainActivity::class.java) else ActivityScenario.launch(intent)
    }

    /** Lets background work and delayed tasks (debounced search, auto-save) finish. */
    private fun waitFor(timeoutMs: Long = 10_000, condition: () -> Boolean) {
        compose.waitUntil(timeoutMs) {
            ShadowLooper.idleMainLooper(100, TimeUnit.MILLISECONDS)
            compose.mainClock.advanceTimeBy(100)
            condition()
        }
    }

    private fun waitForText(text: String) = waitFor { compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() }
    private fun waitForTag(tag: String) = waitFor { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    /** Waits out a running screen transition: the screen that leaves still takes the taps until it is gone. */
    private fun pause() = repeat(3) {
        ShadowLooper.idleMainLooper(100, TimeUnit.MILLISECONDS)
        compose.mainClock.advanceTimeBy(100)
    }

    private fun tap(tag: String) { waitForTag(tag); pause(); compose.onAllNodesWithTag(tag).onFirst().performClick() }
    /** A step of a loan. Its button stays switched off until the step before it is through, and a tap on it then is lost. */
    private fun tapStep(tag: String) {
        waitFor { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().firstOrNull()?.let { SemanticsProperties.Disabled !in it.config } == true }
        tap(tag)
    }

    private fun tapText(text: String) { waitForText(text); pause(); compose.onAllNodesWithText(text, substring = true).onFirst().performClick() }
    private fun type(tag: String, text: String) { waitForTag(tag); compose.onNodeWithTag(tag).performTextInput(text) }
    private fun retype(tag: String, text: String) { waitForTag(tag); compose.onNodeWithTag(tag).performTextReplacement(text) }
    private fun back() { pause(); scenario!!.onActivity { it.onBackPressedDispatcher.onBackPressed() }; settle() }
    private fun scrollTo(tag: String) {
        waitForTag(tag)
        compose.mainClock.autoAdvance = true
        compose.onNodeWithTag(tag).performScrollTo()
        compose.mainClock.autoAdvance = false
    }

    /** Scrolls a list to one of its items. The item may only be about to appear, so this waits for it. */
    private fun scrollListTo(listTag: String, tag: String) {
        waitForTag(listTag)
        waitFor {
            compose.mainClock.autoAdvance = true
            val there = runCatching { compose.onNodeWithTag(listTag).performScrollToNode(hasTestTag(tag)) }.isSuccess
            compose.mainClock.autoAdvance = false
            there
        }
    }

    private fun openBook(title: String) {
        waitFor { compose.onAllNodesWithContentDescription(title).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithContentDescription(title).onFirst().performClick()
    }

    /** Lets a screen transition run to its end, so the screen left behind is gone. */
    private fun settle() {
        repeat(12) {
            ShadowLooper.idleMainLooper(100, TimeUnit.MILLISECONDS)
            compose.mainClock.advanceTimeBy(100)
        }
        compose.waitForIdle()
    }

    private fun shot(name: String) {
        settle()
        captureScreenRoboImage("build/outputs/roborazzi/$name.png")
    }

    private fun books(): List<Book> = runBlocking { container.library.allBooks() }
    private fun book(title: String): Book = books().first { it.title == title }

    /** The file the app last handed to the share sheet. */
    private fun lastSharedFile(): String {
        val dir = File(app.cacheDir, "shared")
        waitFor { dir.listFiles()?.isNotEmpty() == true }
        return dir.listFiles()!!.maxByOrNull { it.lastModified() }!!.readText()
    }

    private fun clearShared() = File(app.cacheDir, "shared").listFiles()?.forEach { it.delete() }

    private fun shareIntentOf(text: String) = Intent(app, MainActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)

    private fun hasTag(tag: String, unmerged: Boolean = false) = compose.onAllNodesWithTag(tag, useUnmergedTree = unmerged).fetchSemanticsNodes().isNotEmpty()
    private fun hasText(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()

    private fun loans(): List<Loan> = runBlocking { container.social.loans.first() }

    /** Has the app look at the server now, as the reader would with the button for it. Not waited for: the screens show when it is done. */
    private fun lookAtServer() { container.launch { container.refreshFriends(force = true) } }

    /** What stands in the notification shade: title and the line below it. */
    private fun notifications(): Set<Pair<String, String?>> =
        shadowOf(app.getSystemService(android.app.NotificationManager::class.java)).allNotifications
            .map { shadowOf(it).contentTitle.toString() to shadowOf(it).contentText?.toString() }.toSet()

    private fun clearNotifications() = app.getSystemService(android.app.NotificationManager::class.java).cancelAll()

    private fun latestToast(): String? = org.robolectric.shadows.ShadowToast.getTextOfLatestToast()

    /**
     * Has the app do [block] and waits for it while the main thread keeps turning. The app's
     * own coroutines live on the main thread and read the same settings as its sync does.
     * Blocking that thread until the sync is done ends, about once in twenty tries, with the
     * sync waiting for a coroutine that waits for the main thread.
     */
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
     * Gives the app an account of its own and makes [friends] its friends, before the screens
     * are up. Call after [useServer] and before [start]. Returns the id of the app's account.
     */
    private fun signUpWithFriends(name: String, vararg friends: Phone): String = appDoes {
        container.settings.setProfileName(name)
        assertTrue(container.server.signUp(myEmail, myPassword) is SyncResult.Done)
        val code = container.settings.current().friendCode
        friends.forEach { friend ->
            if (!friend.settings.current().signedIn) friend.join()
            friend.server.addFriend(code).getOrThrow()
        }
        assertTrue(container.server.sync() is SyncResult.Done)
        container.settings.current().userId
    }

    /** A book as it stands on the shelf of the app's account, seen from a friend's phone. */
    private fun Phone.onMyShelf(me: String, title: String) = runBlocking { social.friendBooks(me).first().first { it.title == title } }

    /** A friend's phone, reduced to its data layer. */
    private inner class Friend(name: String) {
        val db = AppDatabase.inMemory(app)
        val settings = SettingsRepository(PreferenceDataStoreFactory.create(scope = scope) { File(folder.root, "$name.preferences_pb") })
        val social = SocialRepository(db, settings)
        init { runBlocking { settings.setProfileName(name) } }
    }

    // ---- tests ----

    @Test fun firstStartLeadsToAnEmptyShelf() {
        start(onboarded = false)
        waitForTag("onboarding")
        shot("01_onboarding_welcome")
        tap("onboardingNext")
        waitForText("Wie soll es aussehen?")
        shot("02_onboarding_theme")
        tap("onboardingNext")
        tap("startEmpty")
        waitForText("Dein Regal ist noch leer")
        shot("03_empty_shelf")
        assertTrue(runBlocking { container.settings.current().onboarded })
    }

    @Test fun addABookByHandAndFillInEverything() {
        start()
        tap("addBook")
        shot("10_add_sheet")
        tap("addManual")
        type("fieldTitle", "Die Wand")
        type("fieldAuthors", "Marlen Haushofer")
        tap("format_HARDCOVER")
        scrollTo("fieldPages")
        type("fieldPages", "288")
        scrollTo("fieldDescription")
        type("fieldDescription", "Eine Frau, allein hinter einer unsichtbaren Wand.")
        shot("11_manual_entry")
        tap("saveBook")

        // The new book opens straight away.
        waitForTag("bookOverview")
        waitForText("Die Wand")
        var saved = book("Die Wand")
        assertEquals("Marlen Haushofer", saved.authors)
        assertEquals(288, saved.pageCount)
        assertEquals(BookFormat.HARDCOVER, saved.format)
        assertEquals("Eine Frau, allein hinter einer unsichtbaren Wand.", saved.description)
        assertEquals(Ownership.OWNED, saved.ownership)

        // List, stars, spice.
        tap("status_READ")
        tap("star4")
        tap("spice3")
        waitFor { book("Die Wand").let { it.status == ReadingStatus.READ && it.rating == 4f && it.spice == 3 } }
        saved = book("Die Wand")
        assertEquals(Dates.today(), saved.finishedOn)
        tap("star4")
        waitFor { book("Die Wand").rating == 3.5f }

        // Review text saves itself.
        scrollListTo("bookOverview", "review")
        type("review", "Still und stark.")
        waitFor { book("Die Wand").review == "Still und stark." }
        shot("12_book_rated")

        // Ownership: borrowed from someone. The offer to take the move to "read" back lies over
        // the bottom of the page for a few seconds, and a tap there would land on it.
        waitFor { !hasText("Rückgängig") }
        scrollListTo("bookOverview", "own_BORROWED")
        tap("own_BORROWED")
        scrollListTo("bookOverview", "borrowedFrom")
        type("borrowedFrom", "Clara")
        waitFor { book("Die Wand").let { it.ownership == Ownership.BORROWED && it.borrowedFrom == "Clara" } }
        assertTrue(!book("Die Wand").availableToLend)
        shot("13_book_ownership")
    }

    @Test fun searchSuggestsWhileTypingAndAddsTheBook() {
        start()
        tap("addBook")
        tap("addSearch")
        type("searchField", "der vorl")
        waitForText("Vorschläge")
        waitForText("Der Vorleser")
        // The half-typed word was sent as a suggestion query.
        assertEquals("der vorl" to true, FakeCatalogue.queries.last())
        shot("20_search_suggestions")

        tapText("Der Vorleser")
        waitForTag("previewSheet")
        // The blurb is fetched in the background once the preview is open.
        waitForText("Sie ist reizbar")
        shot("21_search_preview")
        tap("pick_WISHLIST")
        tap("confirmAdd")

        waitForTag("bookOverview")
        val added = book("Der Vorleser")
        assertEquals("9783257229530", added.isbn)
        assertEquals(206, added.pageCount)
        assertEquals(BookFormat.PAPERBACK, added.format)
        assertEquals(ReadingStatus.WISHLIST, added.status)
        assertEquals(Ownership.NOT_OWNED, added.ownership)
        assertTrue(added.description.startsWith("Sie ist reizbar"))
    }

    @Test fun anOldBookWithoutCodeCanBeTypedInFromTheSearch() {
        start()
        tap("addBook")
        tap("addSearch")
        type("searchField", "Ein vergessenes Buch von 1890")
        waitForText("Nichts gefunden")
        tap("manualEntry")
        // The title carries over into the form.
        waitForText("Ein vergessenes Buch von 1890")
        tap("saveBook")
        waitForTag("bookOverview")
        assertNotNull(books().firstOrNull { it.title == "Ein vergessenes Buch von 1890" })
    }

    @Test fun typedIsbnOnTheScanScreenFindsTheBook() {
        start()
        tap("addBook")
        tap("addScan")
        shot("30_scan_screen")
        type("isbnField", "978-3-257-22953-0")
        tap("isbnLookup")
        waitForTag("previewSheet")
        waitForText("Der Vorleser")
        shot("31_scan_result")
        tap("confirmAdd")
        waitForTag("scanAdded")
        assertEquals("9783257229530", book("Der Vorleser").isbn)

        // Scanning the same code again recognises the book instead of adding it twice.
        type("isbnField", "9783257229530")
        tap("isbnLookup")
        waitForText("Bereits in deiner Bibliothek")
        assertEquals(1, books().size)
    }

    @Test fun shelfCanBeShownAsCoversSpinesOrList() {
        start(samples = true)
        waitForTag("coverShelf")
        shot("40_shelf_covers")
        runBlocking { container.settings.setViewMode(ViewMode.SPINES) }
        waitForTag("spineShelf")
        shot("41_shelf_spines")
        runBlocking { container.settings.setViewMode(ViewMode.LIST) }
        waitForTag("bookList")
        shot("42_shelf_list")
        tap("tabLists")
        waitForText("Standardlisten")
        shot("43_lists")
        // A standard list opens on the shelf with only its books.
        tap("list_WISHLIST")
        waitForTag("bookList")
        waitForText("2 Bücher")
        waitForText("Jane Eyre")
        settle()
        assertTrue(compose.onAllNodesWithText("Dracula").fetchSemanticsNodes().isEmpty())
    }

    // Dialogs with text fields never report "idle" when Robolectric emulates a phone sized
    // screen (a bare Compose dialog shows the same), so these flows run at its default size.
    @Config(sdk = [35], qualifiers = "de")
    @Test fun ownListsCanBeCreatedAndFilled() {
        start(samples = true)
        tap("tabLists")
        waitForText("Standardlisten")
        scrollListTo("lists", "newList")
        tap("newList")
        type("nameField", "Ferienlektüre")
        tapText("Speichern")
        waitFor { runBlocking { container.library.shelves.first() }.size == 1 }
        val shelf = runBlocking { container.library.shelves.first().single() }
        assertEquals("Ferienlektüre", shelf.name)
        runBlocking { container.library.setOnShelf(book("Dracula").id, shelf.id, true) }

        // Opening the list shows only its books on the shelf.
        scrollListTo("lists", "list_custom_${shelf.id}")
        tap("list_custom_${shelf.id}")
        waitFor { compose.onAllNodesWithContentDescription("Dracula").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(compose.onAllNodesWithContentDescription("Faust").fetchSemanticsNodes().isEmpty())
        waitForText("1 Buch")
    }

    @Test fun aBookBeingReadShowsItsProgress() {
        start(samples = true)
        openBook("Der Prozess")
        waitForTag("bookOverview")
        waitForTag("logSession")
        shot("50_book_reading")
        // The timer is one small button on the reading tab, not a headline of the book page.
        assertTrue(compose.onAllNodesWithTag("openTimer").fetchSemanticsNodes().isEmpty())
        tapText("Lesen")
        waitForTag("openTimer")
        shot("51_book_reading_tab")
        tap("openTimer")
        waitForText("Lese-Timer")
    }

    @Config(sdk = [35], qualifiers = "de")
    @Test fun loggingASessionMovesTheBookmark() {
        runBlocking { container.library.addBook(SampleBooks.create(Dates.today()).first { it.title == "Der Prozess" }) }
        start()
        openBook("Der Prozess")
        waitForTag("bookOverview")
        scrollListTo("bookOverview", "logSession")
        tap("logSession")
        type("sessionTo", "180")
        type("sessionMinutes", "90")
        tap("sessionSave")
        waitFor { book("Der Prozess").currentPage == 180 }
        val sessions = runBlocking { container.library.sessionsOf(book("Der Prozess").id).first() }
        assertEquals(120, sessions.single().startPage)
        assertEquals(180, sessions.single().endPage)
        assertEquals(90f, sessions.single().minutes)
        tapText("Lesen")
        waitForText("120 bis 180")

        // Reading to the last page finishes the book.
        tapText("Übersicht")
        scrollListTo("bookOverview", "logSession")
        tap("logSession")
        type("sessionTo", "256")
        tap("sessionSave")
        waitFor { book("Der Prozess").status == ReadingStatus.READ }
        assertEquals(Dates.today(), book("Der Prozess").finishedOn)
    }

    @Test fun sharedTextBecomesAQuote() {
        runBlocking { container.library.addBook(Book(title = "Momo", authors = "Michael Ende")) }
        start(intent = shareIntentOf("Zeit ist Leben. Und das Leben wohnt im Herzen."))
        waitForTag("quoteText")
        waitForText("Zeit ist Leben")
        tap("pickBook")
        tap("pick_book_${book("Momo").id}")
        type("quotePage", "57")
        shot("60_quote_editor")
        tap("saveQuote")
        waitFor { runBlocking { container.library.quotes.first() }.isNotEmpty() }
        val quote = runBlocking { container.library.quotes.first() }.single()
        assertEquals("Zeit ist Leben. Und das Leben wohnt im Herzen.", quote.quote.text)
        assertEquals(57, quote.quote.page)
        assertEquals("Momo", quote.bookTitle)
    }

    private val oldRequestFile =
        """{"app":"shelfmark","v":1,"type":"lend_request","request":{"requestId":"req-1","bookId":1,"bookTitle":"Dune","fromId":"b","fromName":"Ben","toId":"a","note":"Für die Ferien?","createdAt":5}}"""

    @Test fun aShelfFromAFileCanBeLookedAtButBorrowingNeedsAccounts() {
        runBlocking { container.settings.setProfileName("Ben") }
        val anna = Friend("Anna")
        runBlocking {
            anna.db.books().insert(Book(title = "Dune", authors = "Frank Herbert", status = ReadingStatus.READ, rating = 5f, spice = 1, review = "Sand überall."))
            anna.db.books().insert(Book(title = "Emma", authors = "Jane Austen", lentTo = "Clara"))
        }
        val libraryFile = ShareCodec.encode(runBlocking { anna.social.exportLibrary(includeStatus = true, includeRatings = true) })

        // Anna's library file arrives.
        start(intent = shareIntentOf(libraryFile))
        waitForTag("importDialog")
        waitForText("Die Bibliothek von Anna wurde importiert: 2 Bücher.")
        shot("70_library_imported")
        tap("importAction")
        waitForText("Ausleihbar")
        shot("71_friend_shelf")

        // Her rating is visible. Asking for the book is not on offer: a loan lives on the server, between two accounts.
        openBook("Dune")
        waitForTag("friendBookSheet")
        waitForText("Anna besitzt dieses Buch")
        waitForText("Sand überall.")
        waitForTag("cannotAsk")
        waitForText("Ausleihen geht von Konto zu Konto. Dieses Regal kam als Datei.")
        assertTrue(!hasTag("askToBorrow"))
        shot("72_friend_book")
        // The book can still be put on the wishlist.
        tapText("Auf meine Wunschliste")
        waitFor { books().singleOrNull()?.status == ReadingStatus.WISHLIST }
        assertEquals(Ownership.NOT_OWNED, book("Dune").ownership)
        assertTrue(loans().isEmpty())
    }

    @Test fun myShelfGoesOutAsAFileAndAnOldRequestIsCalledWhatItIs() {
        runBlocking {
            container.settings.setProfileName("Anna")
            container.library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        }
        start()
        tap("tabFriends")
        waitForText("Meine Bibliothek teilen")
        // The loans are where the borrow requests were.
        waitForTag("allLoans")
        waitForText("Ausleihen")
        shot("80_friends")
        clearShared()
        tap("shareLibrary")
        val libraryFile = lastSharedFile()

        // Ben opens my library and sees what could be borrowed.
        val ben = Friend("Ben")
        val imported = runBlocking { ben.social.import(libraryFile) } as ImportResult.LibraryImported
        assertEquals("Anna", imported.name)
        val dune = runBlocking { ben.social.friendBooks(imported.friendId).first() }.single()
        assertTrue(dune.available)

        // His phone still has the version from before the loans, and sends a borrow request as a file.
        // It is not mistaken for something else, and nothing comes of it.
        scenario!!.onActivity { it.deliver(shareIntentOf(oldRequestFile)) }
        waitForTag("importDialog")
        waitForText("Diese Datei stammt aus einer älteren Version von Shelfmark. Ausleihen geht jetzt von Konto zu Konto, ohne Dateien.")
        shot("81_old_request_file")
        tapText("OK")
        assertEquals("", book("Dune").lentTo)
        scrollListTo("friends", "allLoans")
        tap("allLoans")
        waitForTag("loans")
        waitForText("Noch keine Ausleihen")
    }

    @Test fun statisticsGoalsQuotesAndSettingsScreens() {
        runBlocking {
            SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
            val prozess = book("Der Prozess")
            val now = System.currentTimeMillis()
            container.database.sessions().insert(ReadingSession(bookId = prozess.id, startedAt = now - 2 * 86_400_000L, startPage = 0, endPage = 60, minutes = 75f))
            container.database.sessions().insert(ReadingSession(bookId = prozess.id, startedAt = now - 86_400_000L, startPage = 60, endPage = 120, minutes = 80f))
            container.library.saveGoal(Goal(kind = GoalKind.BOOKS, target = 12, startDay = 0, endDay = 0, repeat = GoalRepeat.YEARLY))
            container.library.saveQuote(Quote(bookId = prozess.id, text = "Jemand musste Josef K. verleumdet haben.", page = 7))
        }
        start()
        tap("tabStats")
        waitForTag("stats")
        waitForText("Bücher beendet")
        shot("90_stats")
        tap("openGoals")
        waitForTag("goalCard")
        waitForText("4 von 12 Bücher")
        shot("91_goals")
        scenario!!.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        tap("tabQuotes")
        waitForText("Jemand musste Josef K. verleumdet haben.")
        shot("92_quotes")

        tap("tabLibrary")
        tap("openSettings")
        waitForTag("lang_de")
        shot("93_settings")
        tap("theme_paper")
        waitFor { runBlocking { container.settings.current().theme } == "paper" }
        tap("theme_ember")
        waitFor { runBlocking { container.settings.current().theme } == "ember" }
        shot("94_settings_ember_theme")
        scenario!!.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        waitForTag("coverShelf")
        shot("95_shelf_ember_theme")
    }

    @Config(sdk = [35], qualifiers = "de")
    @Test fun aGoalCanBeSetInTheDialog() {
        start()
        tap("tabStats")
        tap("openGoals")
        tap("newGoal")
        tap("goalKind_PAGES")
        tap("goalRepeat_WEEKLY")
        tap("goalSave")
        waitFor { runBlocking { container.library.goals.first() }.isNotEmpty() }
        val goal = runBlocking { container.library.goals.first() }.single()
        assertEquals(GoalKind.PAGES, goal.kind)
        assertEquals(GoalRepeat.WEEKLY, goal.repeat)
        assertEquals(12, goal.target)
        waitForTag("goalCard")
    }

    @Test fun calendarRecapAndMilestones() {
        runBlocking {
            SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
            val prozess = book("Der Prozess")
            val now = System.currentTimeMillis()
            container.database.sessions().insert(ReadingSession(bookId = prozess.id, startedAt = now - 86_400_000L, startPage = 0, endPage = 60, minutes = 75f))
            container.database.sessions().insert(ReadingSession(bookId = prozess.id, startedAt = now, startPage = 60, endPage = 120, minutes = 80f))
            container.library.savePurchase(Purchase(bookId = prozess.id, day = Dates.today(), price = 14.9, currency = "CHF", store = "Buchhandlung"))
        }
        start()
        tap("tabStats")
        waitForTag("stats")
        tap("openCalendar")
        waitForTag("calendar")
        shot("96_calendar")
        tap("day_${java.time.LocalDate.now().dayOfMonth}")
        waitForTag("dayCard")
        waitForText("60 Seiten")
        waitForText("Der Prozess")
        shot("97_calendar_day")
        back()

        tap("openRecap")
        waitForTag("recap")
        // What was spent on books this month shows up too.
        waitForText("14,90 CHF")
        shot("98_recap_month")
        tap("recapYear")
        waitForText(java.time.LocalDate.now().year.toString())
        shot("99_recap_year")
        back()

        tap("openMilestones")
        waitForTag("milestones")
        waitForTag("milestone_BOOKS")
        waitForText("Nächster Meilenstein: 10")
        shot("100_milestones")
    }

    @Test fun aShelfGetsDecorated() {
        start(samples = true)
        runBlocking { container.settings.setViewMode(ViewMode.SPINES) }
        waitForTag("spineShelf")
        tap("decorate_READING")
        tap("addOrnament_PLANT")
        tap("addOrnament_MUG")
        waitFor { runBlocking { container.library.ornaments.first() }.size == 2 }
        waitForTag("ornamentRow")
        shot("44_ornament_dialog")
        tap("ornamentDone")
        val ornaments = runBlocking { container.library.ornaments.first() }
        assertEquals(setOf(OrnamentKind.PLANT, OrnamentKind.MUG), ornaments.map { it.kind }.toSet())
        assertTrue(ornaments.all { it.shelfKey == "READING" })
        shot("45_shelf_decorated")
    }

    @Config(sdk = [35], qualifiers = "de")
    @Test fun aPurchaseIsWrittenDown() {
        runBlocking { container.library.addBook(SampleBooks.create(Dates.today()).first { it.title == "Der Prozess" }) }
        start()
        openBook("Der Prozess")
        waitForTag("bookOverview")
        scrollListTo("bookOverview", "addPurchase")
        tap("addPurchase")
        type("purchasePrice", "24,90")
        type("purchaseStore", "Orell Füssli")
        tap("purchaseSave")
        waitFor { runBlocking { container.library.purchases.first() }.isNotEmpty() }
        val purchase = runBlocking { container.library.purchases.first() }.single()
        assertEquals(24.9, purchase.price, 0.001)
        assertEquals("Orell Füssli", purchase.store)
        assertEquals(Dates.today(), purchase.day)
        assertEquals(book("Der Prozess").id, purchase.bookId)
        waitForText("Orell Füssli")
    }

    @Config(sdk = [35], qualifiers = "de")
    @Test fun aThemeOfMyOwn() {
        start(samples = true)
        tap("openSettings")
        scrollTo("newTheme")
        tap("newTheme")
        type("themeName", "Moor")
        tap("colourAccent")
        retype("colourHex", "#7BC47F")
        tap("colourOk")
        tap("themeSave")
        waitFor { runBlocking { container.settings.current() }.customThemes.isNotEmpty() }
        val settings = runBlocking { container.settings.current() }
        val theme = settings.customThemes.single()
        assertEquals("Moor", theme.name)
        assertEquals(0xFF7BC47F.toInt(), theme.accent)
        // A new theme is put on right away.
        waitFor { runBlocking { container.settings.current() }.theme == theme.key }
        waitForText("Moor")
    }

    @Test fun aGoodreadsListIsImported() {
        runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert", review = "Meine Worte")) }
        val file = File(folder.root, "goodreads_library_export.csv")
        file.writeText(AppFlowTest::class.java.getResource("/fixtures/goodreads_export.csv")!!.readText())
        start(Intent(app, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setDataAndType(android.net.Uri.fromFile(file), "text/csv"))
        waitForTag("importBooksDialog")
        waitForText("Import aus Goodreads")
        waitForText("2 neue Bücher")
        waitForText("1 Buch ist schon da")
        shot("101_import_goodreads")
        tap("importConfirm")
        waitFor { books().size == 3 }
        waitForText("Import abgeschlossen")
        waitForText("2 Bücher hinzugefügt")
        assertEquals("Meine Worte", book("Dune").review)
        assertEquals("9780441172719", book("Dune").isbn)
        assertEquals(ReadingStatus.WISHLIST, book("Der Vorleser").status)
        assertEquals(setOf("favorites", "sci-fi"), runBlocking { container.library.shelves.first() }.map { it.name }.toSet())
    }

    private val benEmail = "ben@shelfmark.test"
    private val benPassword = "geheim-ben"

    /** The account of the app itself, where a test does not care about signing up through the screens. */
    private val myEmail = "ich@shelfmark.test"
    private val myPassword = "geheim-ich"

    @Test fun friendsFindEachOtherThroughTheirAccounts() {
        useServer()
        runBlocking {
            container.settings.setProfileName("Ben")
            container.library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        }
        // Anna is on another phone, with an account on the same server.
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        runBlocking {
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", status = ReadingStatus.READ, rating = 4.5f, review = "Ganz wunderbar.", lendable = true))
            anna.join()
        }
        try {
            start()
            // Opening the app checks in with the server, signed in or not, and says nothing about anybody.
            waitFor { fakeServer.calls["shelfmark_ping"] == 1 }
            assertTrue(!fakeServer.hasAccount(benEmail))

            tap("tabFriends")
            waitForTag("accountCard")
            waitForText("Mit einem Konto")
            shot("83_friends_account")
            type("accountEmail", benEmail)
            type("accountPassword", benPassword)
            tap("signUp")
            waitForTag("friendCode")
            // The code shows as soon as the server knows me. The first exchange runs a moment longer.
            waitFor { !container.server.status.value.running && runBlocking { container.settings.current() }.lastSyncAt > 0 }
            val myCode = runBlocking { container.settings.current() }.friendCode
            assertEquals(10, myCode.length)
            waitForText(myCode.chunked(5).joinToString("-"))
            waitForText("Angemeldet als $benEmail")
            // The library went to the account with it.
            assertEquals(1L, fakeServer.revisionOf(benEmail))
            shot("84_friends_connected")

            // Anna types in my code. I do nothing but look again.
            assertEquals("Ben", runBlocking { anna.server.addFriend(myCode) }.getOrThrow())
            tap("syncNow")
            waitFor { runBlocking { container.social.friends.first() }.firstOrNull()?.friend?.online == true }
            scrollListTo("friends", "friendCard")
            // The little cloud is part of the card, which reads as one thing to a screen reader.
            waitFor { compose.onAllNodesWithTag("friendOnline", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            waitForText("Anna")
            shot("85_friend_online")

            // Her shelf is there, and asking for a book needs no messenger.
            tap("friendCard")
            waitForText("Ausleihbar")
            openBook("Emma")
            waitForTag("friendBookSheet")
            waitForText("Ganz wunderbar.")
            clearShared()
            tap("askToBorrow")
            waitFor { fakeServer.loanStatesOf(anna.email) == listOf("asked") }
            assertTrue(File(app.cacheDir, "shared").listFiles().isNullOrEmpty())
            waitForTag("loanState")
            waitForText("Warte auf Anna.")

            // Anna says yes on her phone, and the answer shows up here by itself.
            val asked = runBlocking { anna.server.sync() } as SyncResult.Done
            assertEquals("Ben", asked.news.single().loan.peerName)
            assertNull(runBlocking { anna.server.loanAct(asked.news.single().loan.id, LoanAction.AGREE) })
            // Not runBlocking: the app may be in the middle of a sync of its own, which needs this very thread to go on.
            lookAtServer()
            waitFor { loans().singleOrNull()?.state == LoanState.AGREED }
            waitForText("Anna hat Ja gesagt. Das Buch ist für dich reserviert.")
        } finally {
            anna.close()
        }
    }

    @Config(sdk = [35], qualifiers = "de")
    @Test fun aFriendIsAddedByCode() {
        useServer()
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        appDoes {
            container.settings.setProfileName("Ben")
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
            anna.join()
            container.server.signUp(benEmail, benPassword)
        }
        try {
            start()
            tap("tabFriends")
            scrollTo("addFriend")
            tap("addFriend")
            // A code nobody has is answered in plain words, and the dialog stays.
            type("friendCodeField", "zzzzz-zzzzz")
            tap("friendCodeAdd")
            waitForTag("friendCodeProblem")
            waitForText("Diesen Code hat niemand")
            retype("friendCodeField", runBlocking { anna.settings.current() }.friendCode.lowercase())
            tap("friendCodeAdd")
            // The friend row appears first, the mark that it came through the server a moment later.
            waitFor { runBlocking { container.social.friends.first() }.singleOrNull()?.friend?.online == true }
            val friend = runBlocking { container.social.friends.first() }.single()
            assertEquals("Anna", friend.friend.name)
            assertTrue(friend.friend.online)
            assertEquals(1, friend.bookCount)
            waitFor { org.robolectric.shadows.ShadowToast.getTextOfLatestToast() == "Du und Anna seid jetzt befreundet" }
        } finally {
            anna.close()
        }
    }

    @Test fun signingInGoesWrongInPlainWordsAndRightWithoutFuss() {
        useServer()
        fakeServer.confirmEmail = true
        start()
        tap("tabFriends")
        // A new account on a server that wants the address confirmed: say so, sign nobody in.
        type("accountEmail", benEmail)
        type("accountPassword", benPassword)
        tap("signUp")
        waitForTag("accountNotice")
        waitForText("Öffne den Link in der Mail")
        assertTrue(!runBlocking { container.settings.current() }.signedIn)
        // Signing in before that link was opened.
        tap("signIn")
        waitForTag("accountProblem")
        waitForText("Bestätige zuerst deine Adresse")
        // The link was opened. A wrong password first, then the right one.
        fakeServer.confirm(benEmail)
        retype("accountPassword", "falsches-passwort")
        tap("signIn")
        waitForText("E-Mail oder Passwort stimmt nicht.")
        retype("accountPassword", benPassword)
        tap("signIn")
        waitForTag("onlineCard")
        waitFor { runBlocking { container.settings.current() }.signedIn }
        // Asking for a new password needs nothing but the address.
        waitFor { fakeServer.calls["signup"] == 1 }
    }

    @Test fun aServerThatMaySendNoMoreMailsSaysSoInsteadOfBlamingTheReader() {
        useServer()
        fakeServer.confirmEmail = true
        fakeServer.mailsSpent = true
        start(onboarded = false)
        waitForTag("onboarding")
        type("accountEmail", benEmail)
        type("accountPassword", benPassword)
        tap("signUp")
        waitForTag("accountProblem")
        waitForText("Der Server kann im Moment keine Bestätigungsmails mehr verschicken. Das liegt nicht an dir.")
        assertTrue(compose.onAllNodesWithText("Zu viele Versuche", substring = true).fetchSemanticsNodes().isEmpty())
        assertTrue(!fakeServer.hasAccount(benEmail))
        // An hour later, or with confirmation switched off on the server, the same tap works.
        fakeServer.mailsSpent = false
        fakeServer.confirmEmail = false
        tap("signUp")
        waitFor { runBlocking { container.settings.current() }.signedIn }
    }

    @Test fun comingBackFromTheConfirmationMailSignsInWithoutAnotherTap() {
        useServer()
        fakeServer.confirmEmail = true
        start()
        tap("tabFriends")
        type("accountEmail", benEmail)
        type("accountPassword", benPassword)
        tap("signUp")
        waitForTag("accountNotice")
        waitForText("komm dann hierher zurück")
        // The link in the mail leads to the page of the website that says "confirmed".
        assertEquals("https://shelfmark.example/confirmed", fakeServer.returnTo)
        // Away to the mail and back, but the link was not opened yet: nothing happens, and nothing is complained about.
        scenario!!.moveToState(Lifecycle.State.STARTED)
        scenario!!.moveToState(Lifecycle.State.RESUMED)
        waitFor { (fakeServer.calls["token"] ?: 0) >= 1 }
        settle()
        assertTrue(!runBlocking { container.settings.current() }.signedIn)
        assertTrue(compose.onAllNodesWithTag("accountProblem").fetchSemanticsNodes().isEmpty())
        waitForTag("accountNotice")
        // The link was opened. Coming back is all it takes.
        fakeServer.confirm(benEmail)
        scenario!!.moveToState(Lifecycle.State.STARTED)
        scenario!!.moveToState(Lifecycle.State.RESUMED)
        waitFor { runBlocking { container.settings.current() }.signedIn }
        waitForTag("onlineCard")
        assertEquals(benEmail, runBlocking { container.settings.current() }.accountEmail)
    }

    @Test fun anAccountWithBooksMeetsADeviceWithBooks() {
        useServer()
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        runBlocking {
            SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
            anna.library.addBook(Book(title = "Persuasion", authors = "Jane Austen"))
            anna.join()
        }
        try {
            start()
            tap("tabFriends")
            type("accountEmail", anna.email)
            type("accountPassword", anna.password)
            tap("signIn")
            // They were never the same library, so the app does not guess.
            waitForTag("chooseLibrary")
            waitForText("Auf deinem Konto liegen 2 Bücher, auf diesem Gerät 10.")
            shot("86_which_library")
            assertEquals(10, books().size)
            tap("chooseAccount")
            waitFor { books().size == 2 }
            assertEquals(setOf("Emma", "Persuasion"), books().map { it.title }.toSet())
            // The name of the account came along, and signing out is in the settings.
            waitFor { runBlocking { container.settings.current() }.profileName == "Anna" }
            tap("tabLibrary")
            tap("openSettings")
            scrollTo("signOut")
            waitForText("Angemeldet als ${anna.email}")
            // Privacy notice and imprint are one tap away.
            scrollTo("openImprint")
            tap("openImprint")
            waitFor { shadowOf(app).peekNextStartedActivity() != null }
            assertEquals("https://shelfmark.example/de/impressum", shadowOf(app).nextStartedActivity.dataString)
            scrollTo("signOut")
            // The two settings that only made things harder are gone.
            assertTrue(compose.onAllNodesWithTag("googleKey").fetchSemanticsNodes().isEmpty())
            assertTrue(compose.onAllNodesWithTag("ownServer").fetchSemanticsNodes().isEmpty())
            tap("signOut")
            waitFor { !runBlocking { container.settings.current() }.signedIn }
            // Signed out, the books are still here.
            assertEquals(2, books().size)
        } finally {
            anna.close()
        }
    }

    @Test fun theLibraryThatLostTheChoiceCanBeHadBack() {
        useServer()
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        runBlocking {
            SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
            anna.join()
        }
        try {
            start()
            tap("tabFriends")
            type("accountEmail", anna.email)
            type("accountPassword", anna.password)
            tap("signIn")
            waitForTag("chooseLibrary")
            // The dialog no longer claims to know that the two were never the same, and it says what happens to the loser.
            assertFalse(hasText("Es war nie dieselbe Bibliothek"))
            waitForText("Vorher wird sie auf diesem Gerät als Backup beiseitegelegt, und du findest sie in den Einstellungen unter «Backup».")
            tap("chooseAccount")
            waitFor { books().size == 1 }

            // The ten books that were here are in the settings, as a backup to bring back.
            tap("tabLibrary")
            tap("openSettings")
            scrollTo("replacedLibrary")
            waitForText("Als du gewählt hast, welche Bibliothek zählt, wurde die andere hier beiseitegelegt.")
            shot("87_replaced_library")
            tap("replacedLibrary")
            waitForTag("restoreConfirm")
            tap("restoreConfirm")
            waitFor { books().size == 10 }
            assertTrue(books().any { it.title == "Der Prozess" })
        } finally {
            anna.close()
        }
    }

    @Test fun theShelfSaysWhenTheSignInEndedByItself() {
        useServer()
        runBlocking { container.library.addBook(Book(title = "Emma", authors = "Jane Austen")) }
        signUpWithFriends("Ich")
        start()
        waitForTag("coverShelf")
        assertFalse(hasTag("signedOutNotice"))
        // Signed in, the backup is not the only place the library lives in, and the settings say so.
        tap("openSettings")
        scrollTo("backupText")
        waitForText("Deine Bibliothek liegt auch auf deinem Konto.")
        assertFalse(hasText("nur auf diesem Gerät"))
        back()

        // The password was changed somewhere else: every sign-in of the account is over.
        fakeServer.revokeAll()
        lookAtServer()
        waitForTag("signedOutNotice")
        waitForText("Du wurdest auf diesem Gerät abgemeldet. Deine Änderungen bleiben hier, bis du dich wieder anmeldest.")
        shot("88_signed_out_notice")
        // It is still there after a look elsewhere, and the settings now speak of this device only.
        tap("openSettings")
        scrollTo("backupText")
        waitForText("Ohne Konto liegt deine Bibliothek nur auf diesem Gerät.")
        back()
        waitForTag("signedOutNotice")

        // "Sign in" leads to the form, and signing in takes the notice away.
        tap("signedOutSignIn")
        type("accountEmail", myEmail)
        type("accountPassword", myPassword)
        tap("signIn")
        waitFor { runBlocking { container.settings.current() }.let { it.signedIn && !it.signedOutNotice } }
        tap("tabLibrary")
        waitForTag("coverShelf")
        assertFalse(hasTag("signedOutNotice"))

        // The next time the reader puts it away, and goes on without an account.
        fakeServer.revokeAll()
        lookAtServer()
        waitForTag("signedOutNotice")
        tap("signedOutClose")
        waitFor { !hasTag("signedOutNotice") }
        val settings = runBlocking { container.settings.current() }
        assertFalse(settings.signedOutNotice)
        assertFalse(settings.signedIn)
        assertEquals(listOf("Emma"), books().map { it.title })
    }

    @Test fun whatASyncBringsIsShownOnTheOpenPageAndNotWrittenBackOver() {
        runBlocking { container.library.addBook(Book(title = "Emma", authors = "Jane Austen", review = "Erster Eindruck.")) }
        start()
        openBook("Emma")
        waitForTag("bookOverview")
        scrollListTo("bookOverview", "review")
        waitForText("Erster Eindruck.")
        val id = book("Emma").id

        // While the page is open, a sync brings the review as it was rewritten on another device.
        appDoes { container.library.modify(id) { it.copy(review = "Auf dem Tablet neu geschrieben.") } }
        // Nobody typed here, so the field shows what is stored now.
        waitForText("Auf dem Tablet neu geschrieben.")
        assertFalse(hasText("Erster Eindruck."))
        // And leaving the page writes nothing back.
        back()
        waitForTag("coverShelf")
        settle()
        assertEquals("Auf dem Tablet neu geschrieben.", book("Emma").review)

        // What the reader types is saved, also when they leave before the field has saved by itself.
        openBook("Emma")
        waitForTag("bookOverview")
        scrollListTo("bookOverview", "review")
        retype("review", "Und jetzt in meinen Worten.")
        scenario!!.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        waitFor { book("Emma").review == "Und jetzt in meinen Worten." }

        // Typed here and changed elsewhere at the same time: what was typed counts, it is the reader's latest word.
        openBook("Emma")
        waitForTag("bookOverview")
        scrollListTo("bookOverview", "review")
        retype("review", "Getippt.")
        appDoes { container.library.modify(id) { it.copy(review = "Von anderswo.") } }
        waitFor { book("Emma").review == "Getippt." }
        waitForText("Getippt.")
    }

    @Test fun theEditFormOnlySavesWhatWasChangedInItAndAsksBeforeItThrowsAnythingAway() {
        runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert", pageCount = 600, series = "Dune")) }
        start()
        openBook("Dune")
        tap("editBook")
        waitForTag("fieldTitle")
        val id = book("Dune").id

        // Nothing typed: Back simply goes back.
        back()
        waitForTag("bookOverview")
        assertFalse(hasTag("discardDialog"))

        // Something typed: Back asks first, and "keep editing" keeps every letter.
        tap("editBook")
        retype("fieldTitle", "Dune, verbessert")
        back()
        waitForTag("discardDialog")
        waitForText("Änderungen verwerfen?")
        shot("14_discard_changes")
        tap("discardNo")
        waitFor { !hasTag("discardDialog") }
        waitForText("Dune, verbessert")
        // Discarding leaves the book as it was.
        back()
        tap("discardYes")
        waitForTag("bookOverview")
        assertEquals("Dune", book("Dune").title)

        // The form is open while the book changes behind it: stars and a review from the book
        // page, a cover and a publisher from a sync, and the book is moved to "read".
        tap("editBook")
        waitForTag("fieldTitle")
        appDoes {
            container.library.modify(id) {
                it.copy(rating = 5f, review = "Sand.", coverUrl = "https://catalogue.example/dune.jpg", publisher = "Ace").withStatus(ReadingStatus.READ, Dates.today())
            }
        }
        retype("fieldTitle", "Dune Messiah")
        // A place in the series is a plain number. What Kotlin would read as infinity does not get into the field.
        scrollTo("fieldSeriesPosition")
        type("fieldSeriesPosition", "1e39")
        assertFalse(hasText("1e39"))
        type("fieldSeriesPosition", "2,5")
        tap("saveBook")
        waitFor { books().single().title == "Dune Messiah" }
        val saved = books().single()
        // What the reader changed in the form is saved, and nothing else of the book is touched.
        assertEquals(2.5f, saved.seriesPosition)
        assertEquals(5f, saved.rating)
        assertEquals("Sand.", saved.review)
        assertEquals(ReadingStatus.READ, saved.status)
        assertEquals(1, saved.readCount)
        assertEquals("https://catalogue.example/dune.jpg", saved.coverUrl)
        assertEquals("Ace", saved.publisher)
        assertEquals("Frank Herbert", saved.authors)
        assertEquals(600, saved.pageCount)
    }

    @Test fun aMoveToAnotherListCanBeTakenBack() {
        val before = Book(title = "Dune", authors = "Frank Herbert", pageCount = 600, status = ReadingStatus.READ, startedOn = 19_000, finishedOn = 19_020, currentPage = 600, readCount = 2, rating = 4f)
        runBlocking { container.library.addBook(before) }
        start()
        openBook("Dune")
        waitForTag("bookOverview")
        val stored = book("Dune")

        // One tap on "reading" starts the book over: the bookmark and the day it was finished are gone.
        tap("status_READING")
        waitFor { book("Dune").status == ReadingStatus.READING }
        assertEquals(0, book("Dune").currentPage)
        assertNull(book("Dune").finishedOn)
        // For a few seconds that can be taken back, and the book is exactly what it was.
        waitForText("Nach «Am Lesen» verschoben.")
        shot("15_undo_status")
        tapText("Rückgängig")
        waitFor { book("Dune").status == ReadingStatus.READ }
        assertEquals(stored, book("Dune").copy(updatedAt = stored.updatedAt))

        // Left alone, the offer goes away by itself and the move stays.
        tap("status_ABANDONED")
        waitForText("Rückgängig")
        waitFor(20_000) { !hasText("Rückgängig") }
        assertEquals(ReadingStatus.ABANDONED, book("Dune").status)
    }

    @Test fun whatOneTapWouldDeleteAsksFirst() {
        runBlocking {
            val id = container.library.addBook(Book(title = "Dune", authors = "Frank Herbert", pageCount = 600))
            container.library.logSession(ReadingSession(bookId = id, startPage = 0, endPage = 40, minutes = 30f))
            container.library.saveQuote(Quote(bookId = id, text = "Fear is the mind-killer.", page = 12))
            container.library.saveNote(ch.schmidtbit.shelfmark.data.model.Note(bookId = id, text = "Wer ist Duncan?"))
            container.library.saveGoal(Goal(kind = GoalKind.BOOKS, target = 12, startDay = 0, endDay = 0, repeat = GoalRepeat.YEARLY))
        }
        fun sessions() = runBlocking { container.library.sessions.first() }
        fun quotes() = runBlocking { container.library.quotes.first() }
        fun notes() = runBlocking { container.library.notesOf(book("Dune").id).first() }
        fun goals() = runBlocking { container.library.goals.first() }
        start()

        // A reading session, by the bin beside it.
        openBook("Dune")
        waitForTag("bookOverview")
        tapText("Lesen")
        tap("deleteSession")
        waitForTag("confirmDelete")
        waitForText("Diese Lesesitzung löschen?")
        shot("16_confirm_delete")
        tap("confirmDeleteNo")
        waitFor { !hasTag("confirmDelete") }
        assertEquals(1, sessions().size)
        tap("deleteSession")
        tap("confirmDeleteYes")
        waitFor { sessions().isEmpty() }

        // A note, from the dialog it is edited in.
        tapText("Notizen")
        tapText("Wer ist Duncan?")
        // The dialog with its text fields takes a frame more to stand than a look at it right away allows.
        settle()
        tap("deleteNote")
        waitForText("Diese Notiz löschen?")
        tap("confirmDeleteNo")
        waitFor { !hasTag("confirmDelete") }
        assertEquals(1, notes().size)
        tap("deleteNote")
        tap("confirmDeleteYes")
        waitFor { notes().isEmpty() }
        back()

        // A quote, by the bin at the top of its page.
        tap("tabQuotes")
        tapText("Fear is the mind-killer.")
        waitForTag("quoteText")
        tap("deleteQuote")
        waitForText("Dieses Zitat löschen?")
        tap("confirmDeleteNo")
        waitFor { !hasTag("confirmDelete") }
        assertEquals(1, quotes().size)
        assertTrue(hasTag("quoteText"))
        tap("deleteQuote")
        tap("confirmDeleteYes")
        waitFor { quotes().isEmpty() }

        // A goal.
        tap("tabStats")
        tap("openGoals")
        tap("deleteGoal")
        waitForText("Dieses Ziel löschen?")
        tap("confirmDeleteNo")
        waitFor { !hasTag("confirmDelete") }
        assertEquals(1, goals().size)
        tap("deleteGoal")
        tap("confirmDeleteYes")
        waitFor { goals().isEmpty() }
    }

    @Test fun whatWasTypedIsNotLostWithoutAQuestion() {
        runBlocking {
            val dune = container.library.addBook(Book(title = "Dune", authors = "Frank Herbert", pageCount = 600))
            container.library.addBook(Book(title = "Emma", authors = "Jane Austen", pageCount = 474))
            container.library.saveQuote(Quote(bookId = dune, text = "Fear is the mind-killer.", page = 12))
            // The timer holds twelve and a half minutes for Dune, and is paused.
            container.settings.setTimer(TimerState(dune, runningSince = null, accumulatedSeconds = 754, startedAt = System.currentTimeMillis() - 900_000, startPage = 0))
        }
        start()

        // A quote that was changed: Back asks, and discarding leaves it as it was.
        tap("tabQuotes")
        tapText("Fear is the mind-killer.")
        waitForTag("quoteText")
        back()
        waitForText("Fear is the mind-killer.")
        assertFalse(hasTag("discardDialog"))
        tapText("Fear is the mind-killer.")
        retype("quoteText", "Fear is the little-death.")
        back()
        waitForTag("discardDialog")
        tap("discardNo")
        waitForText("Fear is the little-death.")
        back()
        tap("discardYes")
        waitFor { !hasTag("quoteText") }
        assertEquals("Fear is the mind-killer.", runBlocking { container.library.quotes.first() }.single().quote.text)

        tap("tabLibrary")
        settle()

        // The timer already holds time for Dune. Starting it for Emma asks before that time is dropped.
        openBook("Emma")
        waitForTag("bookOverview")
        tapText("Lesen")
        tap("openTimer")
        tap("timerToggle")
        waitForTag("confirmDelete")
        waitForText("Neuen Timer starten?")
        waitForText("Der Timer steht bei 00:12:34 für «Dune».")
        shot("52_timer_other_book")
        tap("confirmDeleteNo")
        waitFor { !hasTag("confirmDelete") }
        assertEquals(book("Dune").id, runBlocking { container.settings.current() }.timer?.bookId)
        assertEquals(754L, runBlocking { container.settings.current() }.timer?.accumulatedSeconds)
        tap("timerToggle")
        tap("confirmDeleteYes")
        waitFor { runBlocking { container.settings.current() }.timer?.bookId == book("Emma").id }
        back()
        back()

        // A name typed in the settings and left at once is saved all the same.
        tap("openSettings")
        scrollTo("profileName")
        retype("profileName", "Anna")
        scenario!!.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        waitFor { runBlocking { container.settings.current() }.profileName == "Anna" }
    }

    @Test fun aNoteHalfWrittenIsNotClosedByAFingerThatMissed() {
        runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert")) }
        start()
        openBook("Dune")
        waitForTag("bookOverview")
        tapText("Notizen")
        settle()
        fun dialog() = org.robolectric.shadows.ShadowDialog.getLatestDialog() as androidx.activity.ComponentDialog
        // A tap beside a dialog and Back come to the same: the dialog is asked to go.
        fun askToGo() {
            pause()
            dialog().onBackPressedDispatcher.onBackPressed()
            pause()
        }

        // With nothing typed it goes, as it always did.
        tap("addNote")
        settle()
        assertTrue(hasTag("noteText"))
        askToGo()
        settle()
        assertFalse(dialog().isShowing)
        assertFalse(hasTag("noteText"))

        // With something typed it stays, however often it is asked.
        tap("addNote")
        settle()
        compose.onNodeWithTag("noteText").performSemanticsAction(SemanticsActions.SetText) { it(androidx.compose.ui.text.AnnotatedString("Wer ist Duncan?")) }
        // From here on the test looks at the window and not at what is drawn in it: in this test
        // environment a dialog that got text after standing for a moment never reads as "at rest".
        askToGo()
        assertTrue(dialog().isShowing)
        askToGo()
        assertTrue(dialog().isShowing)
    }

    @Test fun starsAndChilliesCanBeReadAndSetWithoutSeeingThem() {
        runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert")) }
        start()
        openBook("Dune")
        waitForTag("bookOverview")
        scrollListTo("bookOverview", "ratingBar")
        fun config(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().config
        fun says(tag: String) = config(tag)[SemanticsProperties.ContentDescription].single()
        fun stars(value: Float) = app.getString(R.string.rating_description, ch.schmidtbit.shelfmark.ui.formatRating(value))

        // The bar is one control with a name, a value that is read out, and a way to set it.
        assertEquals("Bewertung", says("ratingBar"))
        assertEquals(stars(0f), config("ratingBar")[SemanticsProperties.StateDescription])
        assertEquals(0f..5f, config("ratingBar")[SemanticsProperties.ProgressBarRangeInfo].range)
        assertEquals(9, config("ratingBar")[SemanticsProperties.ProgressBarRangeInfo].steps)
        compose.onNodeWithTag("ratingBar").performSemanticsAction(SemanticsActions.SetProgress) { it(3.3f) }
        waitFor { book("Dune").rating == 3.5f }
        waitFor { config("ratingBar")[SemanticsProperties.StateDescription] == stars(3.5f) }
        assertEquals(3.5f, config("ratingBar")[SemanticsProperties.ProgressBarRangeInfo].current)

        // Each star is a button that says what a tap on it gives: the whole star, then the half one, then none.
        assertEquals(Role.Button, config("star2")[SemanticsProperties.Role])
        assertEquals("Mit 2 von 5 Sternen bewerten", says("star2"))
        // Three and a half is the half of the fourth star, so one more tap on that one takes the rating away.
        assertEquals("Bewertung entfernen", says("star4"))
        tap("star5")
        waitFor { book("Dune").rating == 5f }
        waitFor { says("star5") == app.getString(R.string.rating_set, ch.schmidtbit.shelfmark.ui.formatRating(4.5f)) }
        tap("star5")
        waitFor { book("Dune").rating == 4.5f }
        waitFor { says("star5") == "Bewertung entfernen" }
        tap("star5")
        waitFor { book("Dune").rating == 0f }

        // The chillies the same.
        assertEquals("Spice", says("spiceBar"))
        assertEquals("Spice-Level 0 von 5", config("spiceBar")[SemanticsProperties.StateDescription])
        assertEquals(4, config("spiceBar")[SemanticsProperties.ProgressBarRangeInfo].steps)
        compose.onNodeWithTag("spiceBar").performSemanticsAction(SemanticsActions.SetProgress) { it(2.6f) }
        waitFor { book("Dune").spice == 3 }
        waitFor { config("spiceBar")[SemanticsProperties.StateDescription] == "Spice-Level 3 von 5" }
        assertEquals("Spice-Level 5 von 5 setzen", says("spice5"))
        assertEquals("Spice-Level entfernen", says("spice3"))
        tap("spice3")
        waitFor { book("Dune").spice == 0 }
    }

    @Test fun theSettingsNameEveryCatalogueThatIsAsked() {
        // Seven are built into the app (see AppContainer.lookup), and the text about it names them all.
        val about = app.getString(R.string.settings_about_text)
        for (name in listOf("Open Library", "Google Books", "Apple Books", "lobid", "Deutschen Nationalbibliothek", "K10plus", "swisscovery")) assertTrue(name, name in about)
        start()
        tap("openSettings")
        scrollTo("backupText")
        // Without an account in the build or in use, the phone is the only place, and that is what it says.
        waitForText("Ohne Konto liegt deine Bibliothek nur auf diesem Gerät.")
    }

    @Test fun theFirstStartAsksForAnAccountAndANewOneGoesOnToTheRest() {
        useServer()
        start(onboarded = false)
        waitForTag("onboarding")
        // The way on is to sign in, or to say that it should go without.
        waitForTag("accountEmail")
        waitForText("Ohne Konto weiter")
        assertTrue(compose.onAllNodesWithTag("onboardingNext").fetchSemanticsNodes().isEmpty())
        shot("04_onboarding_account")
        // What an account keeps can be read before there is one, in the reader's language.
        waitForText("Ein Konto speichert deine E-Mail-Adresse und deine Bibliothek auf dem Server.")
        tap("accountPrivacy")
        waitFor { shadowOf(app).peekNextStartedActivity() != null }
        val opened = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_VIEW, opened.action)
        assertEquals("https://shelfmark.example/de/datenschutz", opened.dataString)
        type("accountEmail", benEmail)
        type("accountPassword", benPassword)
        tap("signUp")
        // A new account has nothing in it yet: name and looks come next.
        waitForTag("onboardingName")
        waitFor { runBlocking { container.settings.current() }.signedIn }
        assertTrue(fakeServer.hasAccount(benEmail))
        assertTrue(!runBlocking { container.settings.current() }.onboarded)
        type("onboardingName", "Ben")
        waitForText("Wie soll es aussehen?")
        tap("onboardingNext")
        tap("startEmpty")
        waitForText("Dein Regal ist noch leer")
        val settings = runBlocking { container.settings.current() }
        assertTrue(settings.onboarded)
        assertEquals(benEmail, settings.accountEmail)
        assertEquals("Ben", settings.profileName)
        // The account knows the library of this phone, and its owner by name.
        waitFor(20_000) { fakeServer.revisionOf(benEmail) > 0 && fakeServer.knows(benEmail) }
    }

    @Test fun signingInOnTheFirstStartBringsTheLibraryAndSkipsTheRest() {
        useServer()
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        runBlocking {
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
            anna.library.addBook(Book(title = "Persuasion", authors = "Jane Austen"))
            anna.settings.setTheme("ember")
            anna.join()
        }
        try {
            start(onboarded = false)
            waitForTag("onboarding")
            type("accountEmail", anna.email)
            type("accountPassword", anna.password)
            tap("signIn")
            // Name, looks and books are on the account already. Nothing more to ask.
            waitFor { runBlocking { container.settings.current() }.onboarded }
            waitFor { books().size == 2 }
            waitForTag("greeting")
            waitForText("Emma")
            val settings = runBlocking { container.settings.current() }
            assertEquals("Anna", settings.profileName)
            assertEquals("ember", settings.theme)
            assertEquals(anna.email, settings.accountEmail)
            assertTrue(compose.onAllNodesWithTag("chooseLibrary").fetchSemanticsNodes().isEmpty())
            shot("05_onboarding_signed_in_shelf")
        } finally {
            anna.close()
        }
    }

    @Test fun theFirstStartAlsoGoesWithoutAnAccount() {
        useServer()
        start(onboarded = false)
        waitForTag("onboarding")
        tap("onboardingNoAccount")
        waitForTag("onboardingName")
        // Back on the first page the choice is still open.
        tapText("Zurück")
        waitForTag("accountEmail")
        tap("onboardingNoAccount")
        waitForText("Wie soll es aussehen?")
        tap("onboardingNext")
        tap("startSamples")
        waitFor { books().size == 10 }
        waitFor { runBlocking { container.settings.current() }.onboarded }
        val settings = runBlocking { container.settings.current() }
        assertTrue(!settings.signedIn)
        assertEquals(0, fakeServer.calls["signup"] ?: 0)
        // The account is still on offer, where it always was.
        tap("tabFriends")
        waitForTag("accountCard")
    }

    @Test fun iBorrowABookFromAFriendAndGiveItBack() {
        useServer()
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        runBlocking {
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", pageCount = 474, description = "Schön, klug und reich.", lendable = true))
            anna.join()
        }
        signUpWithFriends("Ben", anna)
        try {
            start()
            tap("tabFriends")
            scrollListTo("friends", "friendCard")
            tap("friendCard")
            waitForText("Ausleihbar")
            openBook("Emma")
            waitForTag("friendBookSheet")

            // I ask, with a few words.
            type("borrowNote", "Über die Feiertage?")
            tap("askToBorrow")
            waitFor { fakeServer.loanStatesOf(anna.email) == listOf("asked") }
            waitForTag("loanState")
            waitForText("Warte auf Anna.")
            waitForText("«Über die Feiertage?»")
            // From here on there is nothing to ask twice, only a question to take back.
            assertTrue(!hasTag("askToBorrow"))
            waitForTag("loan_withdraw")
            shot("73_loan_asked")
            val id = loans().single().id

            // Anna says yes, back in three weeks. The book is reserved, and how the handover goes is said.
            val due = Dates.today() + 21
            runBlocking {
                assertEquals("Über die Feiertage?", (anna.server.sync() as SyncResult.Done).news.single().loan.note)
                assertNull(anna.server.loanAct(id, LoanAction.AGREE, due = due))
            }
            lookAtServer()
            waitForText("Anna hat Ja gesagt. Das Buch ist für dich reserviert.")
            waitForText("Zurück bis ${Dates.format(due)}")
            waitForText("Macht die Übergabe unter euch ab. Zuerst bestätigt Anna, dann du.")
            waitFor { ("Anna hat Ja gesagt zu «Emma»" to null) in notifications() }
            assertTrue(books().isEmpty())

            // She says she handed it over. Now it is my turn, and the phone says so.
            runBlocking { assertNull(anna.server.loanAct(id, LoanAction.HAND)) }
            lookAtServer()
            waitForText("Anna sagt, das Buch sei dir übergeben worden. Hast du es?")
            // One notification per loan: the newer step takes the place of the older one.
            waitFor { notifications() == setOf<Pair<String, String?>>("Anna sagt, «Emma» sei dir übergeben worden" to "Öffne Shelfmark, um zu bestätigen.") }
            waitForTag("loan_receive")
            waitForTag("loan_not_received")
            shot("74_loan_handed")

            // Away from her shelf the question is not forgotten: a number on the tab, and the loan on top of the friends.
            back()
            waitFor { hasTag("loansBadge", unmerged = true) }
            scrollListTo("friends", "loan_receive")
            waitForText("Wartet auf deine Antwort")
            waitForText("«Emma» von Anna")
            tapStep("loan_receive")

            // The book is mine to read: it stands on my shelf as borrowed.
            waitFor { books().singleOrNull()?.ownership == Ownership.BORROWED }
            val copy = book("Emma")
            assertEquals("Anna", copy.borrowedFrom)
            assertEquals(id, copy.loanId)
            assertEquals("Schön, klug und reich.", copy.description)
            waitFor { !hasTag("loansBadge", unmerged = true) }
            waitFor { !hasTag("loanCard") }
            // Anna's own book says who has it, once I said that I do.
            runBlocking {
                anna.server.sync()
                assertEquals("Ben", anna.library.allBooks().single().lentTo)
            }
            // Her shelf tells me since when I have it, and how giving it back goes.
            scrollListTo("friends", "friendCard")
            tap("friendCard")
            waitForText("Ausleihbar")
            openBook("Emma")
            waitForTag("friendBookSheet")
            // The day is the day I said so, by the server's clock.
            waitForText("Ausgeliehen von Anna seit ${Dates.format(Dates.dayOf(loans().single().receivedAt!!))}.")
            waitForText("Wenn du das Buch zurückgibst, sag es hier. Anna bestätigt es dann.")
            waitForTag("loan_give_back")

            // On my shelf, and on its page: the loan is where "borrowed from" used to be typed in.
            back()
            tap("tabLibrary")
            settle()
            openBook("Emma")
            waitForTag("bookOverview")
            scrollListTo("bookOverview", "bookLoan")
            waitForText("Ausgeliehen von Anna seit")
            waitForText("Zurück bis ${Dates.format(due)}")
            assertTrue(!hasTag("borrowedFrom"))
            shot("75_borrowed_book")

            // I give it back and say so. Until Anna has it, it is borrowed.
            scrollListTo("bookOverview", "loan_give_back")
            tapStep("loan_give_back")
            waitFor { fakeServer.loanStatesOf(anna.email) == listOf("given_back") }
            waitForText("Du hast gesagt, du hast es zurückgegeben. Warte auf die Bestätigung von Anna.")
            waitForTag("loan_undo_give_back")
            assertEquals(Ownership.BORROWED, book("Emma").ownership)

            // She has it back. My copy stays as read, not mine.
            runBlocking {
                anna.server.sync()
                assertNull(anna.server.loanAct(id, LoanAction.TAKE_BACK))
                assertEquals("", anna.library.allBooks().single().lentTo)
            }
            lookAtServer()
            waitFor { book("Emma").ownership == Ownership.NOT_OWNED }
            waitForText("an Anna zurückgegeben.")
            waitFor { ("Anna hat «Emma» zurück" to null) in notifications() }
            assertEquals("Anna", book("Emma").borrowedFrom)
            assertEquals(1, books().size)
            shot("76_read_not_mine")
        } finally {
            anna.close()
        }
    }

    @Test fun aFriendBorrowsABookFromMe() {
        useServer()
        val ben = Phone(app, folder, "Ben", fakeServer, serverConfig)
        val myDune = runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert")) }
        val me = signUpWithFriends("Anna", ben)
        // Ben asks while my phone is in my pocket.
        runBlocking { assertNull(ben.server.loanAsk(ben.onMyShelf(me, "Dune"), "Für die Ferien?")) }
        try {
            start()
            // Opening the app is enough to hear of it: a notification, and a number on the tab.
            waitFor { ("Ben möchte «Dune» ausleihen" to "Öffne Shelfmark, um zu bestätigen.") in notifications() }
            waitFor { hasTag("loansBadge", unmerged = true) }
            val id = loans().single().id
            tap("tabFriends")
            scrollListTo("friends", "loanCard")
            waitForText("Wartet auf deine Antwort")
            scrollListTo("friends", "loan_agree")
            waitForText("«Dune» für Ben")
            waitForText("Ben möchte dieses Buch ausleihen.")
            waitForText("«Für die Ferien?»")
            shot("82_loan_question")

            // Yes, and back by a day: four weeks from now is what the calendar offers.
            tapStep("loan_agree")
            waitForTag("dueDialog")
            waitForText("«Dune» an Ben verleihen?")
            waitForText("Das Buch ist für Ben reserviert, bis du es übergibst.")
            waitForText("Kein festes Datum")
            tap("dueByDate")
            tap("dueDayOk")
            val due = Dates.today() + 28
            waitFor { loans().single().let { it.state == LoanState.AGREED && it.dueOn == due } }
            // Reserved is not lent: my book has not moved, but nobody else can ask for it.
            assertEquals("", book("Dune").lentTo)
            waitFor { !hasTag("loansBadge", unmerged = true) }
            // My phone tells the server a moment after the tap, and Ben's shelf of my books follows.
            waitFor { runBlocking { ben.server.sync(); !ben.onMyShelf(me, "Dune").available } }

            // All loans are one tap away, sorted by what there is to do.
            scrollListTo("friends", "allLoans")
            tap("allLoans")
            waitForTag("loans")
            waitForText("Unterwegs")
            waitForText("Reserviert für Ben.")
            waitForText("Zurück bis ${Dates.format(due)}")
            waitForTag("loan_cancel")
            // The day can be changed for as long as the loan runs, also to none at all, and back.
            tapStep("loan_set_due")
            waitForTag("dueDialog")
            waitForText("Bis wann möchtest du es zurück?")
            tap("dueOpen")
            waitFor { loans().single().dueOn == null }
            waitForText("Kein festes Datum")
            tapStep("loan_set_due")
            tap("dueByDate")
            tap("dueDayOk")
            waitFor { loans().single().dueOn == due }
            waitForText("Zurück bis ${Dates.format(due)}")
            tapStep("loan_hand")
            waitFor { loans().single().state == LoanState.HANDED }
            waitForText("Du hast gesagt, du hast es übergeben. Warte auf die Bestätigung von Ben.")
            waitForTag("loan_undo_hand")
            assertEquals("", book("Dune").lentTo)

            // Ben has it. Now it is lent, and my book says so.
            runBlocking {
                ben.server.sync()
                assertNull(ben.server.loanAct(id, LoanAction.RECEIVE))
            }
            lookAtServer()
            waitFor { book("Dune").lentTo == "Ben" }
            // Since the day he said so, by the server's clock.
            val since = Dates.dayOf(loans().single().receivedAt!!)
            assertEquals(since, book("Dune").lentSince)
            assertEquals(id, book("Dune").loanId)
            waitForText("Verliehen an Ben seit ${Dates.format(since)}.")
            waitFor { ("Ben hat «Dune» jetzt" to null) in notifications() }
            shot("87_loan_lent")

            // The page of my book shows the loan where the controls for lending by hand were.
            tap("loanBook")
            waitForTag("bookOverview")
            scrollListTo("bookOverview", "bookLoan")
            waitForText("Verliehen an Ben seit")
            waitForTag("loan_close")
            assertTrue(!hasTag("gotItBack") && !hasTag("lendable"))
            assertTrue(!hasText("Als verliehen markieren"))
            // A book that is out cannot be deleted: the loan would point at nothing.
            compose.onAllNodesWithContentDescription("Mehr").onFirst().performClick()
            tapText("Buch löschen")
            waitForTag("deleteRefused")
            waitForText("Dieses Buch gehört zu einer Ausleihe. Schliesse zuerst die Ausleihe ab")
            tapText("OK")
            waitFor { !hasTag("deleteRefused") }
            assertEquals(1, books().size)

            // He says he gave it back. I confirm, and the book is free again.
            runBlocking { assertNull(ben.server.loanAct(id, LoanAction.GIVE_BACK)) }
            lookAtServer()
            waitForText("Ben sagt, das Buch sei zurückgegeben. Hast du es?")
            waitFor { ("Ben sagt, «Dune» sei zurückgegeben" to "Öffne Shelfmark, um zu bestätigen.") in notifications() }
            waitForTag("loan_not_returned")
            shot("88_loan_back")
            scrollListTo("bookOverview", "loan_take_back")
            tapStep("loan_take_back")
            waitFor { runBlocking { container.library.getBook(myDune) }!!.let { it.lentTo == "" && it.loanId == "" && it.lentSince == null } }
            waitForTag("lendable")
            waitForText("Als verliehen markieren")
            assertEquals(listOf("returned"), fakeServer.loanStatesOf(myEmail))
            // His copy stays with him as read, not his.
            runBlocking {
                ben.server.sync()
                val copy = ben.library.allBooks().single()
                assertEquals(Ownership.NOT_OWNED, copy.ownership)
                assertEquals("Anna", copy.borrowedFrom)
            }
        } finally {
            ben.close()
        }
    }

    // A dialog with a text field: see the note on ownListsCanBeCreatedAndFilled.
    @Config(sdk = [35], qualifiers = "de")
    @Test fun sayingNoCanComeWithAReason() {
        useServer()
        val ben = Phone(app, folder, "Ben", fakeServer, serverConfig)
        runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert")) }
        val me = signUpWithFriends("Anna", ben)
        runBlocking { assertNull(ben.server.loanAsk(ben.onMyShelf(me, "Dune"), "")) }
        try {
            start()
            tap("tabFriends")
            scrollListTo("friends", "loan_decline")
            tapStep("loan_decline")
            waitForText("Ben absagen?")
            type("loanReason", "Das lese ich gerade selbst.")
            tap("loanConfirm")
            waitFor { fakeServer.loanStatesOf(myEmail) == listOf("declined") }
            // Ben reads why.
            runBlocking {
                assertEquals(listOf<LoanNewsKind?>(LoanNewsKind.DECLINED), (ben.server.sync() as SyncResult.Done).news.map { it.kind })
                assertEquals("Das lese ich gerade selbst.", ben.social.loans.first().single().reason)
            }
            // With me it is among the loans that are over, until I put it away.
            waitFor { !hasTag("loanCard") }
            scrollListTo("friends", "allLoans")
            tap("allLoans")
            waitForTag("loans")
            waitForText("Früher")
            waitForText("Du hast Ben abgesagt.")
            waitForText("Grund: Das lese ich gerade selbst.")
            tapStep("loan_hide")
            waitFor { loans().isEmpty() }
            waitForText("Noch keine Ausleihen")
            // The book never moved.
            assertEquals("", book("Dune").lentTo)
        } finally {
            ben.close()
        }
    }

    // Dialogs with a text field: see the note on ownListsCanBeCreatedAndFilled.
    @Config(sdk = [35], qualifiers = "de")
    @Test fun aYesCanBeTakenBackAndABookThatIsOutLookedAfterByHand() {
        useServer()
        val ben = Phone(app, folder, "Ben", fakeServer, serverConfig)
        val myDune = runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert")) }
        val me = signUpWithFriends("Anna", ben)
        fun benAsks(): String = runBlocking {
            assertNull(ben.server.loanAsk(ben.onMyShelf(me, "Dune"), ""))
            ben.social.loans.first().first().id
        }
        fun dune() = runBlocking { container.library.getBook(myDune)!! }
        /** From the question to "handed over", on the screen with all the loans. */
        fun sayYesAndHandOver(id: String) {
            lookAtServer()
            waitFor { loans().firstOrNull { it.id == id }?.state == LoanState.ASKED }
            scrollListTo("loans", "loan_agree")
            tapStep("loan_agree")
            // No day is an answer like any other.
            tap("dueOpen")
            waitFor { loans().first { it.id == id }.let { it.state == LoanState.AGREED && it.dueOn == null } }
            scrollListTo("loans", "loan_hand")
            tapStep("loan_hand")
            waitFor { loans().first { it.id == id }.state == LoanState.HANDED }
        }
        val first = benAsks()
        try {
            start()
            tap("tabFriends")
            scrollListTo("friends", "loan_agree")
            tapStep("loan_agree")
            tap("dueOpen")
            waitFor { loans().singleOrNull()?.state == LoanState.AGREED }
            scrollListTo("friends", "allLoans")
            tap("allLoans")
            waitForTag("loans")
            waitForText("Reserviert für Ben.")
            waitForText("Kein festes Datum")

            // Then I need the book myself after all, and say so.
            tapStep("loan_cancel")
            waitForText("Zusage zurücknehmen?")
            type("loanReason", "Ich brauche es doch selbst.")
            tap("loanConfirm")
            waitFor { fakeServer.loanStatesOf(myEmail) == listOf("cancelled") }
            waitForText("Du hast die Zusage zurückgenommen.")
            waitForText("Grund: Ich brauche es doch selbst.")
            runBlocking {
                ben.server.sync()
                assertEquals("Ich brauche es doch selbst.", ben.social.loans.first().single().reason)
            }
            assertEquals(first, loans().single().id)

            // The next time he gets it. It comes back without him ever saying so, and I close the loan myself.
            val second = benAsks()
            sayYesAndHandOver(second)
            runBlocking {
                ben.server.sync()
                assertNull(ben.server.loanAct(second, LoanAction.RECEIVE))
            }
            lookAtServer()
            waitFor { dune().loanId == second }
            scrollListTo("loans", "loan_close")
            tapStep("loan_close")
            waitForText("Ben hat noch nicht gesagt, dass das Buch zurückgegeben wurde. Die Ausleihe trotzdem abschliessen?")
            tap("loanConfirm")
            waitFor { dune().let { it.lentTo == "" && it.loanId == "" } }
            assertEquals(listOf("cancelled", "returned"), fakeServer.loanStatesOf(myEmail))

            // The third time he has it, he deletes his account, and the loan is gone with it.
            // The book is still with him: its page offers what it offers for a book lent by hand.
            val third = benAsks()
            sayYesAndHandOver(third)
            runBlocking {
                ben.server.sync()
                assertNull(ben.server.loanAct(third, LoanAction.RECEIVE))
            }
            lookAtServer()
            waitFor { dune().loanId == third }
            runBlocking { assertTrue(ben.server.deleteAccount()) }
            lookAtServer()
            waitFor { loans().isEmpty() }
            waitForText("Noch keine Ausleihen")
            assertEquals("Ben", dune().lentTo)
            assertEquals(third, dune().loanId)
            back()
            tap("tabLibrary")
            settle()
            openBook("Dune")
            waitForTag("bookOverview")
            scrollListTo("bookOverview", "gotItBack")
            waitForText("Verliehen an Ben seit")
            assertTrue(!hasTag("bookLoan"))
            tap("gotItBack")
            waitFor { dune().let { it.lentTo == "" && it.loanId == "" && it.lentSince == null } }
            waitForTag("lendable")
            // Saying that the book is something else than it was ends what such a loan left on it, too.
            runBlocking { container.library.modify(myDune) { it.copy(lentTo = "Ben", loanId = third) } }
            waitForTag("gotItBack")
            scrollListTo("bookOverview", "own_NOT_OWNED")
            tap("own_NOT_OWNED")
            waitFor { dune().let { it.ownership == Ownership.NOT_OWNED && it.loanId == "" } }
        } finally {
            ben.close()
        }
    }

    @Test fun whoComesSecondIsToldThatTheBookIsTaken() {
        useServer()
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        val cleo = Phone(app, folder, "Cleo", fakeServer, serverConfig)
        runBlocking {
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
            anna.library.addBook(Book(title = "Persuasion", authors = "Jane Austen"))
            anna.join()
            cleo.join()
            cleo.server.addFriend(anna.settings.current().friendCode).getOrThrow()
        }
        signUpWithFriends("Ben", anna)
        try {
            start()
            tap("tabFriends")
            scrollListTo("friends", "friendCard")
            tap("friendCard")
            waitForText("Ausleihbar")

            // Cleo and I both ask for Emma. Anna says yes to Cleo.
            openBook("Emma")
            waitForTag("friendBookSheet")
            tap("askToBorrow")
            waitFor { fakeServer.loanStatesOf(myEmail) == listOf("asked") }
            runBlocking {
                assertNull(cleo.server.loanAsk(cleo.social.friendBooks(anna.id).first().first { it.title == "Emma" }, ""))
                anna.server.sync()
                assertNull(anna.server.loanAct(cleo.social.loans.first().single().id, LoanAction.AGREE))
            }
            lookAtServer()
            // No waiting list: it went to somebody else, and I can ask again later.
            waitForText("Jemand anderes hat es bekommen. Frag später nochmals.")
            waitForText("Dieses Buch kann im Moment nicht ausgeliehen werden.")
            assertTrue(!hasTag("askToBorrow"))
            waitFor { ("«Emma» ging an jemand anderen" to null) in notifications() }
            assertTrue(loans().single().taken)
            shot("77_loan_taken")
            back()

            // Persuasion goes to Cleo a moment before I ask, on a device of Anna's that has not
            // told anybody yet: my copy of her shelf still shows it as free. The server knows better.
            runBlocking {
                assertNull(cleo.server.loanAsk(cleo.social.friendBooks(anna.id).first().first { it.title == "Persuasion" }, ""))
                val asAnna = ServerApi(serverConfig, fakeServer, anna.settings.current().accessToken)
                asAnna.loanAct(asAnna.sync(emptyMap()).loans.first { it.title == "Persuasion" }.id, LoanAction.AGREE)
            }
            scrollListTo("friends", "friendCard")
            tap("friendCard")
            waitForText("Ausleihbar")
            openBook("Persuasion")
            waitForTag("friendBookSheet")
            tap("askToBorrow")
            waitFor { latestToast() == "Dieses Buch ist für jemand anderen reserviert oder verliehen." }
            assertEquals(1, loans().size)
            assertTrue(books().isEmpty())
        } finally {
            anna.close()
            cleo.close()
        }
    }

    @Test fun aBookThatIsDueIsRemindedOfOnce() {
        useServer()
        // Her phone lives in the same days as mine.
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig, clockDay = { Dates.today() })
        runBlocking {
            anna.library.addBook(Book(title = "Emma", authors = "Jane Austen"))
            anna.join()
        }
        val me = signUpWithFriends("Ben", anna)
        val today = Dates.today()
        // I have had Emma for a while, and today is the day Anna wanted it back by.
        val id = appDoes {
            assertNull(container.server.loanAsk(container.social.friendBooks(anna.id).first().single(), ""))
            val id = container.social.loans.first().single().id
            anna.server.sync()
            assertNull(anna.server.loanAct(id, LoanAction.AGREE, due = today))
            assertNull(anna.server.loanAct(id, LoanAction.HAND))
            clearNotifications()
            assertNull(container.server.loanAct(id, LoanAction.RECEIVE))
            id
        }
        try {
            // The phone says so, once.
            assertEquals(setOf<Pair<String, String?>>("«Emma» ist bei Anna fällig" to "Heute fällig"), notifications())
            clearNotifications()
            appDoes { assertTrue(container.server.sync() is SyncResult.Done) }
            assertTrue(notifications().isEmpty())
            // Anna is reminded as well, in her words. Her phone is not the one with a screen here.
            val hers = runBlocking { (anna.server.sync() as SyncResult.Done).due.single() }
            assertEquals(1, Notifier.announce(app, SyncResult.Done(due = listOf(hers))))
            assertEquals(setOf<Pair<String, String?>>("Ben wollte «Emma» bis jetzt zurückbringen" to "Heute fällig"), notifications())
            clearNotifications()

            // She moves the day, to one that is past already: another day, another reminder.
            appDoes {
                assertNull(anna.server.loanAct(id, LoanAction.SET_DUE, due = today - 3))
                assertTrue(container.server.sync() is SyncResult.Done)
            }
            val late = "War am ${Dates.format(today - 3)} fällig"
            assertEquals(setOf("Anna hat das Datum für «Emma» geändert" to null, "«Emma» ist bei Anna fällig" to late), notifications())

            // Tapping it leads to the loans, where the book stands as overdue.
            start(Intent(app, MainActivity::class.java).setAction(Notifier.ACTION_OPEN_LOANS))
            waitForTag("loans")
            waitForText("Ausgeliehen")
            waitForText("«Emma» von Anna")
            waitForText(late)
            waitForTag("loan_give_back")
            shot("78_loan_overdue")
            assertEquals(me, runBlocking { anna.social.loans.first().single().peerId })
        } finally {
            anna.close()
        }
    }

    @Test fun whatAFriendDoesToALoanIsAnnounced() {
        val manager = app.getSystemService(android.app.NotificationManager::class.java)
        fun loan(id: String, lender: Boolean, peer: String, title: String, state: LoanState, reason: String = "") =
            Loan(id = id, lender = lender, peerId = "p-$peer", peerName = peer, bookId = 1, title = title, state = state, reason = reason)
        val asked = loan("loan-1", lender = true, peer = "Ben", title = "Dune", state = LoanState.ASKED)
        val taken = loan("loan-2", lender = false, peer = "Clara", title = "Emma", state = LoanState.DECLINED, reason = "taken")
        val news = SyncResult.Done(news = listOf(LoanNews(asked, LoanNewsKind.ASKED), LoanNews(taken, LoanNewsKind.TAKEN)))
        // Without the permission nothing is shown, and nothing breaks.
        assertEquals(0, Notifier.announce(app, news))
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(2, Notifier.announce(app, news))
        // A step that waits for my own tap says so. News that is only news does not.
        assertEquals(setOf("Ben möchte «Dune» ausleihen" to "Öffne Shelfmark, um zu bestätigen.", "«Emma» ging an jemand anderen" to null), notifications())
        assertEquals(0, Notifier.announce(app, SyncResult.Done()))

        // The next step of the same loan takes the place of the last one: one notification per loan.
        val handed = loan("loan-3", lender = false, peer = "Anna", title = "Momo", state = LoanState.HANDED)
        assertEquals(1, Notifier.announce(app, SyncResult.Done(news = listOf(LoanNews(handed, LoanNewsKind.HANDED)))))
        assertEquals(1, Notifier.announce(app, SyncResult.Done(news = listOf(LoanNews(asked.copy(state = LoanState.WITHDRAWN), LoanNewsKind.WITHDRAWN)))))
        assertEquals(
            setOf("Ben fragt nicht mehr nach «Dune»" to null, "«Emma» ging an jemand anderen" to null, "Anna sagt, «Momo» sei dir übergeben worden" to "Öffne Shelfmark, um zu bestätigen."),
            notifications(),
        )
        // A tap that was taken back has no words. What was said about it is taken back with it.
        assertEquals(0, Notifier.announce(app, SyncResult.Done(news = listOf(LoanNews(handed.copy(state = LoanState.AGREED), null)))))
        assertEquals(2, shadowOf(manager).allNotifications.size)
        // Somebody who gave no name is still somebody.
        clearNotifications()
        Notifier.announce(app, SyncResult.Done(news = listOf(LoanNews(asked.copy(peerName = ""), LoanNewsKind.ASKED))))
        assertEquals(setOf<Pair<String, String?>>("Jemand möchte «Dune» ausleihen" to "Öffne Shelfmark, um zu bestätigen."), notifications())

        // Tapping a notification leads to the loans.
        start(Intent(app, MainActivity::class.java).setAction(Notifier.ACTION_OPEN_LOANS))
        waitForTag("loans")
        waitForText("Noch keine Ausleihen")
    }

    @Test fun inFrontTheAppAsksTheServerOnceAMinuteAndInTheBackgroundNotAtAll() {
        useServer()
        val ben = Phone(app, folder, "Ben", fakeServer, serverConfig)
        runBlocking { container.library.addBook(Book(title = "Dune", authors = "Frank Herbert")) }
        val me = signUpWithFriends("Anna", ben)
        fun asked() = fakeServer.calls["shelfmark_sync"] ?: 0
        val before = asked()
        try {
            start()
            // Coming to the front asks at once.
            waitFor { asked() > before }
            // The app also saves a change to the library a few seconds after it. That is over before the minute is.
            ShadowLooper.idleMainLooper(6, TimeUnit.SECONDS)
            waitFor { !container.server.status.value.running }
            settle()
            val first = asked()
            // Ben asks for a book. Nobody touches my phone, and a minute later it knows.
            runBlocking { assertNull(ben.server.loanAsk(ben.onMyShelf(me, "Dune"), "")) }
            ShadowLooper.idleMainLooper(61, TimeUnit.SECONDS)
            waitFor { asked() > first }
            waitFor { loans().singleOrNull()?.state == LoanState.ASKED }
            waitFor { hasTag("loansBadge", unmerged = true) }
            waitFor { !container.server.status.value.running }
            settle()

            // Out of sight the app asks nothing, however long.
            scenario!!.moveToState(Lifecycle.State.CREATED)
            val inBackground = asked()
            ShadowLooper.idleMainLooper(10, TimeUnit.MINUTES)
            settle()
            assertEquals(inBackground, asked())
            // Back in front it asks right away.
            scenario!!.moveToState(Lifecycle.State.RESUMED)
            waitFor { asked() > inBackground }
        } finally {
            ben.close()
        }
    }

    @Test fun myOwnListsAreShelvesBelowTheOthers() {
        runBlocking {
            SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
            val favourites = container.library.createShelf("Lieblinge")
            container.library.createShelf("Urlaub")
            container.library.setOnShelf(book("Dracula").id, favourites, true)
            container.library.setOnShelf(book("Faust").id, favourites, true)
            container.settings.setViewMode(ViewMode.SPINES)
            container.settings.setProfileName("Martin")
            // Scrolling in a test waits until everything stands still, which a flickering candle never does.
            container.settings.setMotion(false)
        }
        val shelves = runBlocking { container.library.shelves.first() }
        val favourites = shelves.first { it.name == "Lieblinge" }
        val holiday = shelves.first { it.name == "Urlaub" }
        start()
        waitForTag("spineShelf")
        // The shelf says hello and offers the book being read.
        waitForTag("greeting")
        waitForText(", Martin")
        waitForText("10 Bücher in deinen Regalen")
        waitForTag("continueReading")
        waitForText("Seite 120 von 256")

        // With "All" selected, each list of my own is a shelf, the empty one too.
        scrollListTo("spineShelf", "shelf_list_${favourites.id}")
        waitForText("Lieblinge")
        scrollListTo("spineShelf", "emptyShelf_list_${holiday.id}")
        waitForText("Urlaub")
        waitForText("Dieses Regal ist noch leer")
        shot("46_own_lists_as_shelves")

        // Covers show them the same way.
        runBlocking { container.settings.setViewMode(ViewMode.COVERS) }
        waitForTag("coverShelf")
        scrollListTo("coverShelf", "emptyShelf_list_${holiday.id}")
        shot("47_own_lists_covers")

        // The heading still leads to the list alone.
        scrollListTo("coverShelf", "shelf_list_${favourites.id}")
        tap("shelf_list_${favourites.id}")
        waitForText("2 Bücher")
        settle()
        assertTrue(compose.onAllNodesWithContentDescription("Der Prozess").fetchSemanticsNodes().isEmpty())
    }

    @Test fun theShelfIsAliveAndCanBeStilled() {
        runBlocking {
            SampleBooks.create(Dates.today()).forEach { container.library.addBook(it) }
            container.settings.setViewMode(ViewMode.SPINES)
            // Everything that moves, on one shelf.
            listOf(OrnamentKind.CANDLE, OrnamentKind.MUG, OrnamentKind.CAT, OrnamentKind.CLOCK, OrnamentKind.BOOKSTACK, OrnamentKind.LAMP)
                .forEachIndexed { index, kind -> container.library.addOrnament("READING", kind, 1 + index) }
        }
        start()
        waitForTag("spineShelf")
        waitFor { compose.onAllNodesWithContentDescription("Schlafende Katze").fetchSemanticsNodes().isNotEmpty() }
        waitFor { compose.onAllNodesWithContentDescription("Bücherstapel").fetchSemanticsNodes().isNotEmpty() }
        // Somewhere a book leans on its neighbour.
        waitForTag("leaning")
        shot("48_lively_shelf")
        // A book can still be taken out while everything moves.
        openBook("Der Prozess")
        waitForTag("bookOverview")
        back()

        // And all of it can be switched off.
        tap("openSettings")
        scrollTo("motion")
        tap("motion")
        waitFor { !runBlocking { container.settings.current() }.motion }
        back()
        waitForTag("spineShelf")
        shot("49_still_shelf")
    }
}
