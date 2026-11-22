package ch.schmidtbit.shelfmark.data.repo

import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.QuoteWithBook
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.model.withStatus
import ch.schmidtbit.shelfmark.util.Dates
import kotlinx.coroutines.flow.Flow

/** Everything about the user's own books, custom lists and quotes. */
class LibraryRepository(private val db: AppDatabase, private val covers: CoverStore) {
    val books: Flow<List<Book>> = db.books().observeAll()
    val shelves: Flow<List<Shelf>> = db.shelves().observeAll()
    val links: Flow<List<BookShelf>> = db.shelves().observeLinks()
    val quotes: Flow<List<QuoteWithBook>> = db.quotes().observeAll()

    fun book(id: Long): Flow<Book?> = db.books().observe(id)
    fun shelfIdsOf(bookId: Long): Flow<List<Long>> = db.shelves().observeShelfIds(bookId)
    fun quotesOf(bookId: Long): Flow<List<Quote>> = db.quotes().observeForBook(bookId)

    suspend fun getBook(id: Long): Book? = db.books().get(id)
    suspend fun allBooks(): List<Book> = db.books().all()
    suspend fun findByIsbn(isbn: String): Book? = if (isbn.isBlank()) null else db.books().findByIsbn(isbn)

    suspend fun addBook(book: Book, shelfIds: Collection<Long> = emptyList()): Long = db.withTransaction {
        val now = System.currentTimeMillis()
        val id = db.books().insert(book.copy(id = 0, addedAt = now, updatedAt = now))
        shelfIds.forEach { db.shelves().link(BookShelf(id, it)) }
        id
    }

    suspend fun updateBook(book: Book) {
        val previous = db.books().get(book.id)
        db.books().update(book.copy(updatedAt = System.currentTimeMillis()))
        if (previous != null && previous.coverPath != book.coverPath) covers.delete(previous.coverPath)
    }

    suspend fun setStatus(bookId: Long, status: ReadingStatus) {
        val book = db.books().get(bookId) ?: return
        updateBook(book.withStatus(status, Dates.today()))
    }

    suspend fun deleteBook(id: Long) {
        val book = db.books().get(id) ?: return
        db.books().delete(id)
        covers.delete(book.coverPath)
    }

    suspend fun createShelf(name: String): Long {
        val position = (db.shelves().all().maxOfOrNull { it.position } ?: -1) + 1
        return db.shelves().insert(Shelf(name = name.trim(), position = position))
    }

    suspend fun renameShelf(shelf: Shelf, name: String) = db.shelves().update(shelf.copy(name = name.trim()))
    suspend fun deleteShelf(id: Long) = db.shelves().delete(id)

    suspend fun setOnShelf(bookId: Long, shelfId: Long, member: Boolean) {
        if (member) db.shelves().link(BookShelf(bookId, shelfId)) else db.shelves().unlink(bookId, shelfId)
    }

    suspend fun getQuote(id: Long): Quote? = db.quotes().get(id)

    suspend fun saveQuote(quote: Quote): Long =
        if (quote.id == 0L) db.quotes().insert(quote) else quote.id.also { db.quotes().update(quote) }

    suspend fun deleteQuote(id: Long) = db.quotes().delete(id)
}
