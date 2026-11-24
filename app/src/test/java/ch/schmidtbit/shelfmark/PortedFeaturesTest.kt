package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.importer.Csv
import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.importer.ImportPlan
import ch.schmidtbit.shelfmark.data.importer.PlannedBook
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
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
import ch.schmidtbit.shelfmark.data.repo.BackupManager
import ch.schmidtbit.shelfmark.data.repo.CoverStore
import ch.schmidtbit.shelfmark.data.repo.CustomTheme
import ch.schmidtbit.shelfmark.data.repo.LibraryRepository
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.util.Ids
import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.stats.Insights
import ch.schmidtbit.shelfmark.data.stats.MilestoneCategory
import ch.schmidtbit.shelfmark.data.stats.Milestones
import ch.schmidtbit.shelfmark.data.stats.ReaderType
import ch.schmidtbit.shelfmark.data.stats.TimeOfDay
import ch.schmidtbit.shelfmark.ui.components.ShelfItem
import ch.schmidtbit.shelfmark.ui.components.ShelfThing
import ch.schmidtbit.shelfmark.ui.components.arrange
import ch.schmidtbit.shelfmark.ui.components.labelRes
import ch.schmidtbit.shelfmark.ui.components.leanOf
import ch.schmidtbit.shelfmark.ui.components.ornamentSize
import ch.schmidtbit.shelfmark.ui.detail.formatPrice
import ch.schmidtbit.shelfmark.ui.settings.hexOf
import ch.schmidtbit.shelfmark.ui.settings.parseHex
import ch.schmidtbit.shelfmark.ui.theme.presetFor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

private fun fixture(name: String): String =
    PortedFeaturesTest::class.java.getResource("/fixtures/$name")!!.readText()

private val UTC = ZoneOffset.UTC
private fun day(text: String): Long = LocalDate.parse(text).toEpochDay()
private fun at(date: String, hour: Int): Long = LocalDate.parse(date).atTime(hour, 0).toInstant(UTC).toEpochMilli()

/** Lists of books from other apps. */
class CsvImportTest {
    @Test fun csvFieldsMayHoldCommasQuotesAndLineBreaks() {
        val rows = Csv.parse("﻿a,b,c\r\n\"one, two\",\"say \"\"hi\"\"\",\"line\nbreak\"\r\n\r\n3,4,5")
        assertEquals(listOf(listOf("a", "b", "c"), listOf("one, two", "say \"hi\"", "line\nbreak"), listOf("3", "4", "5")), rows)
        // Spreadsheets in German-speaking countries save with semicolons.
        assertEquals(listOf(listOf("Titel", "Autor"), listOf("Momo", "Ende, Michael")), Csv.parse("Titel;Autor\nMomo;\"Ende, Michael\""))
    }

    @Test fun goodreadsExportIsUnderstood() {
        val plan = CsvImporter.parse(fixture("goodreads_export.csv"), UTC)!!
        assertEquals(CsvImporter.GOODREADS, plan.source)
        assertEquals(listOf("Dune", "Der Vorleser", "Momo"), plan.books.map { it.book.title })

        val dune = plan.books[0]
        assertEquals("Frank Herbert", dune.book.authors)
        assertEquals("9780441172719", dune.book.isbn)
        assertEquals(ReadingStatus.READ, dune.book.status)
        assertEquals(5f, dune.book.rating)
        assertEquals(896, dune.book.pageCount)
        assertEquals(896, dune.book.currentPage)
        assertEquals(BookFormat.PAPERBACK, dune.book.format)
        assertEquals("1965", dune.book.publishedYear)
        assertEquals(day("2024-03-02"), dune.book.finishedOn)
        assertEquals(2, dune.book.readCount)
        assertEquals("Sand. So much sand.\nWould read again.", dune.book.review)
        // Goodreads writes the series into the title.
        assertEquals("Dune", dune.book.series)
        assertEquals(1f, dune.book.seriesPosition)
        assertEquals(Ownership.OWNED, dune.book.ownership)
        // The three built-in shelves are states here, everything else becomes a list.
        assertEquals(listOf("favorites", "sci-fi"), dune.lists)

        // Wanted but not owned: a wish. Nothing to lend there.
        val vorleser = plan.books[1].book
        assertEquals(ReadingStatus.WISHLIST, vorleser.status)
        assertEquals(Ownership.NOT_OWNED, vorleser.ownership)
        assertFalse(vorleser.lendable)
        assertEquals("9783257229530", vorleser.isbn)
        assertTrue(plan.books[1].lists.isEmpty())

        val momo = plan.books[2].book
        assertEquals(ReadingStatus.READING, momo.status)
        assertEquals("Michael Ende, Lucas Zwirner, Marcel Dzama", momo.authors)
        assertEquals("", momo.isbn)
        assertEquals(BookFormat.HARDCOVER, momo.format)
    }

