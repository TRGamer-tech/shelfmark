package ch.schmidtbit.shelfmark.data.repo

import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.util.Dates
import java.time.ZoneId
import java.util.TreeMap

/**
 * The books follow the loans. A loan is a record on the server, the library is the vault,
 * and nothing ties the two together but this: after every look at the server, the books
 * are brought in line with what the loans say. The website does exactly the same, rule
 * for rule (see "The books follow the loans" in supabase/README.md), so it does not matter
 * which of an account's devices gets there first, and doing it twice changes nothing.
 */
object LoanBooks {
    /**
     * What stands in for the name of a friend who never gave themselves one. An empty
     * "lent to" means that the book is at home, so an empty name cannot be written there.
     */
    const val NO_NAME = "?"

    /**
     * The id of the copy that appears on a borrower's shelf: the first 13 hexadecimal digits
     * of the loan's id, read as a number. It is worked out and not counted up, so that two
     * devices of one account which both see the loan make the same book, and not two.
     */
    fun loanBookId(loanId: String): Long {
        val digits = loanId.filter { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }.take(13)
        // 0 is what Room takes for "no id yet".
        return digits.toLongOrNull(16)?.takeIf { it != 0L } ?: 1L
    }

    /**
     * Returns the books that have to be written: changed ones, and copies that are new.
     * [shared] is what friends show of their libraries, for what a loan does not say about
     * a book. [now] is the moment a changed book is stamped with.
     */
    fun follow(library: List<Book>, loans: List<Loan>, shared: List<FriendBook>, now: Long, zone: ZoneId = ZoneId.systemDefault()): List<Book> {
        // In the order of their ids, so that "the first book that fits" is the same book on every device.
        val books = TreeMap<Long, Book>()
        library.forEach { books[it.id] = it }
        val touched = LinkedHashSet<Long>()
        fun write(book: Book) {
            books[book.id] = book
            touched += book.id
        }

        for (loan in loans) {
            val who = loan.peerName.ifBlank { NO_NAME }
            when {
                // I lent it and it is out: my book says to whom, and since when.
                loan.lender && loan.state.out -> {
                    val mine = books[loan.bookId] ?: continue
                    if (mine.loanId != loan.id) {
                        write(mine.copy(lentTo = who, lentSince = Dates.dayOf(loan.receivedAt ?: now, zone), loanId = loan.id, updatedAt = now))
                    }
                }
                // I lent it and it is not out (any more): the book is free again.
                loan.lender -> books.values.filter { it.loanId == loan.id }.forEach {
                    write(it.copy(lentTo = "", lentSince = null, loanId = "", updatedAt = now))
                }
                // I borrowed it and have it: a copy stands on my shelf.
                loan.state.out -> {
                    val asked = Book(title = loan.title, authors = loan.authors, isbn = loan.isbn)
                    val copy = books.values.firstOrNull { it.loanId == loan.id }
                        ?: books[loanBookId(loan.id)]
                        // A wish for this very book, or the copy left from borrowing it before.
                        ?: books.values.firstOrNull { it.ownership == Ownership.NOT_OWNED && CsvImporter.sameBook(it, asked) }
                    if (copy == null) {
                        val received = loan.receivedAt ?: now
                        val theirs = shared.firstOrNull { it.friendId == loan.peerId && it.remoteId == loan.bookId }
                        write(
                            Book(
                                id = loanBookId(loan.id),
                                title = loan.title,
                                authors = loan.authors,
                                isbn = loan.isbn,
                                pageCount = loan.pageCount,
                                format = loan.format,
                                // The loan carries what it takes to name the book. The blurb is only on the friend's shelf.
                                description = theirs?.description.orEmpty(),
                                coverUrl = loan.coverUrl,
                                status = ReadingStatus.NONE,
                                ownership = Ownership.BORROWED,
                                borrowedFrom = who,
                                loanId = loan.id,
                                addedAt = received,
                                // Not [now]: a second device that makes this book makes the very same one.
                                updatedAt = received,
                            ),
                        )
                    } else if (copy.ownership != Ownership.BORROWED || copy.borrowedFrom != who || copy.loanId != loan.id) {
                        write(copy.copy(ownership = Ownership.BORROWED, borrowedFrom = who, loanId = loan.id, updatedAt = now))
                    }
                }
                // I gave it back: read, not mine. Unless the reader said otherwise in the meantime, bought it for instance.
                loan.state == LoanState.RETURNED -> books.values.filter { it.loanId == loan.id && it.ownership == Ownership.BORROWED }.forEach {
                    write(it.copy(ownership = Ownership.NOT_OWNED, updatedAt = now))
                }
            }
        }
        return touched.map { books.getValue(it) }
    }
}
