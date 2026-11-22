package ch.schmidtbit.shelfmark.data.model

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

/** The built-in lists every book is sorted into. NONE means "on the shelf, not started". */
enum class ReadingStatus { NONE, WISHLIST, READING, READ, ABANDONED }

enum class BookFormat { UNKNOWN, HARDCOVER, PAPERBACK, EBOOK, AUDIOBOOK, OTHER }

/** OWNED: mine. BORROWED: on loan from someone else. NOT_OWNED: wishlist, library copy and the like. */
enum class Ownership { OWNED, BORROWED, NOT_OWNED }

enum class LendStatus { PENDING, ACCEPTED, DECLINED }

enum class GoalKind { BOOKS, PAGES, MINUTES }

/** Little things that stand between the books on a shelf. */
enum class OrnamentKind { PLANT, CACTUS, CANDLE, MUG, VASE, LAMP, GLOBE, CLOCK, TROPHY, FRAME, PUMPKIN, BOOKEND }

/** ONCE runs between two dates, the others start over every day, week, month or year. */
enum class GoalRepeat { ONCE, DAILY, WEEKLY, MONTHLY, YEARLY }

@Serializable
@Entity(tableName = "books", indices = [Index("isbn")])
data class Book(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val subtitle: String = "",
    /** Display string, several authors separated by ", ". */
    val authors: String = "",
    /** Digits only, ISBN-13 where known. Empty for old editions without a code. */
    val isbn: String = "",
    val publisher: String = "",
    val publishedYear: String = "",
    val language: String = "",
    val pageCount: Int = 0,
    val format: BookFormat = BookFormat.UNKNOWN,
    /** Blurb, the text on the back cover. */
    val description: String = "",
    val coverUrl: String = "",
    /** File name inside filesDir/covers for a cover the user photographed or picked. */
    val coverPath: String = "",
    val status: ReadingStatus = ReadingStatus.NONE,
    val ownership: Ownership = Ownership.OWNED,
    val borrowedFrom: String = "",
    /** Whether friends may ask to borrow this book. */
    val lendable: Boolean = true,
    val lentTo: String = "",
    val lentSince: Long? = null,
    /** 0 = unrated, otherwise 0.5 to 5.0 in half star steps. */
    val rating: Float = 0f,
    /** 0 = not set, 1 to 5 chillies. */
    val spice: Int = 0,
    val review: String = "",
    val startedOn: Long? = null,
    val finishedOn: Long? = null,
    /** Furthest page reached in the current read (minutes for audiobooks). */
    val currentPage: Int = 0,
    /** How many times the book was finished. */
    val readCount: Int = 0,
    val favorite: Boolean = false,
    /** Genres and tags as display strings, separated by ", ". */
    val genres: String = "",
    val tags: String = "",
    val series: String = "",
    /** Position in the series, 0 = not set. */
    val seriesPosition: Float = 0f,
    val addedAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
) {
    /** A friend can ask for this book right now. */
    val availableToLend: Boolean
        get() = ownership == Ownership.OWNED && lendable && lentTo.isBlank()
}