    @Test fun storyGraphExportIsUnderstood() {
        val plan = CsvImporter.parse(fixture("storygraph_export.csv"), UTC)!!
        assertEquals(CsvImporter.STORYGRAPH, plan.source)
        val (hobbit, hailMary, piranesi, babel) = plan.books.map { it.book }
        assertEquals(ReadingStatus.READ, hobbit.status)
        assertEquals(4.5f, hobbit.rating)
        assertEquals(day("2024-01-03"), hobbit.startedOn)
        assertEquals(day("2024-01-20"), hobbit.finishedOn)
        assertEquals("Cosy.", hobbit.review)
        assertEquals("fantasy, classics", hobbit.tags)
        assertEquals(BookFormat.PAPERBACK, hobbit.format)
        assertEquals(1, hobbit.readCount)

        assertEquals(ReadingStatus.READING, hailMary.status)
        assertEquals(BookFormat.AUDIOBOOK, hailMary.format)
        assertFalse(hailMary.lendable)

        assertEquals(ReadingStatus.ABANDONED, piranesi.status)
        assertEquals(BookFormat.EBOOK, piranesi.format)
        assertEquals(2.25f, piranesi.rating)

        assertEquals(ReadingStatus.WISHLIST, babel.status)
        assertEquals(Ownership.NOT_OWNED, babel.ownership)
    }

    @Test fun anyListWithATitleColumnWorksAlsoInGerman() {
        val plan = CsvImporter.parse(
            """
            Titel;Autor;ISBN;Seiten;Verlag;Jahr;Status;Bewertung;Reihe;Band
            Homo faber;Max Frisch;3-518-36854-0;203;Suhrkamp;1977;Gelesen;4,5;;
            Der Schwarm;Frank Schätzing;;987;Kiepenheuer & Witsch;2004;Am Lesen;;;
            Harry Potter und der Stein der Weisen;J. K. Rowling;;335;Carlsen;1998;Wunschliste;;Harry Potter;1
            """.trimIndent(),
            UTC,
        )!!
        assertEquals(CsvImporter.GENERIC, plan.source)
        val (faber, schwarm, potter) = plan.books.map { it.book }
        assertEquals("Max Frisch", faber.authors)
        assertEquals("9783518368541", faber.isbn)
        assertEquals(203, faber.pageCount)
        assertEquals("Suhrkamp", faber.publisher)
        assertEquals("1977", faber.publishedYear)
        assertEquals(ReadingStatus.READ, faber.status)
        assertEquals(4.5f, faber.rating)
        assertEquals(ReadingStatus.READING, schwarm.status)
        // A list one keeps oneself is a list of books one has, so a wish stays on the shelf of unread books.
        assertEquals(ReadingStatus.NONE, potter.status)
        assertEquals("Harry Potter", potter.series)
        assertEquals(1f, potter.seriesPosition)
    }

    @Test fun textThatIsNoBookListIsRefused() {
        assertNull(CsvImporter.parse("just a sentence, with a comma"))
        assertNull(CsvImporter.parse("date,amount\n2024-01-01,12"))
        assertNull(CsvImporter.parse("title,author\n"))
        assertNull(CsvImporter.parse(""))
    }

    @Test fun wordsForReadingStatesAndDates() {
        assertEquals(ReadingStatus.READ, CsvImporter.status("Finished", owned = true))
        assertEquals(ReadingStatus.READING, CsvImporter.status("currently-reading", owned = false))
        assertEquals(ReadingStatus.ABANDONED, CsvImporter.status("DNF", owned = true))
        assertEquals(ReadingStatus.WISHLIST, CsvImporter.status("to-read", owned = false))
        assertEquals(ReadingStatus.NONE, CsvImporter.status("to-read", owned = true))
        assertEquals(ReadingStatus.NONE, CsvImporter.status("something else", owned = true))
        assertEquals(day("2024-03-02"), CsvImporter.day("2024/03/02"))
        assertEquals(day("2024-03-02"), CsvImporter.day("2024-03-02 18:22:01"))
        assertEquals(day("2024-03-02"), CsvImporter.day("02.03.2024"))
        assertNull(CsvImporter.day("soon"))
        assertEquals(Triple("Dune", "Dune", 1f), CsvImporter.splitSeries("Dune (Dune, #1)"))
        assertEquals(Triple("The Colour of Magic", "Discworld", 1.5f), CsvImporter.splitSeries("The Colour of Magic (Discworld #1.5)"))
        assertEquals(Triple("Emma (annotated)", "", 0f), CsvImporter.splitSeries("Emma (annotated)"))
    }

