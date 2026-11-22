package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingMath
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.repo.SortOrder
import ch.schmidtbit.shelfmark.data.stats.GoalMath
import ch.schmidtbit.shelfmark.data.stats.StatsCalculator
import ch.schmidtbit.shelfmark.ui.components.nextRating
import ch.schmidtbit.shelfmark.ui.components.packRows
import ch.schmidtbit.shelfmark.ui.library.LibraryFilter
import ch.schmidtbit.shelfmark.ui.library.LibraryLogic
import ch.schmidtbit.shelfmark.util.BarcodeDecoder
import ch.schmidtbit.shelfmark.util.OcrText
import com.google.zxing.BarcodeFormat
import com.google.zxing.oned.EAN13Writer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class LogicTest {
    // ---- barcode ----

    /** Draws an EAN-13 barcode into a greyscale frame, the way the camera would see it. */
    private fun barcodeFrame(code: String, width: Int = 640, height: Int = 360): ByteArray {
        val matrix = EAN13Writer().encode(code, BarcodeFormat.EAN_13, 380, 120)
        val frame = ByteArray(width * height) { 0xE6.toByte() }
        val left = (width - matrix.width) / 2
        val top = (height - matrix.height) / 2
        for (y in 0 until matrix.height) for (x in 0 until matrix.width) {
            if (matrix[x, y]) frame[(top + y) * width + left + x] = 0x14
        }
        return frame
    }

    @Test fun scannerReadsAnIsbnBarcode() {
        assertEquals("9783257229530", BarcodeDecoder.decodeIsbn(barcodeFrame("9783257229530"), 640, 360))
    }

    @Test fun scannerReadsABarcodeThatLiesSidewaysInTheFrame() {
        // Phone held upright: the sensor delivers the picture turned by 90 degrees.
        val sideways = BarcodeDecoder.rotate90(barcodeFrame("9780441172719"), 640, 360)
        assertEquals("9780441172719", BarcodeDecoder.decodeIsbn(sideways, 360, 640))
    }

    @Test fun scannerIgnoresBarcodesThatAreNotBooks() {
        assertNull(BarcodeDecoder.decodeIsbn(barcodeFrame("4006381333931"), 640, 360))
        assertNull(BarcodeDecoder.decodeIsbn(ByteArray(640 * 360) { 0x7F }, 640, 360))
    }

    // ---- OCR ----

    @Test fun ocrLinesBecomeRunningText() {
        assertEquals(
            "Die unendliche Geschichte beginnt in einem Antiquariat.",
            OcrText.join(listOf("Die unendliche Geschich-", "te beginnt in einem", " Antiquariat. ", "")),
        )
        // A hyphen before a capital letter is a real compound and stays.
        assertEquals("Reise nach Nord- Amerika", OcrText.join(listOf("Reise nach Nord-", "Amerika")))
        assertEquals("", OcrText.join(emptyList()))
    }

    // ---- library ----

    private val books = listOf(
        Book(id = 1, title = "The Hobbit", authors = "J. R. R. Tolkien", status = ReadingStatus.READ, rating = 5f, addedAt = 10),
        Book(id = 2, title = "Der Vorleser", authors = "Bernhard Schlink", status = ReadingStatus.READING, rating = 3f, addedAt = 30),
        Book(id = 3, title = "Emma", authors = "Jane Austen", status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED, addedAt = 20),
        Book(id = 4, title = "Dune", authors = "Frank Herbert", lentTo = "Ben", addedAt = 40),
        Book(id = 5, title = "Momo", authors = "Michael Ende", ownership = Ownership.BORROWED, addedAt = 50),
    )
    private val links = listOf(BookShelf(1, 7), BookShelf(4, 7))

    private fun titles(filter: LibraryFilter, query: String = "", sort: SortOrder = SortOrder.TITLE) =
        LibraryLogic.apply(books, links, filter, query, sort).map { it.title }

    @Test fun filtersByListStatusAndOwnership() {
        assertEquals(listOf("Dune", "Emma", "The Hobbit", "Momo", "Der Vorleser"), titles(LibraryFilter.All))
        assertEquals(listOf("The Hobbit"), titles(LibraryFilter.Status(ReadingStatus.READ)))
        assertEquals(listOf("Emma"), titles(LibraryFilter.Status(ReadingStatus.WISHLIST)))
        assertEquals(listOf("Dune", "The Hobbit"), titles(LibraryFilter.OnShelf(7)))
        assertEquals(listOf("Dune"), titles(LibraryFilter.LentOut))
        assertEquals(listOf("Momo"), titles(LibraryFilter.Borrowed))
    }

    @Test fun searchMatchesTitleAndAuthor() {
        assertEquals(listOf("Der Vorleser"), titles(LibraryFilter.All, "schlink"))
        assertEquals(listOf("The Hobbit"), titles(LibraryFilter.All, "tolkien hob"))
        assertTrue(titles(LibraryFilter.All, "xyz").isEmpty())
    }

    @Test fun sortsIgnoreArticlesAndUseSurnames() {
        assertEquals(listOf("Momo", "Dune", "Der Vorleser", "Emma", "The Hobbit"), titles(LibraryFilter.All, sort = SortOrder.ADDED))
        assertEquals(listOf("Emma", "Momo", "Dune", "Der Vorleser", "The Hobbit"), titles(LibraryFilter.All, sort = SortOrder.AUTHOR))
        assertEquals("The Hobbit", titles(LibraryFilter.All, sort = SortOrder.RATING).first())
    }

    @Test fun spinesArePackedIntoRowsThatFit() {
        assertEquals(listOf(0..2, 3..4), packRows(listOf(40f, 40f, 40f, 40f, 40f), maxWidth = 130f, gap = 2f))
        assertEquals(listOf(0..0, 1..1), packRows(listOf(200f, 200f), maxWidth = 130f, gap = 2f))
        assertTrue(packRows(emptyList(), 100f, 2f).isEmpty())
    }

    @Test fun tappingStarsCyclesWholeHalfClear() {
        assertEquals(4f, nextRating(0f, 4))
        assertEquals(3.5f, nextRating(4f, 4))
        assertEquals(0f, nextRating(3.5f, 4))
        assertEquals(2f, nextRating(4f, 2))
    }

    // ---- reading pace ----

    @Test fun timeLeftUsesMeasuredPaceWhenThereIsOne() {
        val book = Book(id = 1, title = "Dune", pageCount = 300, currentPage = 100)
        // No timed session: the reader's general speed of 1.5 minutes a page.
        assertEquals(300, ReadingMath.minutesLeft(book, emptyList(), 1.5f))
        // 40 pages in 80 minutes: 2 minutes a page for this book.
        val timed = listOf(ReadingSession(bookId = 1, startPage = 60, endPage = 100, minutes = 80f))
        assertEquals(400, ReadingMath.minutesLeft(book, timed, 1.5f))
        assertNull(ReadingMath.minutesLeft(book.copy(currentPage = 300), timed, 1.5f))
        assertNull(ReadingMath.minutesLeft(book.copy(pageCount = 0), timed, 1.5f))
    }

    // ---- statistics and goals ----

    private val zone = ZoneOffset.UTC
    private fun day(date: String) = LocalDate.parse(date).toEpochDay()
    private fun at(date: String) = LocalDate.parse(date).atTime(20, 0).toInstant(ZoneOffset.UTC).toEpochMilli()

    private val statBooks = listOf(
        Book(id = 1, title = "A", authors = "Jane Austen", pageCount = 300, status = ReadingStatus.READ, readCount = 1, finishedOn = day("2026-03-10"), rating = 4.5f, spice = 2, format = BookFormat.PAPERBACK, genres = "Classics, Romance"),
        Book(id = 2, title = "B", authors = "Jane Austen", pageCount = 200, status = ReadingStatus.READ, readCount = 1, finishedOn = day("2026-03-20"), rating = 3f, format = BookFormat.HARDCOVER, genres = "Classics"),
        Book(id = 3, title = "C", authors = "Frank Herbert", pageCount = 600, status = ReadingStatus.READING, format = BookFormat.PAPERBACK),
        Book(id = 4, title = "D", authors = "Old One", pageCount = 100, status = ReadingStatus.READ, readCount = 1, finishedOn = day("2025-12-01")),
    )
    private val statSessions = listOf(
        ReadingSession(id = 1, bookId = 1, startedAt = at("2026-03-08"), startPage = 0, endPage = 100, minutes = 120f),
        ReadingSession(id = 2, bookId = 1, startedAt = at("2026-03-09"), startPage = 100, endPage = 250, minutes = 0f),
        ReadingSession(id = 3, bookId = 1, startedAt = at("2026-03-10"), startPage = 250, endPage = 300, minutes = 60f),
        ReadingSession(id = 4, bookId = 3, startedAt = at("2026-11-21"), startPage = 0, endPage = 40, minutes = 50f),
    )

    @Test fun yearStatisticsCountBooksPagesAndTime() {
        val stats = StatsCalculator.compute(statBooks, statSessions, quoteCount = 3, today = LocalDate.parse("2026-11-22"), zone = zone)
        assertEquals(2, stats.thisYear.booksFinished)
        // Sessions of book 1 (300) and 3 (40), plus book 2 which was ticked off without sessions (200).
        assertEquals(540, stats.thisYear.pagesRead)
        assertEquals(230, stats.thisYear.minutesRead)
        assertEquals(4, stats.thisYear.sessions)
        assertEquals(2, stats.thisYear.booksPerMonth[2])
        assertEquals(500, stats.thisYear.pagesPerMonth[2])
        assertEquals(1, stats.lastYear.booksFinished)
        assertEquals(100, stats.lastYear.pagesRead)
        assertEquals(3.75f, stats.averageRating)
        assertEquals("Jane Austen" to 2, stats.topAuthors.first())
        assertEquals("Classics" to 2, stats.topGenres.first())
        assertEquals(listOf(0, 0, 1, 0, 1), stats.byRating)
    }

    @Test fun streaksCountConsecutiveDays() {
        assertEquals(3 to 3, StatsCalculator.streaks(setOf(10, 11, 12), today = 12))
        // Nothing read today yet: yesterday's streak still stands.
        assertEquals(3 to 3, StatsCalculator.streaks(setOf(10, 11, 12), today = 13))
        // A whole day missed: the current streak is gone, the record stays.
        assertEquals(0 to 3, StatsCalculator.streaks(setOf(10, 11, 12), today = 14))
        assertEquals(1 to 4, StatsCalculator.streaks(setOf(1, 2, 3, 4, 9), today = 9))
        assertEquals(0 to 0, StatsCalculator.streaks(emptySet(), today = 5))
    }

    @Test fun yearlyBookGoalTracksProgressAndPace() {
        val goal = Goal(id = 1, kind = GoalKind.BOOKS, target = 12, startDay = 0, endDay = 0, repeat = GoalRepeat.YEARLY)
        val progress = GoalMath.progress(goal, statBooks, statSessions, LocalDate.parse("2026-11-22"), zone)
        assertEquals(day("2026-01-01"), progress.start)
        assertEquals(day("2026-12-31"), progress.end)
        assertEquals(2, progress.done)
        assertEquals(40, progress.daysLeft)
        assertFalse(progress.reached)
        assertFalse(progress.ahead)        // 2 of 12 with the year almost over
        assertEquals(0.25f, progress.perDay)
    }

    @Test fun pageAndTimeGoalsUseTheirOwnPeriods() {
        val today = LocalDate.parse("2026-11-22")   // a Sunday
        val weekly = Goal(id = 2, kind = GoalKind.PAGES, target = 30, startDay = 0, endDay = 0, repeat = GoalRepeat.WEEKLY)
        val week = GoalMath.progress(weekly, statBooks, statSessions, today, zone)
        assertEquals(day("2026-11-16"), week.start)
        assertEquals(day("2026-11-22"), week.end)
        assertEquals(40, week.done)
        assertTrue(week.reached)

        val once = Goal(id = 3, kind = GoalKind.MINUTES, target = 600, startDay = day("2026-03-01"), endDay = day("2026-03-31"))
        val march = GoalMath.progress(once, statBooks, statSessions, today, zone)
        assertEquals(180, march.done)
        assertEquals(0, march.daysLeft)
        assertNull(march.perDay)

        val daily = Goal(id = 4, kind = GoalKind.PAGES, target = 20, startDay = 0, endDay = 0, repeat = GoalRepeat.DAILY)
        assertEquals(0, GoalMath.progress(daily, statBooks, statSessions, today, zone).done)
        assertEquals(40, GoalMath.progress(daily, statBooks, statSessions, LocalDate.parse("2026-11-21"), zone).done)
    }
}
