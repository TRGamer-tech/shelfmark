package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanAction
import ch.schmidtbit.shelfmark.data.model.LoanNewsKind
import ch.schmidtbit.shelfmark.data.model.LoanRules
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.repo.LoanBooks
import ch.schmidtbit.shelfmark.data.repo.VaultMerge
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

/**
 * The books follow the loans: the four rules of "Loans" in supabase/README.md, one by one.
 * The website has to come to the same books from the same loans.
 */
class LoanBooksTest {
    private val zone = ZoneId.of("Europe/Zurich")
    private val now = 1_795_500_000_000L
    // 23 November 2026, a quarter past three at night in Zurich.
    private val received = 1_795_400_000_000L
    private val receivedDay = 20_780L
    private val loanId = "3f2a9c1e-7b4d-4e8a-9c0d-112233445566"
    private val copyId = 1_111_235_846_714_580L

    private fun loan(lender: Boolean, state: LoanState, id: String = loanId, bookId: Long = 7, peerName: String = if (lender) "Ben" else "Anna") = Loan(
        id = id, lender = lender, peerId = "peer", peerName = peerName, bookId = bookId,
        title = "Emma", authors = "Jane Austen, Fiona Stafford", isbn = "9780141439587", coverUrl = "https://example.org/emma.jpg", pageCount = 474, format = BookFormat.PAPERBACK,
        state = state, askedAt = received - 5_000,
        receivedAt = received.takeIf { state.out || state == LoanState.RETURNED },
        updatedAt = received,
    )

    private fun follow(library: List<Book>, loans: List<Loan>, shared: List<FriendBook> = emptyList(), at: Long = now): List<Book> = LoanBooks.follow(library, loans, shared, at, zone)

    /** The library as it is once the changes are written. */
    private fun apply(library: List<Book>, changed: List<Book>): List<Book> = (library.filter { old -> changed.none { it.id == old.id } } + changed).sortedBy { it.id }

    private val mine = Book(id = 7, title = "Emma", authors = "Jane Austen", addedAt = 1, updatedAt = 2)
    private val other = Book(id = 8, title = "Persuasion", authors = "Jane Austen", addedAt = 1, updatedAt = 2)

    @Test fun theIdOfTheBorrowedCopyIsWorkedOutFromTheLoan() {
        // The values the contract gives, for the app and the website alike.
        assertEquals(1_111_235_846_714_580L, LoanBooks.loanBookId("3f2a9c1e-7b4d-4e8a-9c0d-112233445566"))
        assertEquals(11_259_364L, LoanBooks.loanBookId("0000000a-bcde-4f01-8234-56789abcdef0"))
        assertEquals(4_503_599_627_370_484L, LoanBooks.loanBookId("ffffffff-ffff-4fff-8fff-ffffffffffff"))
        // Capitals count the same.
        assertEquals(2_728_844_865_026_004L, LoanBooks.loanBookId("9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D"))
        assertEquals(LoanBooks.loanBookId("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"), LoanBooks.loanBookId("9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D"))
        // 0 would be "no id yet", so it becomes 1. (No id a server hands out starts like this: the 13th digit of those is a 4.)
        assertEquals(1L, LoanBooks.loanBookId("00000000-0000-0abc-8000-000000000000"))
        assertEquals(4L, LoanBooks.loanBookId("00000000-0000-4000-8000-000000000000"))
        // Every such id fits a JavaScript number.
        assertTrue(LoanBooks.loanBookId("ffffffff-ffff-ffff-ffff-ffffffffffff") <= 9_007_199_254_740_991L)
    }

    @Test fun myBookIsLentOnceTheBorrowerHasIt() {
        // Asked, promised, said to be handed over: the book has not moved.
        for (state in listOf(LoanState.ASKED, LoanState.AGREED, LoanState.HANDED)) {
            assertTrue(state.name, follow(listOf(mine, other), listOf(loan(lender = true, state = state))).isEmpty())
        }
        for (state in listOf(LoanState.ON_LOAN, LoanState.GIVEN_BACK)) {
            val lent = follow(listOf(mine, other), listOf(loan(lender = true, state = state))).single()
            assertEquals(mine.copy(lentTo = "Ben", lentSince = receivedDay, loanId = loanId, updatedAt = now), lent)
        }
    }