    @Test fun theSameBookIsRecognisedAndOnlyGapsAreFilled() {
        val mine = Book(title = "Der Vorleser", authors = "Bernhard Schlink", rating = 4f, review = "Meins")
        val theirs = Book(title = "der vorleser", authors = "Bernhard Schlink, Someone Else", isbn = "9783257229530", pageCount = 206, rating = 2f, review = "Fremd", publisher = "Diogenes")
        assertTrue(CsvImporter.sameBook(mine, theirs))
        assertFalse(CsvImporter.sameBook(mine, Book(title = "Der Vorleser", authors = "Anna Other")))
        assertTrue(CsvImporter.sameBook(Book(title = "A", isbn = "9783257229530"), theirs))
        val merged = CsvImporter.fillGaps(mine, theirs)
        assertEquals("9783257229530", merged.isbn)
        assertEquals(206, merged.pageCount)
        assertEquals("Diogenes", merged.publisher)
        // What the user wrote stays.
        assertEquals(4f, merged.rating)
        assertEquals("Meins", merged.review)
        assertEquals("Der Vorleser", merged.title)
    }
}

/** Calendar, recaps and milestones are all views on the same reading history. */
class InsightsTest {
    private val paper = Book(id = 1, title = "Paper", authors = "Ann Author", pageCount = 300, status = ReadingStatus.READING, genres = "Novel")
    private val audio = Book(id = 2, title = "Audio", authors = "Ben Voice", pageCount = 600, format = BookFormat.AUDIOBOOK, status = ReadingStatus.READING)
    private val old = Book(id = 3, title = "Old", authors = "Ann Author", pageCount = 520, status = ReadingStatus.READ, readCount = 1, finishedOn = day("2024-03-09"), rating = 4.5f, genres = "Novel, Classic")
    private val short = Book(id = 4, title = "Short", authors = "Cy Third", pageCount = 90, status = ReadingStatus.READ, readCount = 1, finishedOn = day("2024-03-10"), rating = 3f)

    private val sessions = listOf(
        // Saturday and Sunday mornings, plus one weekday evening.
        ReadingSession(id = 1, bookId = 1, startedAt = at("2024-03-09", 9), startPage = 0, endPage = 40, minutes = 60f),
        ReadingSession(id = 2, bookId = 1, startedAt = at("2024-03-10", 8), startPage = 40, endPage = 100, minutes = 75f),
        ReadingSession(id = 3, bookId = 2, startedAt = at("2024-03-10", 10), startPage = 0, endPage = 45, minutes = 0f),
        ReadingSession(id = 4, bookId = 1, startedAt = at("2024-03-12", 20), startPage = 100, endPage = 110, minutes = 15f),
        ReadingSession(id = 5, bookId = 4, startedAt = at("2024-03-10", 7), startPage = 0, endPage = 90, minutes = 80f),
    )
    private val books = listOf(paper, audio, old, short)

    @Test fun everyDayKnowsWhatWasReadAndFinished() {
        val days = Insights.days(books, sessions, UTC)
        assertEquals(setOf(day("2024-03-09"), day("2024-03-10"), day("2024-03-12")), days.keys)
        val saturday = days.getValue(day("2024-03-09"))
        // 40 pages read, and a 520 page book finished that has no sessions of its own.
        assertEquals(560, saturday.pages)
        assertEquals(60, saturday.minutes)
        assertEquals(setOf(1L, 3L), saturday.bookIds)
        assertEquals(setOf(3L), saturday.finishedIds)
        val sunday = days.getValue(day("2024-03-10"))
        // Listening counts as time, not as pages. "Short" has a session, so its pages are not counted twice.
        assertEquals(150, sunday.pages)
        assertEquals(75 + 45 + 80, sunday.minutes)
        assertEquals(3, sunday.sessions)
        assertEquals(setOf(4L), sunday.finishedIds)
        assertEquals(10, days.getValue(day("2024-03-12")).pages)
    }

    @Test fun recapTellsTheStoryOfAMonth() {
        val purchases = listOf(
            Purchase(bookId = 1, day = day("2024-03-05"), price = 24.9, currency = "chf"),
            Purchase(bookId = 3, day = day("2024-03-20"), price = 12.0, currency = "CHF"),
            Purchase(bookId = 2, day = day("2024-03-21"), price = 9.99, currency = "EUR"),
            Purchase(bookId = 4, day = day("2024-04-02"), price = 50.0, currency = "CHF"),
        )
        val recap = Insights.recap(books, sessions, purchases, LocalDate.parse("2024-03-01"), LocalDate.parse("2024-03-31"), UTC)
        assertEquals(listOf("Old", "Short"), recap.finished.map { it.title })
        assertEquals(720, recap.pages)
        assertEquals(5, recap.sessions)
        assertEquals(3, recap.readingDays)
        assertEquals(2, recap.bestStreak)
        assertEquals(day("2024-03-09"), recap.bestDay!!.day)
        assertEquals("Old", recap.bestRated!!.title)
        assertEquals("Old", recap.longest!!.title)
        assertEquals(3.75f, recap.averageRating)
        assertEquals("Ann Author" to 1, recap.topAuthors.first())
        assertEquals("Novel" to 1, recap.topGenres.first { it.first == "Novel" })
        assertEquals(TimeOfDay.MORNING, recap.favouriteTime)
        assertEquals(7, recap.favouriteWeekday)
        // Four of five sessions fall on a weekend.
        assertEquals(ReaderType.WEEKEND_READER, recap.readerType)
        assertEquals(36.9, recap.spent.getValue("CHF"), 0.001)
        assertEquals(9.99, recap.spent.getValue("EUR"), 0.001)

        // A month without anything.
        val empty = Insights.recap(books, sessions, purchases, LocalDate.parse("2023-01-01"), LocalDate.parse("2023-01-31"), UTC)
        assertEquals(ReaderType.QUIET_SHELF, empty.readerType)
        assertTrue(empty.finished.isEmpty())
        assertNull(empty.bestDay)
        assertTrue(empty.spent.isEmpty())
    }

