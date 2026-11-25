package ch.schmidtbit.shelfmark.data.cart

import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.withDefaultsFor
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import kotlinx.serialization.Serializable

// The book cart: the trolley where books wait to be shelved. A reader who looks for the
// seven volumes of a series puts each one on the cart as they find it, says once how they
// are to be shelved, and shelves them all at once. This is the cart as data, apart from
// the screens: what is on it, how each book is set, and what shelving makes of it. It is
// kept on the phone (CartStore) and does not go to the account. The website has the same
// cart, rule for rule.

/** How a book is shelved: on which of the built-in lists, whose it is, and on which of the reader's own lists. */
@Serializable
data class CartSettings(
    val status: ReadingStatus = ReadingStatus.NONE,
    val ownership: Ownership = Ownership.OWNED,
    val listIds: List<Long> = emptyList(),
) {
    /**
     * Another list. Choosing the wishlist for a book that is set as one's own proposes "not
     * mine" along with it, as adding a single book to the wishlist does: a wish is not owned
     * yet. The reader can say otherwise afterwards.
     */
    fun withStatus(status: ReadingStatus): CartSettings =
        copy(status = status, ownership = if (status == ReadingStatus.WISHLIST && this.status != ReadingStatus.WISHLIST && ownership == Ownership.OWNED) Ownership.NOT_OWNED else ownership)

    fun withOwnership(ownership: Ownership): CartSettings = copy(ownership = ownership)

    /** On the list [listId], or off it. */
    fun withList(listId: Long, on: Boolean): CartSettings = copy(listIds = if (on) (listIds + listId).distinct() else listIds - listId)
}

@Serializable
data class CartItem(
    /** What tells this book from the others on the cart: its ISBN, or its title and first author. */
    val key: String,
    /** The book as it will be shelved, still without an id. */
    val book: Book,
    /**
     * The book's own settings, once the reader set it apart from the rest. They stay as they
     * are when the settings for all change. Null for a book that goes with the rest.
     */
    val own: CartSettings? = null,
    /** Wanted although the same book stands on the shelf already. */
    val anyway: Boolean = false,
)

@Serializable
data class Cart(
    /** The settings for every book that was not set apart. */
    val forAll: CartSettings = CartSettings(),
    val items: List<CartItem> = emptyList(),
) {
    val count: Int get() = items.size

    /** The entry of a book on the cart, if it is there: the same ISBN, or the same title and first author. */
    fun entryOf(book: Book): CartItem? = items.firstOrNull { it.key == keyOf(book) || CsvImporter.sameBook(it.book, book) }

    /**
     * Puts a book on the cart, at the end. A book that is on it already is not put there a
     * second time, and a book without a title is no book. [own] sets it apart at once, for a
     * book whose list was chosen where it was found or typed in.
     */
    fun put(book: Book, own: CartSettings? = null): Cart =
        if (book.title.isBlank() || entryOf(book) != null) this
        else copy(items = items + CartItem(keyOf(book), book.copy(id = 0), own?.let { it.copy(listIds = it.listIds.distinct()) }))

    fun takeOff(key: String): Cart = if (items.none { it.key == key }) this else copy(items = items.filter { it.key != key })

    /**
     * Settings of its own for a book whose list was chosen where it was found or typed in:
     * that list, and the rest as for all at this moment. None when the list was left alone.
     */
    fun chosen(status: ReadingStatus): CartSettings? = status.takeIf { it != ReadingStatus.NONE }?.let(forAll::withStatus)

    /** The one button of a search result or a preview: on the cart if it was not, off it if it was. */
    fun toggle(book: Book, status: ReadingStatus = ReadingStatus.NONE): Cart = entryOf(book)?.let { takeOff(it.key) } ?: put(book, chosen(status))

    /** Changes the settings for every book that was not set apart. */
    fun forAll(change: (CartSettings) -> CartSettings): Cart = copy(forAll = change(forAll))

    /** How a book on the cart is shelved: by its own settings if it has some, by those for all otherwise. */
    fun settingsOf(item: CartItem): CartSettings = item.own ?: forAll

    /**
     * Changes the settings of one book, which sets it apart from the rest: from here on it
     * keeps what it has, whatever is chosen for all.
     */
    fun forOne(key: String, change: (CartSettings) -> CartSettings): Cart =
        copy(items = items.map { if (it.key == key) it.copy(own = change(settingsOf(it))) else it })

    /** Lets a book that was set apart go with the rest again. */
    fun likeTheRest(key: String): Cart = copy(items = items.map { if (it.key == key) it.copy(own = null) else it })

    /** Says whether a book that is on the shelf already is shelved a second time all the same. */
    fun anyway(key: String, wanted: Boolean): Cart = copy(items = items.map { if (it.key == key) it.copy(anyway = wanted) else it })

    /** Everything off the cart; how books are shelved stays as the reader set it. */
    fun emptied(): Cart = copy(items = emptyList())

    companion object {
        /** What a book goes by on the cart. Two records of the same edition have the same key. */
        fun keyOf(book: Book): String =
            if (book.isbn.isNotBlank()) "isbn:" + book.isbn.trim()
            else "name:" + RemoteBook.normalise(book.title) + "|" + RemoteBook.normalise(book.authors.substringBefore(','))
    }
}

/** Which books of the cart stand on the shelf already, found the way the import of lists finds them. */
class ShelfCheck(library: List<Book>) {
    private val index = CsvImporter.Index(library)

    fun alreadyHere(item: CartItem): Boolean = alreadyHere(item.book)

    fun alreadyHere(book: Book): Boolean = index.find(book) >= 0

    /** The books that shelving puts on the shelf: all but those that are there already and not wanted a second time. */
    fun toShelve(cart: Cart): List<CartItem> = cart.items.filter { it.anyway || !alreadyHere(it) }
}

/**
 * A book as it stands on the shelf once it is shelved with [settings]: what adding a single
 * book to that list does (the reading dates, whether friends may ask for it), and whose it
 * is as the reader said.
 */
fun shelvedBook(book: Book, settings: CartSettings, today: Long): Book =
    book.copy(id = 0).withDefaultsFor(settings.status, today).copy(ownership = settings.ownership)