    @Test fun theDayItWasLentIsTheDayWhereTheReaderIs() {
        // A quarter past three at night in Zurich is still the evening before in Los Angeles.
        val here = LoanBooks.follow(listOf(mine), listOf(loan(lender = true, state = LoanState.ON_LOAN)), emptyList(), now, ZoneId.of("Europe/Zurich")).single()
        val there = LoanBooks.follow(listOf(mine), listOf(loan(lender = true, state = LoanState.ON_LOAN)), emptyList(), now, ZoneId.of("America/Los_Angeles")).single()
        assertEquals(receivedDay, here.lentSince)
        assertEquals(receivedDay - 1, there.lentSince)
    }

    @Test fun aBookThatAlreadySaysSoIsLeftAlone() {
        // The name of the friend may have changed since. The book is touched once, not at every look.
        val lent = mine.copy(lentTo = "Benjamin", lentSince = 20_700, loanId = loanId)
        assertTrue(follow(listOf(lent), listOf(loan(lender = true, state = LoanState.ON_LOAN))).isEmpty())
        // A book lent by hand before is the loan's now.
        val byHand = mine.copy(lentTo = "Clara", lentSince = 20_000)
        assertEquals("Ben", follow(listOf(byHand), listOf(loan(lender = true, state = LoanState.ON_LOAN))).single().lentTo)
        // A book that is gone from the library is not brought back by a loan.
        assertTrue(follow(listOf(other), listOf(loan(lender = true, state = LoanState.ON_LOAN))).isEmpty())
    }

    @Test fun aFriendWithoutANameIsWrittenAsAQuestionMark() {
        // An empty "lent to" means that the book is at home, so the name cannot be left empty.
        val lent = follow(listOf(mine), listOf(loan(lender = true, state = LoanState.ON_LOAN, peerName = ""))).single()
        assertEquals("?", lent.lentTo)
        assertEquals(loanId, lent.loanId)
        assertFalse(lent.availableToLend)
        val copy = follow(emptyList(), listOf(loan(lender = false, state = LoanState.ON_LOAN, peerName = " "))).single()
        assertEquals("?", copy.borrowedFrom)
        // And that is where it rests: the next look finds nothing to change.
        assertTrue(follow(listOf(lent), listOf(loan(lender = true, state = LoanState.ON_LOAN, peerName = ""))).isEmpty())
        assertTrue(follow(listOf(copy), listOf(loan(lender = false, state = LoanState.ON_LOAN, peerName = " "))).isEmpty())
        // A name that arrives later is taken for the borrowed copy, where the rule says what it has to be.
        assertEquals("Anna", follow(listOf(copy), listOf(loan(lender = false, state = LoanState.ON_LOAN))).single().borrowedFrom)
    }

    @Test fun myBookIsFreeAgainWhenTheLoanIsNotOutAnyMore() {
        val lent = mine.copy(lentTo = "Ben", lentSince = receivedDay, loanId = loanId)
        for (state in listOf(LoanState.RETURNED, LoanState.CANCELLED, LoanState.AGREED)) {
            val free = follow(listOf(lent, other), listOf(loan(lender = true, state = state))).single()
            assertEquals(state.name, mine.copy(updatedAt = now), free)
        }
        // A book that some other loan has out, or that was lent by hand, is none of this loan's business.
        val elsewhere = mine.copy(lentTo = "Clara", lentSince = 20_000, loanId = "another-loan")
        assertTrue(follow(listOf(elsewhere, mine.copy(id = 9, lentTo = "Dora")), listOf(loan(lender = true, state = LoanState.RETURNED))).isEmpty())
    }

    @Test fun oneLoanReturnedAndTheNextOnLoanLeaveTheBookWithTheNext() {
        val first = loan(lender = true, state = LoanState.RETURNED, id = "aaaaaaaa-0000-4000-8000-000000000001", peerName = "Ben")
        val second = loan(lender = true, state = LoanState.ON_LOAN, id = "bbbbbbbb-0000-4000-8000-000000000002", peerName = "Cleo")
        val lent = mine.copy(lentTo = "Ben", lentSince = 20_700, loanId = first.id)
        // Whatever order the loans come in.
        for (loans in listOf(listOf(first, second), listOf(second, first))) {
            val after = apply(listOf(lent), follow(listOf(lent), loans)).single()
            assertEquals("Cleo", after.lentTo)
            assertEquals(second.id, after.loanId)
            assertTrue(follow(listOf(after), loans).isEmpty())
        }
    }