    @Test fun readerTypeFollowsTheTimeOfDay() {
        fun typeAt(hour: Int) = Insights.recap(
            listOf(paper), listOf(ReadingSession(bookId = 1, startedAt = at("2024-03-13", hour), startPage = 0, endPage = 10)), emptyList(),
            LocalDate.parse("2024-03-01"), LocalDate.parse("2024-03-31"), UTC,
        ).readerType
        assertEquals(ReaderType.EARLY_BIRD, typeAt(6))
        assertEquals(ReaderType.AFTERNOON_ESCAPIST, typeAt(14))
        assertEquals(ReaderType.EVENING_UNWINDER, typeAt(19))
        assertEquals(ReaderType.NIGHT_OWL, typeAt(23))
        assertEquals(ReaderType.NIGHT_OWL, typeAt(2))
    }

    @Test fun milestonesCountAndRememberWhenTheyWereReached() {
        val milestones = Milestones.compute(books, sessions, quoteCount = 12, today = LocalDate.parse("2024-03-12"), zone = UTC).associateBy { it.category }
        val finished = milestones.getValue(MilestoneCategory.BOOKS)
        assertEquals(2, finished.value)
        assertEquals(1, finished.reached)
        assertEquals(10, finished.next)
        assertEquals(1f / 9f, finished.progress, 0.001f)
        assertEquals(720, milestones.getValue(MilestoneCategory.PAGES).value)
        assertEquals(0, milestones.getValue(MilestoneCategory.PAGES).reached)
        assertEquals(5, milestones.getValue(MilestoneCategory.SESSIONS).value)
        assertEquals((60 + 75 + 45 + 80 + 15) / 60, milestones.getValue(MilestoneCategory.HOURS).value)
        assertEquals(12, milestones.getValue(MilestoneCategory.QUOTES).value)
        assertEquals(2, milestones.getValue(MilestoneCategory.QUOTES).reached)
        assertEquals(2, milestones.getValue(MilestoneCategory.STREAK).value)
        assertEquals(1, milestones.getValue(MilestoneCategory.LONG_BOOKS).value)

        val timeline = Milestones.timeline(books)
        assertEquals(2, timeline.size)
        assertTrue(timeline.all { it.book!!.title == "Old" && it.day == day("2024-03-09") && it.tier == 1 })
        assertEquals(setOf(MilestoneCategory.BOOKS, MilestoneCategory.LONG_BOOKS), timeline.map { it.category }.toSet())

        // With every tier passed there is nothing left to aim for.
        val done = ch.schmidtbit.shelfmark.data.stats.Milestone(MilestoneCategory.REVIEWS, 500, Milestones.tiers.getValue(MilestoneCategory.REVIEWS))
        assertNull(done.next)
        assertEquals(1f, done.progress)
        assertEquals(5, done.reached)
    }
}

/** Small pieces of the shelf, the theme builder and the purchase log. */
class ShelfBitsTest {
    @Test fun ornamentsStandBehindTheBookTheyFollow() {
        val kinds = listOf(3 to OrnamentKind.PLANT, 0 to OrnamentKind.MUG, 1 to OrnamentKind.CANDLE, 99 to OrnamentKind.GLOBE)
        val order = arrange(3, kinds).joinToString(" ") { (isBook, index) -> if (isBook) "b$index" else kinds[index].second.name.lowercase() }
        assertEquals("mug b0 candle b1 b2 plant globe", order)
        // An empty shelf can still hold ornaments.
        assertEquals(listOf(false to 0), arrange(0, listOf(5 to OrnamentKind.CACTUS)))
        assertEquals(listOf(true to 0, true to 1), arrange(2, emptyList()))
    }

