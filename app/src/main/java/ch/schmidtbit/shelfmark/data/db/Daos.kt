package ch.schmidtbit.shelfmark.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.FriendWithCount
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.QuoteWithBook
import ch.schmidtbit.shelfmark.data.model.Shelf
import kotlinx.coroutines.flow.Flow

@Dao
interface BookDao {
    @Query("SELECT * FROM books ORDER BY addedAt DESC, id DESC")
    fun observeAll(): Flow<List<Book>>

    @Query("SELECT * FROM books WHERE id = :id")
    fun observe(id: Long): Flow<Book?>

    @Query("SELECT * FROM books WHERE id = :id")
    suspend fun get(id: Long): Book?

    @Query("SELECT * FROM books ORDER BY id")
    suspend fun all(): List<Book>

    @Query("SELECT * FROM books WHERE isbn = :isbn AND isbn != '' LIMIT 1")
    suspend fun findByIsbn(isbn: String): Book?

    @Insert
    suspend fun insert(book: Book): Long

    @Update
    suspend fun update(book: Book)

    @Query("DELETE FROM books WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM books")
    suspend fun clear()
}

@Dao
interface ShelfDao {
    @Query("SELECT * FROM shelves ORDER BY position, name COLLATE NOCASE")
    fun observeAll(): Flow<List<Shelf>>

    @Query("SELECT * FROM shelves ORDER BY position, name COLLATE NOCASE")
    suspend fun all(): List<Shelf>

    @Insert
    suspend fun insert(shelf: Shelf): Long

    @Update
    suspend fun update(shelf: Shelf)

    @Query("DELETE FROM shelves WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM shelves")
    suspend fun clear()

    @Query("SELECT * FROM book_shelf")
    fun observeLinks(): Flow<List<BookShelf>>

    @Query("SELECT * FROM book_shelf")
    suspend fun allLinks(): List<BookShelf>

    @Query("SELECT shelfId FROM book_shelf WHERE bookId = :bookId")
    fun observeShelfIds(bookId: Long): Flow<List<Long>>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun link(link: BookShelf)

    @Query("DELETE FROM book_shelf WHERE bookId = :bookId AND shelfId = :shelfId")
    suspend fun unlink(bookId: Long, shelfId: Long)
}

@Dao
interface QuoteDao {
    @Query(
        "SELECT q.*, b.title AS bookTitle, b.authors AS bookAuthors FROM quotes q " +
            "JOIN books b ON b.id = q.bookId ORDER BY q.createdAt DESC, q.id DESC",
    )
    fun observeAll(): Flow<List<QuoteWithBook>>

    @Query("SELECT * FROM quotes WHERE bookId = :bookId ORDER BY createdAt DESC, id DESC")
    fun observeForBook(bookId: Long): Flow<List<Quote>>

    @Query("SELECT * FROM quotes WHERE id = :id")
    suspend fun get(id: Long): Quote?

    @Query("SELECT * FROM quotes ORDER BY id")
    suspend fun all(): List<Quote>

    @Insert
    suspend fun insert(quote: Quote): Long

    @Update
    suspend fun update(quote: Quote)

    @Query("DELETE FROM quotes WHERE id = :id")
    suspend fun delete(id: Long)
}

@Dao
interface SessionDao {
    @Query("SELECT * FROM sessions ORDER BY startedAt DESC, id DESC")
    fun observeAll(): Flow<List<ReadingSession>>

    @Query("SELECT * FROM sessions WHERE bookId = :bookId ORDER BY startedAt DESC, id DESC")
    fun observeForBook(bookId: Long): Flow<List<ReadingSession>>

    @Query("SELECT * FROM sessions ORDER BY id")
    suspend fun all(): List<ReadingSession>

    @Insert
    suspend fun insert(session: ReadingSession): Long

    @Query("DELETE FROM sessions WHERE id = :id")
    suspend fun delete(id: Long)
}

@Dao
interface NoteDao {
    @Query("SELECT * FROM notes WHERE bookId = :bookId ORDER BY createdAt DESC, id DESC")
    fun observeForBook(bookId: Long): Flow<List<Note>>

    @Query("SELECT * FROM notes ORDER BY id")
    suspend fun all(): List<Note>

    @Insert
    suspend fun insert(note: Note): Long

    @Update
    suspend fun update(note: Note)

    @Query("DELETE FROM notes WHERE id = :id")
    suspend fun delete(id: Long)
}