    @Test fun aBorrowedBookAppearsOnMyShelf() {
        val shared = listOf(
            FriendBook(friendId = "peer", remoteId = 7, title = "Emma", description = "Handsome, clever, and rich.", rating = 5f, review = "Anna's own words"),
            FriendBook(friendId = "somebody-else", remoteId = 7, title = "Not this one", description = "Wrong shelf"),
        )
        // Before the borrower has it there is nothing to show.
        for (state in listOf(LoanState.ASKED, LoanState.AGREED, LoanState.HANDED, LoanState.DECLINED, LoanState.WITHDRAWN, LoanState.CANCELLED)) {
            assertTrue(state.name, follow(listOf(other), listOf(loan(lender = false, state = state)), shared).isEmpty())
        }
        val copy = follow(listOf(other), listOf(loan(lender = false, state = LoanState.ON_LOAN)), shared).single()
        assertEquals(
            Book(
                id = copyId, title = "Emma", authors = "Jane Austen, Fiona Stafford", isbn = "9780141439587", coverUrl = "https://example.org/emma.jpg",
                pageCount = 474, format = BookFormat.PAPERBACK,
                // The blurb is the one thing the friend's shelf knows that the loan does not. Her stars and her review stay hers.
                description = "Handsome, clever, and rich.",
                status = ReadingStatus.NONE, ownership = Ownership.BORROWED, borrowedFrom = "Anna", loanId = loanId, addedAt = received, updatedAt = received,
            ),
            copy,
        )
        // Without the friend's shelf at hand the copy is made all the same.
        assertEquals(copy.copy(description = ""), follow(emptyList(), listOf(loan(lender = false, state = LoanState.GIVEN_BACK)), emptyList()).single())
    }

    @Test fun doingItTwiceChangesNothing() {
        val loans = listOf(
            loan(lender = false, state = LoanState.ON_LOAN),
            loan(lender = true, state = LoanState.GIVEN_BACK, id = "aaaaaaaa-0000-4000-8000-000000000001", bookId = 8),
            loan(lender = true, state = LoanState.RETURNED, id = "bbbbbbbb-0000-4000-8000-000000000002", bookId = 7),
            loan(lender = false, state = LoanState.RETURNED, id = "cccccccc-0000-4000-8000-000000000003"),
        )
        val before = listOf(
            mine.copy(lentTo = "Ben", lentSince = 20_700, loanId = "bbbbbbbb-0000-4000-8000-000000000002"),
            other,
            Book(id = 9, title = "Sanditon", ownership = Ownership.BORROWED, borrowedFrom = "Anna", loanId = "cccccccc-0000-4000-8000-000000000003", addedAt = 1, updatedAt = 2),
        )
        val changed = follow(before, loans)
        // Every rule had something to do: a new copy, a book lent, a book free again, a copy given back.
        assertEquals(setOf(7L, 8L, 9L, copyId), changed.map { it.id }.toSet())
        val after = apply(before, changed)
        assertTrue(follow(after, loans, at = now + 60_000).isEmpty())
        // Nor does the order in which the library is handed over matter.
        assertEquals(changed.toSet(), follow(before.reversed(), loans).toSet())
    }

    @Test fun myCopyIsFoundBeforeANewOneIsMade() {
        val out = listOf(loan(lender = false, state = LoanState.ON_LOAN))
        // The book that says it is this loan's, wherever it has got to since.
        val known = Book(id = 50, title = "Emma (my edition)", ownership = Ownership.BORROWED, borrowedFrom = "Anna", loanId = loanId, rating = 4f, addedAt = 1, updatedAt = 2)
        assertTrue(follow(listOf(known), out).isEmpty())
        // The reader may call it theirs for the time being, but as long as the loan runs it is borrowed.
        val claimed = follow(listOf(known.copy(ownership = Ownership.OWNED, borrowedFrom = "")), out).single()
        assertEquals(known.copy(updatedAt = now), claimed)

        // The book with the id that is worked out from the loan: another device made it, and it lost its mark.
        val made = Book(id = copyId, title = "Emma", ownership = Ownership.NOT_OWNED, review = "Halb gelesen", addedAt = 1, updatedAt = 2)
        val again = follow(listOf(made, other), out).single()
        assertEquals(made.copy(ownership = Ownership.BORROWED, borrowedFrom = "Anna", loanId = loanId, updatedAt = now), again)
    }

