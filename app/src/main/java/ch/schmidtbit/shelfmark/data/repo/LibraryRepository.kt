package ch.schmidtbit.shelfmark.data.repo

import androidx.room.withTransaction
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.importer.ImportPlan
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.QuoteWithBook
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.model.withStatus
import ch.schmidtbit.shelfmark.util.Dates
import ch.schmidtbit.shelfmark.util.Ids
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

/** Everything about the user's own books, custom lists and quotes. */
class LibraryRepository(private val db: AppDatabase, private val covers: CoverStore) {
    val books: Flow<List<Book>> = db.books().observeAll()
    val shelves: Flow<List<Shelf>> = db.shelves().observeAll()
    val links: Flow<List<BookShelf>> = db.shelves().observeLinks()
    val quotes: Flow<List<QuoteWithBook>> = db.quotes().observeAll()
    val sessions: Flow<List<ReadingSession>> = db.sessions().observeAll()
    val goals: Flow<List<Goal>> = db.goals().observeAll()
    val purchases: Flow<List<Purchase>> = db.purchases().observeAll()
    val ornaments: Flow<List<Ornament>> = db.ornaments().observeAll()

    fun book(id: Long): Flow<Book?> = db.books().observe(id)
    fun shelfIdsOf(bookId: Long): Flow<List<Long>> = db.shelves().observeShelfIds(bookId)
    fun quotesOf(bookId: Long): Flow<List<Quote>> = db.quotes().observeForBook(bookId)
    fun sessionsOf(bookId: Long): Flow<List<ReadingSession>> = db.sessions().observeForBook(bookId)
    fun notesOf(bookId: Long): Flow<List<Note>> = db.notes().observeForBook(bookId)
    fun purchasesOf(bookId: Long): Flow<List<Purchase>> = db.purchases().observeForBook(bookId)

    suspend fun getBook(id: Long): Book? = db.books().get(id)
    suspend fun allBooks(): List<Book> = db.books().all()
    suspend fun findByIsbn(isbn: String): Book? = if (isbn.isBlank()) null else db.books().findByIsbn(isbn)

    suspend fun addBook(book: Book, shelfIds: Collection<Long> = emptyList()): Long = db.withTransaction {
        val now = System.currentTimeMillis()
        val id = db.books().insert(book.copy(id = Ids.next(), addedAt = now, updatedAt = now))
        shelfIds.forEach { db.shelves().link(BookShelf(id, it)) }
        id
    }

    /**
     * Adds several books in one go, each with the lists of the reader's own it goes on, and
     * returns their ids in the same order. A list that is gone in the meantime is left out.
     */
    suspend fun addBooks(books: List<Pair<Book, Collection<Long>>>): List<Long> = db.withTransaction {
        val lists = db.shelves().all().mapTo(HashSet()) { it.id }
        val now = System.currentTimeMillis()
        books.map { (book, shelfIds) ->
            val id = db.books().insert(book.copy(id = Ids.next(), addedAt = now, updatedAt = now))
            shelfIds.filter { it in lists }.forEach { db.shelves().link(BookShelf(id, it)) }
            id
        }
    }

    suspend fun updateBook(book: Book) {
        val previous = db.books().get(book.id)
        db.books().update(book.copy(updatedAt = System.currentTimeMillis()))
        if (previous != null && previous.coverPath != book.coverPath) covers.delete(previous.coverPath)
    }

    /**
     * Applies [change] to the stored book in one transaction. Edits made in quick succession
     * (list, stars, spice) each start from the latest state, so none of them is lost.
     */
    suspend fun modify(bookId: Long, change: (Book) -> Book) {
        var replacedCover: String? = null
        db.withTransaction {
            val current = db.books().get(bookId) ?: return@withTransaction
            val updated = change(current).copy(id = current.id, updatedAt = System.currentTimeMillis())
            db.books().update(updated)
            if (current.coverPath != updated.coverPath) replacedCover = current.coverPath
        }
        replacedCover?.let(covers::delete)
    }

    suspend fun setStatus(bookId: Long, status: ReadingStatus) = modify(bookId) { it.withStatus(status, Dates.today()) }

    suspend fun deleteBook(id: Long) {
        val book = db.books().get(id) ?: return
        db.books().delete(id)
        covers.delete(book.coverPath)
    }

    suspend fun createShelf(name: String): Long {
        val position = (db.shelves().all().maxOfOrNull { it.position } ?: -1) + 1
        return db.shelves().insert(Shelf(id = Ids.next(), name = name.trim(), position = position))
    }

    suspend fun renameShelf(shelf: Shelf, name: String) = db.shelves().update(shelf.copy(name = name.trim()))
    suspend fun deleteShelf(id: Long) = db.shelves().delete(id)

    suspend fun setOnShelf(bookId: Long, shelfId: Long, member: Boolean) {
        if (member) db.shelves().link(BookShelf(bookId, shelfId)) else db.shelves().unlink(bookId, shelfId)
    }

