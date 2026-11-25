package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Away
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.away
import ch.schmidtbit.shelfmark.data.model.withStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which books are drawn away, see "Books that are away" in supabase/README.md. The website has the same cases. */
class AwayTest {
    private val mine = Book(title = "Dune", authors = "Frank Herbert", pageCount = 600)
    private val loan = "3f9a52c1-0b6e-4a43-9d1e-5c2b8e7f0a11"

    @Test fun aBookAtHomeIsHere() {
        assertNull(mine.away)
        assertNull(mine.copy(status = ReadingStatus.READ).away)
        assertNull(mine.copy(lendable = false).away)
    }

    @Test fun aBookLentByHandIsAwayUntilItIsBack() {
        val lent = mine.copy(lentTo = "Bo", lentSince = 20_000)
        assertEquals(Away.LENT, lent.away)
        // "Got it back" empties the name, and the book is here again.
        assertNull(lent.copy(lentTo = "", lentSince = null).away)
    }

    @Test fun aBookLentThroughALoanIsAwayWhileTheLoanIsOut() {
        // What the rules of a loan write on the lender's book when it is out, also for a friend without a name.
        assertEquals(Away.LENT, mine.copy(lentTo = "Ben", lentSince = 20_000, loanId = loan).away)
        assertEquals(Away.LENT, mine.copy(lentTo = "?", loanId = loan).away)
        // And what they leave once the loan is over.
        assertNull(mine.copy(lentTo = "", lentSince = null, loanId = "").away)
    }

    @Test fun aNameOfBlanksLendsNothing() {
        assertNull(mine.copy(lentTo = "   ").away)
    }

    @Test fun aLentBookIsAwayWhateverItsList() {
        ReadingStatus.entries.forEach { status ->
            assertEquals(status.name, Away.LENT, mine.copy(lentTo = "Bo", status = status).away)
        }
    }

    @Test fun aBorrowedBookIsHereWhileTheReaderHasIt() {
        ReadingStatus.entries.forEach { status ->
            assertNull(status.name, mine.copy(ownership = Ownership.BORROWED, borrowedFrom = "Anna", loanId = loan, status = status).away)
            assertNull(status.name, mine.copy(ownership = Ownership.BORROWED, borrowedFrom = "Anna", status = status).away)
        }
    }

    @Test fun aCopyGivenBackUnfinishedIsAwayInEveryListButRead() {
        val givenBack = mine.copy(ownership = Ownership.NOT_OWNED, borrowedFrom = "Anna", loanId = loan)
        listOf(ReadingStatus.NONE, ReadingStatus.WISHLIST, ReadingStatus.READING, ReadingStatus.ABANDONED).forEach { status ->
            assertEquals(status.name, Away.RETURNED, givenBack.copy(status = status).away)
        }
        assertNull(givenBack.copy(status = ReadingStatus.READ).away)
    }

    @Test fun aBookBorrowedByHandAndGivenBackCountsTheSame() {
        val givenBack = mine.copy(ownership = Ownership.NOT_OWNED, borrowedFrom = "Lena")
        assertEquals(Away.RETURNED, givenBack.copy(status = ReadingStatus.READING).away)
        assertEquals(Away.RETURNED, givenBack.copy(status = ReadingStatus.NONE).away)
        assertNull(givenBack.copy(status = ReadingStatus.READ).away)
    }

    @Test fun aCopyFromALoanWithoutANameIsGivenBackAllTheSame() {
        assertEquals(Away.RETURNED, mine.copy(ownership = Ownership.NOT_OWNED, loanId = loan, status = ReadingStatus.READING).away)
    }

    @Test fun markingItReadMakesItSolid() {
        val givenBack = mine.copy(ownership = Ownership.NOT_OWNED, borrowedFrom = "Anna", loanId = loan, status = ReadingStatus.READING)
        assertEquals(Away.RETURNED, givenBack.away)
        assertNull(givenBack.withStatus(ReadingStatus.READ, 20_100).away)
        // Reading it again puts it back out of reach.
        assertEquals(Away.RETURNED, givenBack.withStatus(ReadingStatus.READ, 20_100).withStatus(ReadingStatus.READING, 20_200).away)
    }

    @Test fun aWishOrALibraryCopyThatWasNeverBorrowedIsHere() {
        listOf(ReadingStatus.WISHLIST, ReadingStatus.NONE, ReadingStatus.READING).forEach { status ->
            assertNull(status.name, mine.copy(ownership = Ownership.NOT_OWNED, status = status).away)
            assertNull(status.name, mine.copy(ownership = Ownership.NOT_OWNED, borrowedFrom = "  ", status = status).away)
        }
    }

    @Test fun aBookOfMineThatOnceCameThroughALoanIsHere() {
        // Bought after borrowing it: mine, whatever the loan left on it.
        assertNull(mine.copy(ownership = Ownership.OWNED, borrowedFrom = "Anna", loanId = loan, status = ReadingStatus.READING).away)
    }
}