    @Test fun aWishForTheSameBookBecomesTheCopy() {
        val out = listOf(loan(lender = false, state = LoanState.ON_LOAN))
        // The same ISBN.
        val byNumber = Book(id = 20, title = "Emma: A Novel", isbn = "9780141439587", status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED, tags = "Empfehlung", addedAt = 1, updatedAt = 2)
        assertEquals(byNumber.copy(ownership = Ownership.BORROWED, borrowedFrom = "Anna", loanId = loanId, updatedAt = now), follow(listOf(other, byNumber), out).single())
        // Or the same title and first author, however they are written.
        val byName = Book(id = 21, title = "EMMA", authors = "jane austen", status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED, addedAt = 1, updatedAt = 2)
        val reused = follow(listOf(byName), out).single()
        assertEquals(21L, reused.id)
        assertEquals(Ownership.BORROWED, reused.ownership)
        // What the reader noted in it, the list it is on included, is not the loan's to change.
        assertEquals(ReadingStatus.WISHLIST, reused.status)

        // A copy I own is my own book, and one I borrowed elsewhere is somebody else's: the loan gets a copy of its own.
        val owned = byName.copy(id = 22, ownership = Ownership.OWNED, status = ReadingStatus.READ)
        val fromTheLibrary = byName.copy(id = 23, ownership = Ownership.BORROWED, borrowedFrom = "Stadtbibliothek")
        val fresh = follow(listOf(owned, fromTheLibrary), out).single()
        assertEquals(copyId, fresh.id)
        // Another book by the same author is another book.
        assertEquals(copyId, follow(listOf(other.copy(ownership = Ownership.NOT_OWNED)), out).single().id)

        // The copy that stayed from borrowing the book before is taken again, and belongs to the new loan.
        val earlier = "aaaaaaaa-0000-4000-8000-000000000001"
        val kept = Book(id = LoanBooks.loanBookId(earlier), title = "Emma", authors = "Jane Austen", ownership = Ownership.NOT_OWNED, borrowedFrom = "Anna", loanId = earlier, review = "Beim ersten Mal", addedAt = 1, updatedAt = 2)
        val loans = out + loan(lender = false, state = LoanState.RETURNED, id = earlier)
        val secondTime = follow(listOf(kept), loans).single()
        assertEquals(kept.copy(ownership = Ownership.BORROWED, loanId = loanId, updatedAt = now), secondTime)
        assertTrue(follow(listOf(secondTime), loans).isEmpty())
    }

    @Test fun givenBackItStaysAsReadNotMine() {
        val copy = Book(id = copyId, title = "Emma", status = ReadingStatus.READ, rating = 4.5f, review = "Gern gelesen.", ownership = Ownership.BORROWED, borrowedFrom = "Anna", loanId = loanId, addedAt = received, updatedAt = received)
        val back = listOf(loan(lender = false, state = LoanState.RETURNED))
        // It keeps where it came from and everything the reader noted in it.
        assertEquals(copy.copy(ownership = Ownership.NOT_OWNED, updatedAt = now), follow(listOf(copy, other), back).single())
        // Said to be given back is not back: until the lender has it, it is borrowed.
        assertTrue(follow(listOf(copy), listOf(loan(lender = false, state = LoanState.GIVEN_BACK))).isEmpty())
        // A loan that ended otherwise never put a book on the shelf, and takes none off.
        assertTrue(follow(listOf(copy), listOf(loan(lender = false, state = LoanState.CANCELLED))).isEmpty())
    }

    @Test fun aReturnDoesNotOverruleWhatTheReaderSaysAboutTheirBook() {
        val back = listOf(loan(lender = false, state = LoanState.RETURNED))
        // Bought in the meantime: it is theirs, and stays theirs.
        val bought = Book(id = copyId, title = "Emma", ownership = Ownership.OWNED, borrowedFrom = "Anna", loanId = loanId, addedAt = 1, updatedAt = 2)
        assertTrue(follow(listOf(bought), back).isEmpty())
        // Already "not mine": nothing to do, and no new copy for a loan that is over.
        assertTrue(follow(listOf(bought.copy(ownership = Ownership.NOT_OWNED)), back).isEmpty())
        // Deleted from the library: it stays deleted.
        assertTrue(follow(listOf(other), back).isEmpty())
    }