    @Test fun theLastBookLeansWhenThereIsRoomAndSomethingToLeanOn() {
        fun spine(title: String, pages: Int = 300) = ShelfThing.Spine(ShelfItem(key = title.hashCode().toLong(), title = title, authors = "", cover = null, pageCount = pages))
        val row = listOf(spine("Emma"), spine("Dune"), spine("Momo"))
        // On a shelf that is not full the last book leans, at an angle that differs from shelf to shelf.
        val leans = (0 until 40).map { leanOf("READ", it, row, available = 300f) }
        assertTrue(leans.all { it != null })
        assertTrue(leans.map { it!!.angle }.toSet().size >= 3)
        leans.filterNotNull().forEach {
            assertTrue(it.angle in 5f..9f)
            // The foot stands out just far enough for the edge to touch the neighbour.
            assertTrue(it.offset > 5f && it.offset < 40f)
        }
        // No room, nobody to lean on, or an ornament in the way: the book stands straight.
        val full = row.sumOf { it.width.toDouble() }.toFloat() + 6f
        assertTrue((0 until 40).all { leanOf("READ", it, row, available = full) == null })
        assertTrue((0 until 40).all { leanOf("READ", it, listOf(spine("Emma")), 300f) == null })
        assertTrue((0 until 40).all { leanOf("READ", it, row + ShelfThing.Deco(OrnamentKind.PLANT), 300f) == null })
        assertTrue((0 until 40).all { leanOf("READ", it, listOf(ShelfThing.Deco(OrnamentKind.PLANT), spine("Emma")), 300f) == null })
    }

    @Test fun everyOrnamentHasASizeAndAName() {
        OrnamentKind.entries.forEach { kind ->
            val (width, height) = ornamentSize(kind)
            assertTrue("$kind", width in 20f..80f && height in 30f..95f)
            assertTrue("$kind", kind.labelRes() != 0)
        }
        assertEquals(14, OrnamentKind.entries.size)
    }

    @Test fun coloursAreWrittenAndReadAsHex() {
        assertEquals("#1F1A17", hexOf(0xFF1F1A17.toInt()))
        assertEquals(0xFF1F1A17.toInt(), parseHex("#1f1a17"))
        assertEquals(0xFFE5873F.toInt(), parseHex(" E5873F "))
        assertNull(parseHex("#12345"))
        assertNull(parseHex("#12345G"))
        assertNull(parseHex(""))
    }

    @Test fun aThemeOfOnesOwnIsFoundByItsKey() {
        val mine = CustomTheme("abc", "Moor", 0xFF101510.toInt(), 0xFF1C241C.toInt(), 0xFF7BC47F.toInt(), 0xFFE8F0E8.toInt())
        assertEquals("custom:abc", mine.key)
        val preset = presetFor(mine.key, systemDark = false, custom = listOf(mine))
        assertEquals("Moor", preset.name)
        assertTrue(preset.dark)
        // A theme that was deleted falls back to the default for the system setting.
        assertEquals("paper", presetFor(mine.key, systemDark = false).key)
        assertEquals("ember", presetFor(mine.key, systemDark = true).key)
    }

    @Test fun pricesAreShownWithTheirCurrency() {
        val number = String.format(java.util.Locale.getDefault(), "%.2f", 24.9)
        assertEquals("$number CHF", formatPrice(24.9, " CHF "))
        // Without a currency there is no stray space.
        assertEquals(number, formatPrice(24.9, ""))
    }
}

/** A catalogue that knows covers for exactly one book. */
private object CoverCatalogue : BookSource {
    override val name = "covers"
    override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> =
        if (query.contains("momo", ignoreCase = true)) listOf(RemoteBook(title = "Momo", authors = listOf("Michael Ende"), coverUrl = "https://covers.example/momo.jpg")) else emptyList()

    override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? = null
}

/** The parts that need a database: importing, purchases, ornaments, covers, themes. */
@RunWith(RobolectricTestRunner::class)
class PortedFeaturesTest {
    @get:Rule val folder = TemporaryFolder()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val db = AppDatabase.inMemory(context)
    private val covers = CoverStore(context)
    private val library = LibraryRepository(db, covers)

    @After fun tearDown() {
        db.close()
        scope.cancel()
    }

    @Test fun importAddsNewBooksAndCompletesKnownOnes() = runBlocking {
        val knownId = library.addBook(Book(title = "Dune", authors = "Frank Herbert", rating = 3f, review = "My own words"))
        library.createShelf("Sci-Fi")
        val plan = CsvImporter.parse(fixture("goodreads_export.csv"), UTC)!!
        assertEquals(2 to 1, library.previewImport(plan))
        assertEquals(2 to 1, library.importBooks(plan))

        val books = library.allBooks()
        assertEquals(setOf("Dune", "Der Vorleser", "Momo"), books.map { it.title }.toSet())
        val dune = books.first { it.id == knownId }
        assertEquals("9780441172719", dune.isbn)
        assertEquals(896, dune.pageCount)
        assertEquals(3f, dune.rating)
        assertEquals("My own words", dune.review)
        // Lists named in the file exist afterwards, an existing one is reused whatever its case.
        val shelves = library.shelves.first()
        assertEquals(setOf("Sci-Fi", "favorites"), shelves.map { it.name }.toSet())
        assertEquals(shelves.map { it.id }.toSet(), library.shelfIdsOf(knownId).first().toSet())

        // Importing the same file again changes nothing.
        assertEquals(0 to 3, library.previewImport(plan))
        assertEquals(0 to 0, library.importBooks(plan))
        assertEquals(3, library.allBooks().size)
    }

