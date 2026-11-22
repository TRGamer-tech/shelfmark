package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.progress
import ch.schmidtbit.shelfmark.data.model.withDefaultsFor
import ch.schmidtbit.shelfmark.data.model.withStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BookRulesTest {
    private val book = Book(title = "Dune", pageCount = 600)

    @Test fun startingStampsStartDate() {
        val reading = book.withStatus(ReadingStatus.READING, today = 100)
        assertEquals(100L, reading.startedOn)
        assertNull(reading.finishedOn)
    }

    @Test fun finishingStampsEndDateAndFillsProgress() {
        val read = book.withStatus(ReadingStatus.READING, 100).withStatus(ReadingStatus.READ, 120)
        assertEquals(100L, read.startedOn)
        assertEquals(120L, read.finishedOn)
        assertEquals(600, read.currentPage)
        assertEquals(1f, read.progress)
    }

    @Test fun datesTheUserEnteredAreKept() {
        val read = book.copy(startedOn = 5, finishedOn = 9).withStatus(ReadingStatus.READ, 120)
        assertEquals(5L, read.startedOn)
        assertEquals(9L, read.finishedOn)
    }

    @Test fun rereadingStartsOverAndCountsTheSecondRead() {
        val first = book.copy(startedOn = 5).withStatus(ReadingStatus.READ, 9)
        assertEquals(1, first.readCount)
        val again = first.withStatus(ReadingStatus.READING, 200)
        assertEquals(200L, again.startedOn)
        assertNull(again.finishedOn)
        assertEquals(0, again.currentPage)
        assertEquals(2, again.withStatus(ReadingStatus.READ, 230).readCount)
    }

    @Test fun wishlistBooksAreNotOwned() {
        assertEquals(Ownership.NOT_OWNED, book.withDefaultsFor(ReadingStatus.WISHLIST, 1).ownership)
        assertEquals(Ownership.OWNED, book.withDefaultsFor(ReadingStatus.READING, 1).ownership)
    }

    @Test fun onlyPhysicalOwnedBooksNotOnLoanCanBeLent() {
        assertTrue(book.withDefaultsFor(ReadingStatus.NONE, 1).availableToLend)
        assertFalse(book.copy(format = BookFormat.EBOOK).withDefaultsFor(ReadingStatus.NONE, 1).availableToLend)
        assertFalse(book.copy(ownership = Ownership.BORROWED).availableToLend)
        assertFalse(book.copy(lentTo = "Anna").availableToLend)
        assertFalse(book.withDefaultsFor(ReadingStatus.WISHLIST, 1).availableToLend)
    }
}
