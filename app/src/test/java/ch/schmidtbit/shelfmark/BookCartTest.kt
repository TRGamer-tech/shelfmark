package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.cart.Cart
import ch.schmidtbit.shelfmark.data.cart.CartSettings
import ch.schmidtbit.shelfmark.data.cart.CartStore
import ch.schmidtbit.shelfmark.data.cart.ShelfCheck
import ch.schmidtbit.shelfmark.data.cart.shelvedBook
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** The book cart as data: what is on it, how each book is set, and what shelving makes of it. */
class BookCartTest {
    @get:Rule val folder = TemporaryFolder()

    private val stone = Book(title = "Harry Potter und der Stein der Weisen", authors = "J. K. Rowling", isbn = "9783551551672", pageCount = 335, format = BookFormat.HARDCOVER)
    private val chamber = Book(title = "Harry Potter und die Kammer des Schreckens", authors = "J. K. Rowling", isbn = "9783551551689", pageCount = 351)
    private val prisoner = Book(title = "Harry Potter und der Gefangene von Askaban", authors = "J. K. Rowling", isbn = "9783551551696", pageCount = 448)
    // An old edition without a code: it is told apart by its title and first author.
    private val faust = Book(title = "Faust", authors = "Johann Wolfgang von Goethe, Ernst Beutler")

    private val three = Cart().put(stone).put(chamber).put(prisoner)

    @Test fun booksArePutOnInTheOrderTheyCome() {
        assertEquals(listOf(stone.title, chamber.title, prisoner.title), three.items.map { it.book.title })
        assertEquals(3, three.count)
        assertEquals("isbn:9783551551672", three.items.first().key)
        assertEquals("name:faust|johannwolfgangvongoethe", Cart.keyOf(faust))
        // What waits on the cart has no id yet. Shelving hands it one.
        assertEquals(0L, Cart().put(stone.copy(id = 42)).items.single().book.id)
    }

    @Test fun aBookIsOnTheCartOnceHoweverOftenItIsPut() {
        assertSame(three, three.put(stone))
        // The same edition found again by another catalogue, with a little less known about it.
        assertSame(three, three.put(stone.copy(pageCount = 0, format = BookFormat.UNKNOWN)))
        // Another edition of the same book is the same book, as it is for "already in your library".
        assertSame(three, three.put(stone.copy(isbn = "9783551354013")))
        val withFaust = three.put(faust)
        assertSame(withFaust, withFaust.put(faust.copy(authors = "Johann Wolfgang von Goethe")))
        // A book without a title is no book.
        assertSame(three, three.put(Book(title = "  ", isbn = "9780000000002")))
    }

    @Test fun aBookIsTakenOffAgain() {
        val two = three.takeOff(Cart.keyOf(chamber))
        assertEquals(listOf(stone.title, prisoner.title), two.items.map { it.book.title })
        // Taking off what is not there changes nothing.
        assertSame(two, two.takeOff(Cart.keyOf(chamber)))
        assertNull(two.entryOf(chamber))
        assertNotNull(two.entryOf(stone))
    }

    @Test fun theButtonOfASearchResultPutsOnAndTakesOff() {
        val on = Cart().toggle(stone)
        assertEquals(1, on.count)
        val off = on.toggle(stone.copy(pageCount = 0))
        assertEquals(0, off.count)
    }

    @Test fun aListChosenWhereTheBookWasFoundIsItsOwn() {
        val cart = Cart().forAll { it.withList(4, true) }.toggle(stone, ReadingStatus.WISHLIST).toggle(chamber)
        // Set apart with that list and the rest as for all, and a wish is not owned yet.
        assertEquals(CartSettings(ReadingStatus.WISHLIST, Ownership.NOT_OWNED, listOf(4)), cart.entryOf(stone)!!.own)
        // Without a list chosen it goes with the rest.
        assertNull(cart.entryOf(chamber)!!.own)
        // The same button takes it off again, whatever list is chosen then.
        assertEquals(listOf(chamber.title), cart.toggle(stone, ReadingStatus.READ).items.map { it.book.title })
    }

    @Test fun theSettingsForAllAreForEveryBookThatWasNotSetApart() {
        val forAll = three.forAll { it.withStatus(ReadingStatus.READ).withList(7, true) }
        three.items.forEach { assertEquals(CartSettings(), three.settingsOf(it)) }
        forAll.items.forEach { assertEquals(CartSettings(ReadingStatus.READ, Ownership.OWNED, listOf(7)), forAll.settingsOf(it)) }
    }