    @Test fun aBookTheFileNamesTwiceIsOneBookWithEverythingBothRowsKnow() = runBlocking {
        val knownId = library.addBook(Book(title = "Dune", authors = "Frank Herbert"))
        val csv = "title,author,pages,isbn,publisher\n" +
            "Dune,Frank Herbert,896,,\n" +
            "Dune,Frank Herbert,,9780441172719,Ace\n" +
            "Momo,Michael Ende,304,,\n" +
            "Momo,Michael Ende,,9783522202558,\n"
        val plan = CsvImporter.parse(csv, UTC)!!
        assertEquals(4, plan.books.size)
        // One new book, and three rows about books that are known by then.
        assertEquals(1 to 3, library.previewImport(plan))
        // One book added, one completed: books are counted, not rows.
        assertEquals(1 to 1, library.importBooks(plan))
        val books = library.allBooks()
        assertEquals(2, books.size)
        val dune = books.first { it.id == knownId }
        // What the first row added is still there after the second one.
        assertEquals(896, dune.pageCount)
        assertEquals("9780441172719", dune.isbn)
        assertEquals("Ace", dune.publisher)
        assertEquals(0 to 4, library.previewImport(plan))
    }

    @Test fun aFewThousandRowsAreImportedWithoutTheAppStandingStill() = runBlocking {
        // A library that is large already, and a file that is larger: half of its rows are known, by ISBN or by title and author.
        val owned = (0 until 3000).map { Book(title = "Band $it", authors = "Autorin ${it % 70}", isbn = if (it % 2 == 0) "9783" + (100000000 + it) else "") }
        db.withTransaction { owned.forEach { db.books().insert(it.copy(id = Ids.next())) } }
        val rows = (0 until 6000).map { n ->
            val known = n % 2 == 0
            val at = n / 2
            PlannedBook(
                if (known) Book(title = "BAND $at", authors = "autorin ${at % 70}, und andere", isbn = if (at % 4 == 0) "9783" + (100000000 + at) else "", pageCount = 100 + at)
                else Book(title = "Neuzugang $at", authors = "Autor ${at % 90}", pageCount = 200),
                lists = if (n % 1000 == 0) listOf("Gross") else emptyList(),
            )
        }
        val plan = ImportPlan("Test", rows)
        val started = System.nanoTime()
        assertEquals(3000 to 3000, library.previewImport(plan))
        // Every known book gains its number of pages, every new one is added once.
        assertEquals(3000 to 3000, library.importBooks(plan))
        val seconds = (System.nanoTime() - started) / 1e9
        // Row by row against the whole library this took minutes. A phone is slower than this machine, but not by that much.
        assertTrue("took $seconds s", seconds < 30)
        val books = library.allBooks()
        assertEquals(6000, books.size)
        assertEquals(100 + 17, books.single { it.title == "Band 17" }.pageCount)
        assertEquals(1, books.count { it.title == "Neuzugang 2999" })
        // The list the file names exists once, with the six books that are on it.
        assertEquals("Gross", library.shelves.first().single().name)
        assertEquals(6, library.links.first().size)
        // A second time, nothing is new and nothing changes.
        assertEquals(0 to 6000, library.previewImport(plan))
        assertEquals(0 to 0, library.importBooks(plan))
    }

    @Test fun aLibraryIsOnlyReplacedWhileItIsStillTheOneThatWasLookedAt() = runBlocking {
        val backup = BackupManager(db, covers)
        val emma = library.addBook(Book(title = "Emma"))
        val seen = backup.snapshot(at = 0)
        val other = seen.copy(books = listOf(Book(id = 99, title = "Dune", addedAt = 1, updatedAt = 1)))

        // The reader gave Emma stars after the look. Nothing is written over that.
        library.modify(emma) { it.copy(rating = 5f) }
        assertNull(backup.restore(other, onlyIf = seen))
        assertEquals(5f, library.getBook(emma)!!.rating)
        // The same for something that belongs to the book, and for a list.
        val now = backup.snapshot(at = 0)
        library.saveQuote(Quote(bookId = emma, text = "It is a truth universally acknowledged."))
        assertNull(backup.restore(other, onlyIf = now))
        assertEquals(1, library.quotes.first().size)

        // What has to change along with the library and cannot leaves the library as it was.
        val fresh = backup.snapshot(at = 0)
        assertNull(backup.restore(other, onlyIf = fresh) { false })
        assertEquals(listOf("Emma"), library.allBooks().map { it.title })
        assertEquals(1, library.quotes.first().size)

        // Unchanged since the look, it is replaced, and what stands there afterwards is told.
        val written = backup.restore(other, onlyIf = fresh)!!
        assertEquals(listOf("Dune"), written.books.map { it.title })
        assertEquals(listOf("Dune"), library.allBooks().map { it.title })
        assertTrue(library.quotes.first().isEmpty())
    }