    @Test fun twoDevicesOfOneAccountMakeTheSameBook() {
        val out = listOf(loan(lender = false, state = LoanState.ON_LOAN))
        val shared = listOf(FriendBook(friendId = "peer", remoteId = 7, title = "Emma", description = "Handsome, clever, and rich."))
        // The phone and the tablet both see the loan before either has heard of the other's copy.
        val phone = follow(listOf(other), out, shared, at = now).single()
        val tablet = follow(listOf(other), out, shared, at = now + 90_000).single()
        assertEquals(phone, tablet)
        // The vault knows it is one book, whichever of them saves first.
        fun vault(vararg books: Book) = BackupPayload(exportedAt = 0, books = books.toList(), shelves = emptyList(), links = emptyList(), quotes = emptyList())
        assertEquals(listOf(other, phone), VaultMerge.merge(vault(other), vault(other, phone), vault(other, tablet)).books)
        // Even a device that does not have the friend's shelf yet makes a book with the same id.
        val bare = follow(listOf(other), out, emptyList(), at = now).single()
        assertEquals(phone.id, bare.id)
        assertEquals(1, VaultMerge.merge(vault(other), vault(other, bare), vault(other, phone)).books.count { it.title == "Emma" })
    }

    @Test fun theStepsOnOfferAreTheOnesTheServerAllows() {
        fun lender(state: LoanState) = LoanRules.actions(lender = true, state = state).toSet()
        fun borrower(state: LoanState) = LoanRules.actions(lender = false, state = state).toSet()
        // The table of "Loans" in supabase/README.md, read by who and from where.
        assertEquals(setOf(LoanAction.AGREE, LoanAction.DECLINE), lender(LoanState.ASKED))
        assertEquals(setOf(LoanAction.HAND, LoanAction.CANCEL, LoanAction.SET_DUE), lender(LoanState.AGREED))
        assertEquals(setOf(LoanAction.UNDO_HAND, LoanAction.CANCEL, LoanAction.SET_DUE), lender(LoanState.HANDED))
        assertEquals(setOf(LoanAction.CLOSE, LoanAction.SET_DUE), lender(LoanState.ON_LOAN))
        assertEquals(setOf(LoanAction.TAKE_BACK, LoanAction.NOT_RETURNED, LoanAction.SET_DUE), lender(LoanState.GIVEN_BACK))
        assertEquals(setOf(LoanAction.WITHDRAW), borrower(LoanState.ASKED))
        assertEquals(setOf(LoanAction.WITHDRAW), borrower(LoanState.AGREED))
        assertEquals(setOf(LoanAction.RECEIVE, LoanAction.NOT_RECEIVED), borrower(LoanState.HANDED))
        assertEquals(setOf(LoanAction.GIVE_BACK), borrower(LoanState.ON_LOAN))
        assertEquals(setOf(LoanAction.UNDO_GIVE_BACK), borrower(LoanState.GIVEN_BACK))
        // A loan that is over can only be put away, by either side.
        for (state in LoanState.entries.filter { it.over }) {
            assertEquals(setOf(LoanAction.HIDE), lender(state))
            assertEquals(setOf(LoanAction.HIDE), borrower(state))
        }
        assertEquals(setOf(LoanState.RETURNED, LoanState.DECLINED, LoanState.WITHDRAWN, LoanState.CANCELLED), LoanState.entries.filter { it.over }.toSet())
        // The server knows the steps and the states by these words.
        assertEquals("undo_give_back", LoanAction.UNDO_GIVE_BACK.word)
        assertEquals(LoanState.GIVEN_BACK, LoanState.of("given_back"))
        assertNull(LoanState.of("something_new"))
    }

    @Test fun whatWaitsForMeAndWhatIsDue() {
        // Waiting for the reader's own tap: as lender an answer or the book back, as borrower the book in hand.
        assertEquals(setOf(LoanState.ASKED, LoanState.GIVEN_BACK), LoanState.entries.filter { loan(lender = true, state = it).waitsForMe }.toSet())
        assertEquals(setOf(LoanState.HANDED), LoanState.entries.filter { loan(lender = false, state = it).waitsForMe }.toSet())
        // Reserved or out: nobody else can have it.
        assertEquals(setOf(LoanState.AGREED, LoanState.HANDED, LoanState.ON_LOAN, LoanState.GIVEN_BACK), LoanState.entries.filter { it.holdsBook }.toSet())
        // Due is a book that is out on or after its day. Without a day nothing is ever due.
        val out = loan(lender = false, state = LoanState.ON_LOAN).copy(dueOn = 20_800)
        assertFalse(out.dueBy(20_799))
        assertTrue(out.dueBy(20_800))
        assertTrue(out.dueBy(20_900))
        assertTrue(out.copy(state = LoanState.GIVEN_BACK).dueBy(20_800))
        assertFalse(out.copy(state = LoanState.HANDED).dueBy(20_900))
        assertFalse(out.copy(state = LoanState.RETURNED).dueBy(20_900))
        assertFalse(out.copy(dueOn = null).dueBy(20_900))
    }