/** A custom list ("shelf") the user created in addition to the built-in status lists. */
@Serializable
@Entity(tableName = "shelves")
data class Shelf(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val position: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "book_shelf",
    primaryKeys = ["bookId", "shelfId"],
    foreignKeys = [
        ForeignKey(entity = Book::class, parentColumns = ["id"], childColumns = ["bookId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = Shelf::class, parentColumns = ["id"], childColumns = ["shelfId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("shelfId")],
)
@Serializable
data class BookShelf(val bookId: Long, val shelfId: Long)

@Entity(
    tableName = "quotes",
    foreignKeys = [
        ForeignKey(entity = Book::class, parentColumns = ["id"], childColumns = ["bookId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("bookId")],
)
@Serializable
data class Quote(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bookId: Long,
    val text: String,
    val page: Int = 0,
    val note: String = "",
    /** True if the text came from the camera (OCR) rather than typing or pasting. */
    val fromOcr: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
)

/** One sitting with a book: from which page to which, and how long it took. */
@Serializable
@Entity(
    tableName = "sessions",
    foreignKeys = [
        ForeignKey(entity = Book::class, parentColumns = ["id"], childColumns = ["bookId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("bookId")],
)
data class ReadingSession(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bookId: Long,
    /** Local wall clock time the session started, as epoch milliseconds. */
    val startedAt: Long = System.currentTimeMillis(),
    val startPage: Int = 0,
    val endPage: Int = 0,
    /** Minutes spent, 0 when the session was logged without a time. */
    val minutes: Float = 0f,
    val note: String = "",
) {
    val pages: Int get() = (endPage - startPage).coerceAtLeast(0)
}

@Serializable
@Entity(
    tableName = "notes",
    foreignKeys = [
        ForeignKey(entity = Book::class, parentColumns = ["id"], childColumns = ["bookId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("bookId")],
)
data class Note(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bookId: Long,
    val title: String = "",
    val text: String,
    val page: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
)

@Serializable
@Entity(tableName = "goals")
data class Goal(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String = "",
    val kind: GoalKind = GoalKind.BOOKS,
    val target: Int,
    /** Epoch days. For repeating goals only the repeat matters and these are ignored. */
    val startDay: Long,
    val endDay: Long,
    val repeat: GoalRepeat = GoalRepeat.ONCE,
    val archived: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
)

/** What a copy cost and where it came from. A book can be bought more than once. */
@Serializable
@Entity(
    tableName = "purchases",
    foreignKeys = [
        ForeignKey(entity = Book::class, parentColumns = ["id"], childColumns = ["bookId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("bookId")],
)
data class Purchase(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bookId: Long,
    /** Epoch day of the purchase. */
    val day: Long,
    val price: Double = 0.0,
    val currency: String = "",
    val store: String = "",
    val note: String = "",
)

/**
 * An ornament on one of the shelves. [shelfKey] names the shelf: the name of a built-in
 * list (for example "READING") or "list_" followed by the id of a custom list.
 */
@Serializable
@Entity(tableName = "ornaments", indices = [Index("shelfKey")])
data class Ornament(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val shelfKey: String,
    val kind: OrnamentKind,
    /** The ornament stands after this many books, 0 puts it at the start. */
    val position: Int = 0,
)

data class QuoteWithBook(
    @Embedded val quote: Quote,
    val bookTitle: String,
    val bookAuthors: String,
)

/** Someone whose shared library snapshot was imported. The id is their Shelfmark profile id. */
@Entity(tableName = "friends")
data class Friend(
    @PrimaryKey val id: String,
    val name: String,
    val sharedAt: Long,
    val importedAt: Long,
    val includesStatus: Boolean,
    val includesRatings: Boolean,
)

data class FriendWithCount(
    @Embedded val friend: Friend,
    val bookCount: Int,
)

@Entity(
    tableName = "friend_books",
    foreignKeys = [
        ForeignKey(entity = Friend::class, parentColumns = ["id"], childColumns = ["friendId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("friendId")],
)
data class FriendBook(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val friendId: String,
    /** The book's id in the friend's own database, echoed back in lend requests. */
    val remoteId: Long,
    val title: String,
    val authors: String = "",
    val isbn: String = "",
    val coverUrl: String = "",
    val pageCount: Int = 0,
    val format: BookFormat = BookFormat.UNKNOWN,
    val description: String = "",
    val status: ReadingStatus? = null,
    val ownership: Ownership = Ownership.OWNED,
    val available: Boolean = false,
    val rating: Float = 0f,
    val spice: Int = 0,
    val review: String = "",
    val startedOn: Long? = null,
    val finishedOn: Long? = null,
    /** Names of the friend's custom lists this book is on, one per line. */
    val shelves: String = "",
)

/** A borrow request, either one I sent (incoming = false) or one a friend sent me. */
@Entity(tableName = "lend_requests")
data class LendRequest(
    @PrimaryKey val id: String,
    val incoming: Boolean,
    val bookRemoteId: Long,
    val bookTitle: String,
    val bookAuthors: String = "",
    val isbn: String = "",
    val peerId: String,
    val peerName: String,
    val note: String = "",
    val status: LendStatus = LendStatus.PENDING,
    val createdAt: Long = System.currentTimeMillis(),
    val answeredAt: Long? = null,
)