    @Test fun aLibraryThatIsReplacedIsPutAsideAndTheLastThreeAreKept() = runBlocking {
        val backup = BackupManager(db, covers)
        val dir = File(folder.root, "replaced")
        assertTrue(backup.replaced(dir).isEmpty())
        covers.file("photo.jpg").writeBytes(byteArrayOf(1, 2, 3))
        for (n in 1..5) {
            val going = BackupPayload(exportedAt = 0, books = listOf(Book(id = n.toLong(), title = "Bibliothek $n", coverPath = "photo.jpg", addedAt = 1, updatedAt = 1)), shelves = emptyList(), links = emptyList(), quotes = emptyList())
            val file = backup.keepReplaced(going, dir, at = 1_000L * n)!!
            assertEquals(1_000L * n, BackupManager.replacedAt(file))
        }
        // The newest first, and no more than three.
        val kept = backup.replaced(dir)
        assertEquals(listOf(5_000L, 4_000L, 3_000L), kept.map { BackupManager.replacedAt(it) })
        // Each is a backup like any other: the import reads it, and restoring it brings the library and its photos back.
        val (inside, _) = kept.first().inputStream().use { backup.inspect(it) }
        assertEquals(listOf("Bibliothek 5"), inside!!.books.map { it.title })
        covers.file("photo.jpg").delete()
        assertEquals(1, kept.last().inputStream().use { backup.restore(it) })
        assertEquals(listOf("Bibliothek 3"), library.allBooks().map { it.title })
        assertTrue(covers.file("photo.jpg").exists())
        // A place that cannot be written to costs the backup, not the app.
        assertNull(backup.keepReplaced(inside, File(folder.newFile("no-folder"), "below"), at = 9_000))
    }

    @Test fun aBackupThatCouldNotBeWrittenIsNotCalledSaved() = runBlocking {
        val backup = BackupManager(db, covers)
        library.addBook(Book(title = "Emma"))
        // Written to the end: saved.
        val bytes = ByteArrayOutputStream()
        assertTrue(backup.exportTo { bytes })
        assertEquals(listOf("Emma"), backup.inspect(ByteArrayInputStream(bytes.toByteArray())).first!!.books.map { it.title })
        // The place gives no way in, as a document provider may.
        assertFalse(backup.exportTo { null })
        // The place refuses, or is gone.
        assertFalse(backup.exportTo { throw SecurityException("no permission for this document") })
        assertFalse(backup.exportTo { throw java.io.FileNotFoundException("the drive is not there") })
        // The place breaks off half way.
        val broken = object : java.io.OutputStream() {
            var room = 20
            override fun write(b: Int) { if (room-- <= 0) throw java.io.IOException("No space left on device") }
        }
        assertFalse(backup.exportTo { broken })
    }

    @Test fun aZipOfTablesIsSearchedForTheBooks() = runBlocking {
        val zip = ByteArrayOutputStream().also { bytes ->
            ZipOutputStream(bytes).use { out ->
                out.putNextEntry(ZipEntry("export/quotes.csv")); out.write("book_title,quote\nDune,Fear is the mind-killer.\nDune,Second\nDune,Third\nDune,Fourth\n".toByteArray()); out.closeEntry()
                out.putNextEntry(ZipEntry("export/books.csv")); out.write("title,author,pages\nDune,Frank Herbert,896\nMomo,Michael Ende,304\n".toByteArray()); out.closeEntry()
            }
        }.toByteArray()
        val (backup, plan) = BackupManager(db, covers).inspect(ByteArrayInputStream(zip))
        assertNull(backup)
        assertEquals(listOf("Dune", "Momo"), plan!!.books.map { it.book.title })
        assertEquals(896, plan.books.first().book.pageCount)
    }

