package ch.schmidtbit.shelfmark

import android.content.Intent
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
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.BookSource
import ch.schmidtbit.shelfmark.data.remote.ImageProbe
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.repo.SyncResult
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
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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

    private fun scrollListTo(listTag: String, tag: String) {
        waitForTag(listTag)
        compose.mainClock.autoAdvance = true
        compose.onNodeWithTag(listTag).performScrollToNode(hasTestTag(tag))
        compose.mainClock.autoAdvance = false
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

        // Ownership: borrowed from someone.
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

    @Test fun iBorrowFromAFriend() {
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

        // Her rating is visible, and the book can be asked for.
        openBook("Dune")
        waitForTag("friendBookSheet")
        waitForText("Anna besitzt dieses Buch")
        waitForText("Sand überall.")
        shot("72_friend_book")
        clearShared()
        tap("askToBorrow")
        val requestFile = lastSharedFile()
        assertEquals(Intent.ACTION_CHOOSER, shadowOf(app).nextStartedActivity.action)
        waitForTag("requestState")

        // Anna opens the request and says yes.
        val received = runBlocking { anna.social.import(requestFile) } as ImportResult.RequestReceived
        assertEquals("Ben", received.fromName)
        val answerFile = ShareCodec.encode(runBlocking { anna.social.answerRequest(received.requestId, accept = true) }!!)
        assertEquals("Ben", runBlocking { anna.db.books().all() }.first { it.title == "Dune" }.lentTo)

        // Her answer arrives here.
        scenario!!.onActivity { it.deliver(shareIntentOf(answerFile)) }
        waitForText("Anna hat Ja gesagt. Du kannst «Dune» ausleihen.")
        shot("73_answer_received")
        assertEquals(LendStatus.ACCEPTED, runBlocking { container.social.requests.first() }.single().status)
    }

    @Test fun aFriendBorrowsFromMe() {
        val myDune = runBlocking {
            container.settings.setProfileName("Anna")
            container.library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        }
        start()
        tap("tabFriends")
        waitForText("Meine Bibliothek teilen")
        shot("80_friends")
        clearShared()
        tap("shareLibrary")
        val libraryFile = lastSharedFile()

        // Ben opens my library and asks for Dune.
        val ben = Friend("Ben")
        val imported = runBlocking { ben.social.import(libraryFile) } as ImportResult.LibraryImported
        assertEquals("Anna", imported.name)
        val dune = runBlocking { ben.social.friendBooks(imported.friendId).first() }.single()
        assertTrue(dune.available)
        val requestFile = ShareCodec.encode(runBlocking { ben.social.createRequest(dune, "Für die Ferien?") })

        // His request arrives: one question, yes or no.
        scenario!!.onActivity { it.deliver(shareIntentOf(requestFile)) }
        waitForTag("requestDialog")
        waitForText("Ben möchte «Dune» ausleihen. Einverstanden?")
        waitForText("Für die Ferien?")
        shot("81_borrow_request")
        clearShared()
        tap("dialogYes")
        val answerFile = lastSharedFile()

        // My copy is now marked as lent to Ben, and Ben gets his yes.
        waitFor { runBlocking { container.library.getBook(myDune) }!!.lentTo == "Ben" }
        val answer = runBlocking { ben.social.import(answerFile) } as ImportResult.AnswerReceived
        assertTrue(answer.accepted)
        tap("allRequests")
        waitForText("Zugesagt")
        shot("82_requests")
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
            waitFor { fakeServer.waitingFor(anna.email) == 1 }
            assertTrue(File(app.cacheDir, "shared").listFiles().isNullOrEmpty())
            waitFor { org.robolectric.shadows.ShadowToast.getTextOfLatestToast() == "Gesendet" }

            // Anna says yes on her phone, and the answer shows up here by itself.
            val asked = runBlocking { anna.server.sync() } as SyncResult.Done
            assertEquals("Ben", asked.requests.single().fromName)
            runBlocking { anna.server.send(fakeServer.idOf(benEmail), anna.social.answerRequest(asked.requests.single().requestId, accept = true)!!) }
            scenario!!.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            settle()
            // Not runBlocking: the app may be in the middle of a sync of its own, which needs this very thread to go on.
            container.launch { container.refreshFriends(force = true) }
            waitFor { runBlocking { container.social.requests.first() }.singleOrNull()?.status == LendStatus.ACCEPTED }
            // Once it has arrived, the server is told and drops its copy.
            waitFor { fakeServer.waitingFor(benEmail) == 0 }
        } finally {
            anna.close()
        }
    }

    @Config(sdk = [35], qualifiers = "de")
    @Test fun aFriendIsAddedByCode() {
        useServer()
        val anna = Phone(app, folder, "Anna", fakeServer, serverConfig)
        runBlocking {
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

    @Test fun aRequestThatArrivesInTheBackgroundIsAnnounced() {
        val manager = app.getSystemService(android.app.NotificationManager::class.java)
        val news = SyncResult.Done(
            requests = listOf(ImportResult.RequestReceived("r1", "Anna", "Dune")),
            answers = listOf(ImportResult.AnswerReceived(true, "Clara", "Emma")),
        )
        // Without the permission nothing is shown, and nothing breaks.
        assertEquals(0, Notifier.announce(app, news))
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(2, Notifier.announce(app, news))
        val shown = shadowOf(manager).allNotifications.map { shadowOf(it).contentTitle.toString() to shadowOf(it).contentText.toString() }.toSet()
        assertEquals(setOf("Anna möchte ein Buch ausleihen" to "Dune", "Clara hat Ja gesagt" to "Emma"), shown)
        assertEquals(0, Notifier.announce(app, SyncResult.Done()))

        // Tapping the notification leads to the requests.
        start(Intent(app, MainActivity::class.java).setAction(Notifier.ACTION_OPEN_REQUESTS))
        waitForText("Noch keine Ausleih-Anfragen")
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
