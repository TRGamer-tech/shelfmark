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

    @Test fun aBookThatIsPromisedToSomebodyCannotBeAskedFor() {
        // A loan that has a book reserved or out leaves no trace on the book until it is handed over.
        val held = ShareCodec.buildLibrary("me", "Martin", books, shelves, links, includeStatus = true, includeRatings = true, now = 1, held = setOf(1L, 3L))
        val byId = held.books.associateBy { it.id }
        assertFalse(byId.getValue(1).available)
        // Being held makes nothing available that was not.
        assertFalse(byId.getValue(3).available)
        assertFalse(byId.getValue(2).available)
        // Everything else about the book is shown as before.
        assertEquals(build(status = true, ratings = true).books.map { it.copy(available = false) }, held.books.map { it.copy(available = false) })
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

    @Test fun whatOlderVersionsWroteAboutBorrowRequestsIsReadPast() {
        val requests = """"requests":[{"id":"req-1","incoming":true,"bookRemoteId":3,"bookTitle":"Dune","peerId":"p","peerName":"Ben","note":"?","status":"ACCEPTED","createdAt":5,"answeredAt":9}]"""
        // A backup file from before the loans: the books come back, the requests are left behind.
        val backup = ShareCodec.decode("""{"app":"shelfmark","v":1,"type":"backup","backup":{"exportedAt":1,"books":[{"id":3,"title":"Dune","lentTo":"Ben"}],"shelves":[],"links":[],"quotes":[],$requests}}""")
        assertEquals("Dune", backup!!.backup!!.books.single().title)
        assertEquals("", backup.backup.books.single().loanId)
        // The same for the library an account keeps on the server.
        val vault = ShareCodec.decodeVault(kotlinx.serialization.json.Json.parseToJsonElement("""{"exportedAt":1,"books":[{"id":3,"title":"Dune"}],"shelves":[],"links":[],"quotes":[],$requests}"""))
        assertEquals("Dune", vault!!.books.single().title)
        assertFalse("requests" in ShareCodec.encodeVault(vault).toString())

        // A request or an answer as a file is still known for what it is, and carries nothing any more.
        val request = ShareCodec.decode("""{"app":"shelfmark","v":1,"type":"lend_request","request":{"requestId":"req-1","bookId":3,"bookTitle":"Dune","fromId":"b","fromName":"Ben","toId":"a","createdAt":5}}""")
        assertTrue(request!!.type in Envelope.OLD_REQUEST_TYPES)
        assertNull(request.library)
        val answer = ShareCodec.decode("""{"app":"shelfmark","v":1,"type":"lend_answer","answer":{"requestId":"req-1","accepted":true,"bookTitle":"Dune","fromId":"a","fromName":"Anna","toId":"b","answeredAt":9}}""")
        assertTrue(answer!!.type in Envelope.OLD_REQUEST_TYPES)
        assertFalse(Envelope.TYPE_LIBRARY in Envelope.OLD_REQUEST_TYPES)
    }

    @Test fun aLoanIsPartOfTheBookInTheVault() {
        val lent = Book(id = 1, title = "Dune", lentTo = "Ben", lentSince = 20_000, loanId = "3f2a9c1e-7b4d-4e8a-9c0d-112233445566", addedAt = 1, updatedAt = 2)
        val plain = Book(id = 2, title = "Emma", addedAt = 1, updatedAt = 2)
        val vault = ch.schmidtbit.shelfmark.data.share.BackupPayload(exportedAt = 0, books = listOf(lent, plain), shelves = emptyList(), links = emptyList(), quotes = emptyList())
        val written = ShareCodec.encodeVault(vault).toString()
        assertTrue(""""loanId":"3f2a9c1e-7b4d-4e8a-9c0d-112233445566"""" in written)
        // Empty is the default, and defaults are left out.
        assertEquals(1, Regex("loanId").findAll(written).count())
        assertEquals(vault, ShareCodec.decodeVault(kotlinx.serialization.json.Json.parseToJsonElement(written)))
    }
}
