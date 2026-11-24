package ch.schmidtbit.shelfmark.data.model

import androidx.room.ColumnInfo
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

/**
 * Where a loan between two friends stands. The server writes these words in lower case
 * (see "Loans" in supabase/README.md).
 */
enum class LoanState {
    ASKED, AGREED, HANDED, ON_LOAN, GIVEN_BACK, RETURNED, DECLINED, WITHDRAWN, CANCELLED;

    /** The end of a loan. Nothing more happens to it, it can only be put away. */
    val over: Boolean get() = this == RETURNED || this == DECLINED || this == WITHDRAWN || this == CANCELLED

    /** The book is in the borrower's hands. */
    val out: Boolean get() = this == ON_LOAN || this == GIVEN_BACK

    /** The book is promised to somebody or with them, so nobody else can have it. */
    val holdsBook: Boolean get() = this == AGREED || this == HANDED || out

    companion object {
        /** Null for a word this version of the app does not know. */
        fun of(word: String): LoanState? = entries.firstOrNull { it.name.equals(word, ignoreCase = true) }
    }
}

enum class GoalKind { BOOKS, PAGES, MINUTES }

/** Little things that stand between the books on a shelf. */
enum class OrnamentKind { PLANT, CACTUS, CANDLE, MUG, VASE, LAMP, GLOBE, CLOCK, TROPHY, FRAME, PUMPKIN, BOOKEND, CAT, BOOKSTACK }

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
    /**
     * The loan between friends that this book is out on: on the lender's side the book that
     * was lent, on the borrower's side the copy that stands on their shelf meanwhile. Empty
     * for a book that was lent or borrowed by hand.
     */
    @ColumnInfo(defaultValue = "") val loanId: String = "",
    /** 0 = unrated, otherwise 0.5 to 5.0 in half star steps. */
    @Serializable(with = FiniteFloat::class) val rating: Float = 0f,
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
    @Serializable(with = FiniteFloat::class) val seriesPosition: Float = 0f,
    val addedAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
) {
    /** Mine, meant to be lent, and not lent out by hand. Whether a loan between friends holds it is not known here. */
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
    @Serializable(with = FiniteFloat::class) val minutes: Float = 0f,
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
    @Serializable(with = FiniteDouble::class) val price: Double = 0.0,
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
    /** True when this friend is connected through the server, so nothing has to be sent by hand. */
    @ColumnInfo(defaultValue = "0") val online: Boolean = false,
    /** Version (server time in ms) of the library that was last fetched from the server. */
    @ColumnInfo(defaultValue = "0") val serverAt: Long = 0,
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
    /** The book's id in the friend's own library. A loan names the book by it. */
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

/**
 * A loan between a friend and me, as the server last said it stands. The loan itself is one
 * record on the server that both of us read. This table only remembers what the last
 * answer was, so there is something to show without a connection. It is not part of the
 * library that goes to the account.
 */
@Entity(tableName = "loans")
data class Loan(
    @PrimaryKey val id: String,
    /** True when the book is mine and the friend asked for it. False when I am the one who asked. */
    val lender: Boolean,
    val peerId: String,
    val peerName: String,
    /** The id of the book in the lender's library. */
    val bookId: Long,
    /** What the borrower saw of the book when asking. */
    val title: String,
    val authors: String = "",
    val isbn: String = "",
    val coverUrl: String = "",
    val pageCount: Int = 0,
    val format: BookFormat = BookFormat.UNKNOWN,
    val note: String = "",
    val state: LoanState = LoanState.ASKED,
    /** Why the lender said no or took the yes back. [LoanRules.TAKEN] when somebody else got the book. */
    val reason: String = "",
    /** The epoch day the book is wanted back by. Null: no fixed date. */
    val dueOn: Long? = null,
    val askedAt: Long = 0,
    val agreedAt: Long? = null,
    val handedAt: Long? = null,
    val receivedAt: Long? = null,
    val givenBackAt: Long? = null,
    val closedAt: Long? = null,
    val updatedAt: Long = 0,
    /** Whether the last step was my own. */
    val byMe: Boolean = false,
    /** The due day this phone has reminded of already. Only this phone knows it, the server does not. */
    val dueSaid: Long? = null,
) {
    val over: Boolean get() = state.over

    /** The next step is mine: an answer, or confirming that the book changed hands. */
    val waitsForMe: Boolean
        get() = if (lender) state == LoanState.ASKED || state == LoanState.GIVEN_BACK else state == LoanState.HANDED

    /** Somebody else got the book. */
    val taken: Boolean get() = state == LoanState.DECLINED && reason == LoanRules.TAKEN

    /** The book is out and the day it was wanted back by has come. */
    fun dueBy(today: Long): Boolean = state.out && dueOn != null && dueOn <= today
}