    @Test fun purchasesAndOrnamentsSurviveABackup() = runBlocking {
        val bookId = library.addBook(Book(title = "Dune", status = ReadingStatus.READ))
        val purchaseId = library.savePurchase(Purchase(bookId = bookId, day = day("2024-03-05"), price = 24.9, currency = "CHF", store = "Orell Füssli"))
        library.savePurchase(Purchase(id = purchaseId, bookId = bookId, day = day("2024-03-05"), price = 19.9, currency = "CHF", store = "Orell Füssli"))
        val plantId = library.addOrnament("READ", OrnamentKind.PLANT, 1)
        library.addOrnament("READ", OrnamentKind.MUG, -4)
        library.moveOrnament(library.ornaments.first().first { it.id == plantId }, 3)
        assertEquals(listOf(19.9), library.purchasesOf(bookId).first().map { it.price })
        assertEquals(mapOf(OrnamentKind.PLANT to 3, OrnamentKind.MUG to 0), library.ornaments.first().associate { it.kind to it.position })

        val zip = ByteArrayOutputStream().also { BackupManager(db, covers).export(it) }.toByteArray()
        val other = AppDatabase.inMemory(context)
        try {
            val restoredLibrary = LibraryRepository(other, covers)
            assertEquals(1, BackupManager(other, covers).restore(ByteArrayInputStream(zip)))
            val restored = restoredLibrary.allBooks().single()
            assertEquals("Orell Füssli", restoredLibrary.purchasesOf(restored.id).first().single().store)
            assertEquals(2, restoredLibrary.ornaments.first().size)
        } finally {
            other.close()
        }

        // A purchase belongs to its book and goes with it.
        library.deleteBook(bookId)
        assertTrue(library.purchases.first().isEmpty())
        library.deleteOrnament(plantId)
        assertEquals(listOf(OrnamentKind.MUG), library.ornaments.first().map { it.kind })
    }

    @Test fun booksWithoutCoverGetOneInTheBackground() = runBlocking {
        val container = AppContainer(
            context = context,
            database = db,
            lookupOverride = BookLookup(listOf(CoverCatalogue)),
            settingsStore = PreferenceDataStoreFactory.create(scope = scope) { java.io.File(folder.root, "covers.preferences_pb") },
            coverProbeOverride = ImageProbe { false },
        )
        val momo = container.library.addBook(Book(title = "Momo", authors = "Michael Ende"))
        val unknown = container.library.addBook(Book(title = "Nobody Knows This One"))
        val mine = container.library.addBook(Book(title = "Momo", authors = "Michael Ende", coverUrl = "https://my.example/own.jpg"))
        container.findCoverLater(momo)
        container.findCoverLater(mine)
        waitUntil { container.library.getBook(momo)!!.coverUrl.isNotBlank() }
        assertEquals("https://covers.example/momo.jpg", container.library.getBook(momo)!!.coverUrl)
        assertEquals("https://my.example/own.jpg", container.library.getBook(mine)!!.coverUrl)

        // The tool for a whole library reports how far it is and ends by itself.
        container.library.modify(momo) { it.copy(coverUrl = "") }
        container.findMissingCovers()
        waitUntil { container.library.getBook(momo)!!.coverUrl.isNotBlank() && container.coverJob.value == null }
        assertEquals("", container.library.getBook(unknown)!!.coverUrl)
        assertEquals(listOf("Nobody Knows This One"), container.library.booksWithoutCover().map { it.title })
    }

    @Test fun themesOfOnesOwnAreKeptAndCanBeDeleted() = runBlocking {
        val settings = SettingsRepository(PreferenceDataStoreFactory.create(scope = scope) { java.io.File(folder.root, "themes.preferences_pb") })
        val moor = CustomTheme("abc", "Moor", 0xFF101510.toInt(), 0xFF1C241C.toInt(), 0xFF7BC47F.toInt(), 0xFFE8F0E8.toInt())
        settings.saveCustomTheme(moor)
        settings.saveCustomTheme(CustomTheme("def", "Sand", 0xFFF4EAD5.toInt(), 0xFFFFF8E7.toInt(), 0xFFB5651D.toInt(), 0xFF2B2118.toInt()))
        settings.setTheme(moor.key)
        // Saving again under the same id replaces the theme.
        settings.saveCustomTheme(moor.copy(name = "Hochmoor"))
        assertEquals(listOf("Sand", "Hochmoor"), settings.current().customThemes.map { it.name })
        assertEquals("custom:abc", settings.current().theme)

        // Deleting the theme in use falls back to the system default.
        settings.deleteCustomTheme("abc")
        assertEquals(listOf("Sand"), settings.current().customThemes.map { it.name })
        assertEquals(Settings.THEME_SYSTEM, settings.current().theme)
        assertNotNull(settings.current().customThemes.single().toString())
    }

    private suspend fun waitUntil(timeoutMs: Long = 10_000, condition: suspend () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            check(System.currentTimeMillis() < end) { "condition not met in time" }
            // The app's own work runs on the main thread, which a test has to turn by hand.
            org.robolectric.shadows.ShadowLooper.idleMainLooper(100, java.util.concurrent.TimeUnit.MILLISECONDS)
            kotlinx.coroutines.delay(10)
        }
    }
}