@Dao
interface GoalDao {
    @Query("SELECT * FROM goals ORDER BY archived, createdAt DESC, id DESC")
    fun observeAll(): Flow<List<Goal>>

    @Query("SELECT * FROM goals ORDER BY id")
    suspend fun all(): List<Goal>

    @Insert
    suspend fun insert(goal: Goal): Long

    @Update
    suspend fun update(goal: Goal)

    @Query("DELETE FROM goals WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM goals")
    suspend fun clear()
}

@Dao
interface PurchaseDao {
    @Query("SELECT * FROM purchases ORDER BY day DESC, id DESC")
    fun observeAll(): Flow<List<Purchase>>

    @Query("SELECT * FROM purchases WHERE bookId = :bookId ORDER BY day DESC, id DESC")
    fun observeForBook(bookId: Long): Flow<List<Purchase>>

    @Query("SELECT * FROM purchases ORDER BY id")
    suspend fun all(): List<Purchase>

    @Insert
    suspend fun insert(purchase: Purchase): Long

    @Update
    suspend fun update(purchase: Purchase)

    @Query("DELETE FROM purchases WHERE id = :id")
    suspend fun delete(id: Long)
}

@Dao
interface OrnamentDao {
    @Query("SELECT * FROM ornaments ORDER BY shelfKey, position, id")
    fun observeAll(): Flow<List<Ornament>>

    @Query("SELECT * FROM ornaments ORDER BY id")
    suspend fun all(): List<Ornament>

    @Insert
    suspend fun insert(ornament: Ornament): Long

    @Update
    suspend fun update(ornament: Ornament)

    @Query("DELETE FROM ornaments WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM ornaments")
    suspend fun clear()
}

@Dao
interface SocialDao {
    @Query(
        "SELECT f.*, (SELECT COUNT(*) FROM friend_books fb WHERE fb.friendId = f.id) AS bookCount " +
            "FROM friends f ORDER BY f.name COLLATE NOCASE",
    )
    fun observeFriends(): Flow<List<FriendWithCount>>

    @Query("SELECT * FROM friends WHERE id = :id")
    fun observeFriend(id: String): Flow<Friend?>

    @Query("SELECT * FROM friends WHERE id = :id")
    suspend fun getFriend(id: String): Friend?

    @Query("SELECT * FROM friend_books WHERE friendId = :friendId ORDER BY title COLLATE NOCASE")
    fun observeFriendBooks(friendId: String): Flow<List<FriendBook>>

    @Query("SELECT * FROM friend_books WHERE localId = :localId")
    suspend fun getFriendBook(localId: Long): FriendBook?

    /** A friend's book by the id it has in their own library. */
    @Query("SELECT * FROM friend_books WHERE friendId = :friendId AND remoteId = :remoteId LIMIT 1")
    suspend fun findFriendBook(friendId: String, remoteId: Long): FriendBook?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFriend(friend: Friend)

    @Insert
    suspend fun insertFriendBooks(books: List<FriendBook>)

    @Query("DELETE FROM friend_books WHERE friendId = :friendId")
    suspend fun clearFriendBooks(friendId: String)

    @Query("DELETE FROM friends WHERE id = :id")
    suspend fun deleteFriend(id: String)

    @Query("SELECT * FROM friends WHERE online = 1")
    suspend fun onlineFriends(): List<Friend>

    @Query("UPDATE friends SET online = 1, serverAt = :at WHERE id = :id")
    suspend fun markOnline(id: String, at: Long)

    @Query("UPDATE friends SET online = 0, serverAt = 0")
    suspend fun markAllOffline()

    /** The newest question first, as the server hands them out. */
    @Query("SELECT * FROM loans ORDER BY askedAt DESC, id")
    fun observeLoans(): Flow<List<Loan>>

    @Query("SELECT * FROM loans ORDER BY askedAt DESC, id")
    suspend fun loans(): List<Loan>

    @Query("SELECT * FROM loans WHERE id = :id")
    suspend fun getLoan(id: String): Loan?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertLoans(loans: List<Loan>)

    @Query("DELETE FROM loans WHERE id = :id")
    suspend fun deleteLoan(id: String)

    @Query("DELETE FROM loans")
    suspend fun clearLoans()

    /** Remembers that the day this loan is due on was said, so that it is said once. */
    @Query("UPDATE loans SET dueSaid = dueOn WHERE id = :id")
    suspend fun markDueSaid(id: String)
}