    @Test fun aBookThatWasSetApartKeepsItsOwnSettingsWhenThoseForAllChange() {
        val key = Cart.keyOf(chamber)
        // Set apart from what the others had at that moment: borrowed, on the list 7 like the rest.
        val apart = three.forAll { it.withList(7, true) }.forOne(key) { it.withOwnership(Ownership.BORROWED) }
        assertEquals(CartSettings(ReadingStatus.NONE, Ownership.BORROWED, listOf(7)), apart.settingsOf(apart.entryOf(chamber)!!))
        // The others follow every change for all, the one set apart does not.
        val later = apart.forAll { it.withStatus(ReadingStatus.READ).withList(7, false).withList(9, true) }
        assertEquals(CartSettings(ReadingStatus.READ, Ownership.OWNED, listOf(9)), later.settingsOf(later.entryOf(stone)!!))
        assertEquals(CartSettings(ReadingStatus.READ, Ownership.OWNED, listOf(9)), later.settingsOf(later.entryOf(prisoner)!!))
        assertEquals(CartSettings(ReadingStatus.NONE, Ownership.BORROWED, listOf(7)), later.settingsOf(later.entryOf(chamber)!!))
        // Until it is let go with the rest again.
        val again = later.likeTheRest(key)
        assertEquals(CartSettings(ReadingStatus.READ, Ownership.OWNED, listOf(9)), again.settingsOf(again.entryOf(chamber)!!))
    }

    @Test fun theWishlistProposesNotMine() {
        assertEquals(Ownership.NOT_OWNED, CartSettings().withStatus(ReadingStatus.WISHLIST).ownership)
        // Said otherwise afterwards, it stays as said.
        val wantedAnyway = CartSettings().withStatus(ReadingStatus.WISHLIST).withOwnership(Ownership.OWNED)
        assertEquals(Ownership.OWNED, wantedAnyway.withStatus(ReadingStatus.WISHLIST).ownership)
        // Borrowed stays borrowed, and leaving the wishlist does not decide anything about ownership.
        assertEquals(Ownership.BORROWED, CartSettings(ownership = Ownership.BORROWED).withStatus(ReadingStatus.WISHLIST).ownership)
        assertEquals(Ownership.NOT_OWNED, CartSettings().withStatus(ReadingStatus.WISHLIST).withStatus(ReadingStatus.READING).ownership)
    }

    @Test fun listsAreChosenSeveralAtOnceAndEachOnce() {
        val settings = CartSettings().withList(3, true).withList(5, true).withList(3, true)
        assertEquals(listOf(3L, 5L), settings.listIds)
        assertEquals(listOf(5L), settings.withList(3, false).listIds)
        // A book set apart starts from what all had, and its lists are its own from then on.
        val cart = three.forAll { settings }.forOne(Cart.keyOf(stone)) { it.withList(8, true) }.forAll { it.withList(3, false) }
        assertEquals(listOf(5L), cart.forAll.listIds)
        assertEquals(listOf(3L, 5L, 8L), cart.items.first().own!!.listIds)
    }

    @Test fun aBookThatIsOnTheShelfAlreadyIsLeftOutUnlessWantedAnyway() {
        val library = listOf(
            stone.copy(id = 1, isbn = ""),
            Book(id = 2, title = "Faust", authors = "Johann Wolfgang von Goethe"),
            Book(id = 3, title = "Something else", isbn = chamber.isbn),
        )
        val cart = three.put(faust)
        val check = ShelfCheck(library)
        // By title and first author, and by ISBN.
        assertEquals(listOf(true, true, false, true), cart.items.map(check::alreadyHere))
        assertEquals(listOf(prisoner.title), check.toShelve(cart).map { it.book.title })
        val anyway = cart.anyway(Cart.keyOf(chamber), true)
        assertEquals(listOf(chamber.title, prisoner.title), check.toShelve(anyway).map { it.book.title })
        // Nothing is left out of an empty shelf.
        assertEquals(4, ShelfCheck(emptyList()).toShelve(cart).size)
    }

