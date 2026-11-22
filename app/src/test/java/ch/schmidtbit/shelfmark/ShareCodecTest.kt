package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareCodecTest {
    private val books = listOf(
        Book(id = 1, title = "Owned and read", status = ReadingStatus.READ, rating = 4.5f, spice = 3, review = "Loved it", finishedOn = 20_000),
        Book(id = 2, title = "On loan to Ben", lentTo = "Ben"),
        Book(id = 3, title = "Wish", status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED),
        Book(id = 4, title = "Borrowed from library", ownership = Ownership.BORROWED),
    )
    private val shelves = listOf(Shelf(id = 7, name = "Favourites"))
    private val links = listOf(BookShelf(bookId = 1, shelfId = 7))

    private fun build(status: Boolean, ratings: Boolean) =
        ShareCodec.buildLibrary("me", "Martin", books, shelves, links, status, ratings, now = 1)

    @Test fun fullShareCarriesStatusListsAndRatings() {
        val lib = build(status = true, ratings = true)
        assertEquals(4, lib.books.size)
        val first = lib.books.first { it.id == 1L }
        assertEquals(ReadingStatus.READ, first.status)
        assertEquals(listOf("Favourites"), first.shelves)
        assertEquals(4.5f, first.rating)
        assertEquals(3, first.spice)
        assertEquals("Loved it", first.review)
    }

    @Test fun ownershipOnlyShareHidesEverythingPersonal() {
        val lib = build(status = false, ratings = false)
        // The wishlist says nothing about ownership, so it is left out.
        assertEquals(listOf(1L, 2L, 4L), lib.books.map { it.id })
        lib.books.forEach {
            assertNull(it.status)
            assertTrue(it.shelves.isEmpty())
            assertEquals(0f, it.rating)
            assertEquals(0, it.spice)
            assertEquals("", it.review)
            assertNull(it.finishedOn)
        }
        val text = ShareCodec.encode(Envelope(type = Envelope.TYPE_LIBRARY, library = lib))
        assertFalse("Loved it" in text)
        assertFalse("Favourites" in text)
    }

    @Test fun availabilityReflectsOwnershipAndLoans() {
        val byId = build(status = true, ratings = true).books.associateBy { it.id }
        assertTrue(byId.getValue(1).available)
        assertFalse(byId.getValue(2).available)   // already lent out
        assertFalse(byId.getValue(3).available)   // not owned
        assertFalse(byId.getValue(4).available)   // not mine to lend
    }

    @Test fun roundTripsThroughText() {
        val envelope = Envelope(type = Envelope.TYPE_LIBRARY, library = build(status = true, ratings = true))
        val decoded = ShareCodec.decode(ShareCodec.encode(envelope))
        assertEquals(envelope, decoded)
    }

    @Test fun foreignFilesAreRejected() {
        assertNull(ShareCodec.decode("hello"))
        assertNull(ShareCodec.decode("""{"type":"library"}"""))
        assertNull(ShareCodec.decode("""{"app":"other","type":"library"}"""))
        assertNull(ShareCodec.decode("""[1,2,3]"""))
        assertNotNull(ShareCodec.decode("""{"app":"shelfmark","v":1,"type":"library","futureField":true}"""))
    }
}