    @Test fun whatTheOtherSideDidIsReadFromWhereTheLoanStoodBefore() {
        fun lending(state: LoanState, due: Long? = null, reason: String = "") = loan(lender = true, state = state).copy(dueOn = due, reason = reason)
        fun borrowing(state: LoanState, due: Long? = null, reason: String = "") = loan(lender = false, state = state).copy(dueOn = due, reason = reason)

        // What a lender hears of.
        assertEquals(LoanNewsKind.ASKED, LoanRules.news(lending(LoanState.ASKED), null))
        assertEquals(LoanNewsKind.WITHDRAWN, LoanRules.news(lending(LoanState.WITHDRAWN), lending(LoanState.ASKED)))
        assertNull(LoanRules.news(lending(LoanState.WITHDRAWN), null))
        assertEquals(LoanNewsKind.NOT_RECEIVED, LoanRules.news(lending(LoanState.AGREED), lending(LoanState.HANDED)))
        assertEquals(LoanNewsKind.ON_LOAN, LoanRules.news(lending(LoanState.ON_LOAN), lending(LoanState.HANDED)))
        assertEquals(LoanNewsKind.GIVEN_BACK, LoanRules.news(lending(LoanState.GIVEN_BACK), lending(LoanState.ON_LOAN)))
        // "I gave it back" taken back: no words, but what was said is no longer so.
        assertNull(LoanRules.news(lending(LoanState.ON_LOAN), lending(LoanState.GIVEN_BACK)))

        // What a borrower hears of.
        assertEquals(LoanNewsKind.AGREED, LoanRules.news(borrowing(LoanState.AGREED, due = 20_800), borrowing(LoanState.ASKED)))
        assertEquals(LoanNewsKind.AGREED, LoanRules.news(borrowing(LoanState.AGREED), null))
        assertEquals(LoanNewsKind.DUE_CHANGED, LoanRules.news(borrowing(LoanState.AGREED, due = 20_810), borrowing(LoanState.AGREED, due = 20_800)))
        assertNull(LoanRules.news(borrowing(LoanState.AGREED, due = 20_800), borrowing(LoanState.HANDED, due = 20_800)))
        assertEquals(LoanNewsKind.HANDED, LoanRules.news(borrowing(LoanState.HANDED), borrowing(LoanState.AGREED)))
        assertEquals(LoanNewsKind.DUE_CHANGED, LoanRules.news(borrowing(LoanState.HANDED), borrowing(LoanState.HANDED, due = 20_800)))
        assertEquals(LoanNewsKind.NOT_RETURNED, LoanRules.news(borrowing(LoanState.ON_LOAN), borrowing(LoanState.GIVEN_BACK)))
        assertEquals(LoanNewsKind.DUE_CHANGED, LoanRules.news(borrowing(LoanState.ON_LOAN, due = 20_810), borrowing(LoanState.ON_LOAN, due = 20_800)))
        assertEquals(LoanNewsKind.DUE_CHANGED, LoanRules.news(borrowing(LoanState.GIVEN_BACK, due = null), borrowing(LoanState.GIVEN_BACK, due = 20_800)))
        assertEquals(LoanNewsKind.RETURNED, LoanRules.news(borrowing(LoanState.RETURNED), borrowing(LoanState.GIVEN_BACK)))
        assertEquals(LoanNewsKind.RETURNED, LoanRules.news(borrowing(LoanState.RETURNED), borrowing(LoanState.ON_LOAN)))
        assertEquals(LoanNewsKind.CANCELLED, LoanRules.news(borrowing(LoanState.CANCELLED), borrowing(LoanState.AGREED)))
        assertEquals(LoanNewsKind.DECLINED, LoanRules.news(borrowing(LoanState.DECLINED, reason = "Not this one"), borrowing(LoanState.ASKED)))
        assertEquals(LoanNewsKind.TAKEN, LoanRules.news(borrowing(LoanState.DECLINED, reason = "taken"), borrowing(LoanState.ASKED)))
        // The friendship ended and the question with it: nobody is told.
        assertNull(LoanRules.news(borrowing(LoanState.WITHDRAWN), borrowing(LoanState.ASKED)))

        // Only where the next tap is the reader's own does a notification ask for one.
        assertEquals(setOf(LoanNewsKind.ASKED, LoanNewsKind.HANDED, LoanNewsKind.GIVEN_BACK), LoanNewsKind.entries.filter { it.asksForATap }.toSet())
    }
}