    @Test fun shelvingDoesWhatAddingOneBookDoes() {
        val today = 20_000L
        val reading = shelvedBook(stone, CartSettings(ReadingStatus.READING), today)
        assertEquals(today, reading.startedOn)
        assertEquals(ReadingStatus.READING, reading.status)
        assertEquals(Ownership.OWNED, reading.ownership)
        assertTrue(reading.lendable)
        val read = shelvedBook(stone, CartSettings(ReadingStatus.READ, Ownership.BORROWED), today)
        assertEquals(today, read.finishedOn)
        assertEquals(335, read.currentPage)
        assertEquals(1, read.readCount)
        assertEquals(Ownership.BORROWED, read.ownership)
        val wish = shelvedBook(stone, CartSettings().withStatus(ReadingStatus.WISHLIST), today)
        assertEquals(Ownership.NOT_OWNED, wish.ownership)
        // What the reader said goes, also against what the wishlist proposes.
        assertEquals(Ownership.OWNED, shelvedBook(stone, CartSettings(ReadingStatus.WISHLIST, Ownership.OWNED), today).ownership)
        // An e-book cannot be handed to a friend.
        assertFalse(shelvedBook(stone.copy(format = BookFormat.EBOOK), CartSettings(), today).lendable)
    }

    @Test fun emptyingTakesTheBooksAndKeepsHowTheyAreShelved() {
        val emptied = three.forAll { it.withStatus(ReadingStatus.READ) }.emptied()
        assertEquals(0, emptied.count)
        assertEquals(ReadingStatus.READ, emptied.forAll.status)
    }

    @Test fun theCartSurvivesARestart() = runBlocking {
        val file = File(folder.root, "cart.json")
        val store = CartStore(file)
        assertEquals(0, store.cart.value.count)
        assertFalse(store.straight.value)
        store.change { it.put(stone).put(chamber).put(faust) }
        store.change { it.forAll { s -> s.withStatus(ReadingStatus.WISHLIST).withList(4, true) } }
        store.change { it.forOne(Cart.keyOf(chamber)) { s -> s.withStatus(ReadingStatus.READ) } }
        store.change { it.anyway(Cart.keyOf(faust), true) }
        store.setStraight(true)

        // The app is closed and opened again.
        val again = CartStore(file)
        assertEquals(store.cart.value, again.cart.value)
        assertTrue(again.straight.value)
        assertEquals(listOf(stone.title, chamber.title, faust.title), again.cart.value.items.map { it.book.title })
        assertEquals(CartSettings(ReadingStatus.READ, Ownership.NOT_OWNED, listOf(4)), again.cart.value.settingsOf(again.cart.value.entryOf(chamber)!!))
        assertTrue(again.cart.value.entryOf(faust)!!.anyway)

        // Shelved and empty, with the switch off: nothing is left behind.
        again.change { it.emptied().copy(forAll = CartSettings()) }
        again.setStraight(false)
        assertFalse(file.exists())
        assertEquals(0, CartStore(file).cart.value.count)
    }

    @Test fun whatCannotBeReadIsLeftOutEntryByEntry() {
        val file = File(folder.root, "cart.json")
        file.writeText(
            """
            {"forAll": {"status": "SOMETHING_NEW", "ownership": "BORROWED", "listIds": [2, 2]},
             "items": [
               {"key": "isbn:9783551551672", "book": {"title": "Harry Potter und der Stein der Weisen", "isbn": "9783551551672", "status": "READ"}},
               {"key": "broken", "book": "not a book"},
               {"key": "x", "book": {"title": "   "}},
               {"key": "name:momo|", "book": {"title": "Momo", "format": "SCROLL", "unknownField": 1}, "anyway": true},
               {"key": "again", "book": {"title": "Harry Potter und der Stein der Weisen", "isbn": "9783551551672"}}
             ],
             "straight": true}
            """.trimIndent(),
        )
        val store = CartStore(file)
        assertEquals(listOf("Harry Potter und der Stein der Weisen", "Momo"), store.cart.value.items.map { it.book.title })
        // A word that is not known falls back to the usual one.
        assertEquals(CartSettings(ReadingStatus.NONE, Ownership.BORROWED, listOf(2)), store.cart.value.forAll)
        assertEquals(BookFormat.UNKNOWN, store.cart.value.items[1].book.format)
        assertTrue(store.cart.value.items[1].anyway)
        assertTrue(store.straight.value)

        file.writeText("{ this is not json")
        assertEquals(Cart(), CartStore(file).cart.value)
    }
}