    suspend fun getQuote(id: Long): Quote? = db.quotes().get(id)

    suspend fun saveQuote(quote: Quote): Long =
        if (quote.id == 0L) db.quotes().insert(quote.copy(id = Ids.next())) else quote.id.also { db.quotes().update(quote) }

    suspend fun deleteQuote(id: Long) = db.quotes().delete(id)

    /**
     * Logs a reading session and moves the book along with it: the bookmark advances,
     * an unstarted book counts as being read, and reaching the last page finishes it.
     */
    suspend fun logSession(session: ReadingSession) = db.withTransaction {
        db.sessions().insert(session.copy(id = Ids.next()))
        val book = db.books().get(session.bookId) ?: return@withTransaction
        val today = Dates.today()
        var updated = book
        if (book.status != ReadingStatus.READING && book.status != ReadingStatus.READ) {
            updated = updated.withStatus(ReadingStatus.READING, today)
        }
        updated = updated.copy(currentPage = maxOf(updated.currentPage, session.endPage))
        if (updated.pageCount > 0 && session.endPage >= updated.pageCount && updated.status == ReadingStatus.READING) {
            updated = updated.withStatus(ReadingStatus.READ, today)
        }
        db.books().update(updated.copy(updatedAt = System.currentTimeMillis()))
    }

    suspend fun deleteSession(id: Long) = db.sessions().delete(id)

    suspend fun saveNote(note: Note): Long =
        if (note.id == 0L) db.notes().insert(note.copy(id = Ids.next())) else note.id.also { db.notes().update(note) }

    suspend fun deleteNote(id: Long) = db.notes().delete(id)

    suspend fun saveGoal(goal: Goal): Long =
        if (goal.id == 0L) db.goals().insert(goal.copy(id = Ids.next())) else goal.id.also { db.goals().update(goal) }

    suspend fun deleteGoal(id: Long) = db.goals().delete(id)

    suspend fun savePurchase(purchase: Purchase): Long =
        if (purchase.id == 0L) db.purchases().insert(purchase.copy(id = Ids.next())) else purchase.id.also { db.purchases().update(purchase) }

    suspend fun deletePurchase(id: Long) = db.purchases().delete(id)

    suspend fun addOrnament(shelfKey: String, kind: OrnamentKind, position: Int): Long =
        db.ornaments().insert(Ornament(id = Ids.next(), shelfKey = shelfKey, kind = kind, position = position.coerceAtLeast(0)))

    suspend fun moveOrnament(ornament: Ornament, position: Int) = db.ornaments().update(ornament.copy(position = position.coerceAtLeast(0)))

    suspend fun deleteOrnament(id: Long) = db.ornaments().delete(id)

    /** Counts how many books of [plan] are new and how many are in the library already. */
    suspend fun previewImport(plan: ImportPlan): Pair<Int, Int> {
        val library = db.books().all()
        // Not on the thread that draws: a long list takes a moment even when each book is found at once.
        return withContext(Dispatchers.Default) {
            // A book the file lists twice is new once, and known the second time.
            val seen = CsvImporter.Index(library)
            var fresh = 0
            plan.books.forEach { planned ->
                if (seen.find(planned.book) < 0) {
                    fresh++
                    seen.add(planned.book)
                }
            }
            fresh to (plan.books.size - fresh)
        }
    }

    /**
     * Adds the books of [plan]. A book that is already in the library is not duplicated,
     * it only gains what the file knows and the library does not. Returns (added, completed).
     */
    suspend fun importBooks(plan: ImportPlan): Pair<Int, Int> = db.withTransaction {
        val library = CsvImporter.Index(db.books().all())
        val lists = db.shelves().all().associate { it.name.lowercase() to it.id }.toMutableMap()
        val added = HashSet<Long>()
        val completed = HashSet<Long>()
        plan.books.forEach { planned ->
            val at = library.find(planned.book)
            val bookId = if (at < 0) {
                db.books().insert(planned.book.copy(id = Ids.next(), updatedAt = System.currentTimeMillis())).also {
                    library.add(planned.book.copy(id = it))
                    added += it
                }
            } else {
                val match = library[at]
                val filled = CsvImporter.fillGaps(match, planned.book)
                if (filled != match) {
                    // "Completed" are books that were here before, not ones this file just brought.
                    if (match.id !in added) completed += match.id
                    db.books().update(filled.copy(updatedAt = System.currentTimeMillis()))
                    // A file can name the same book twice. The second row goes on from here,
                    // not from the book as it was before the first one.
                    library.replace(at, filled)
                }
                match.id
            }
            planned.lists.forEach { name ->
                val listId = lists.getOrPut(name.lowercase()) { createShelf(name) }
                db.shelves().link(BookShelf(bookId, listId))
            }
        }
        added.size to completed.size
    }

    /** Books that have neither an online cover nor one of their own. */
    suspend fun booksWithoutCover(): List<Book> = db.books().all().filter { it.coverUrl.isBlank() && it.coverPath.isBlank() }
}
