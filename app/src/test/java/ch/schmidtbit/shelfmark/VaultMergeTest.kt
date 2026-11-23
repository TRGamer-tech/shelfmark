package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.LendRequest
import ch.schmidtbit.shelfmark.data.model.LendStatus
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.repo.VaultMerge
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.VaultPrefs
import ch.schmidtbit.shelfmark.util.Ids
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Two versions of one library that both changed since they were the same. */
class VaultMergeTest {
    private fun book(id: Long, title: String, updatedAt: Long = 100, rating: Float = 0f) = Book(id = id, title = title, rating = rating, addedAt = 1, updatedAt = updatedAt)
    private fun vault(vararg books: Book, shelves: List<Shelf> = emptyList(), links: List<BookShelf> = emptyList(), quotes: List<Quote> = emptyList(),
                      ornaments: List<Ornament> = emptyList(), requests: List<LendRequest> = emptyList(), prefs: VaultPrefs? = null) =
        BackupPayload(exportedAt = 0, books = books.toList(), shelves = shelves, links = links, quotes = quotes, ornaments = ornaments, requests = requests, prefs = prefs)

    @Test fun whatOnlyOneSideTouchedIsTaken() {
        val base = vault(book(1, "Emma"), book(2, "Dune"), book(3, "Momo"))
        val local = vault(book(1, "Emma", rating = 5f, updatedAt = 200), book(2, "Dune"), book(3, "Momo"), book(10, "Neu hier"))
        val remote = vault(book(1, "Emma"), book(2, "Dune", rating = 3f, updatedAt = 300), book(20, "Neu dort"))
        val merged = VaultMerge.merge(base, local, remote).books.associateBy { it.id }
        assertEquals(5f, merged.getValue(1).rating)
        assertEquals(3f, merged.getValue(2).rating)
        // Momo was deleted on the server and not touched here: gone. New books from both sides stay.
        assertEquals(setOf(1L, 2L, 10L, 20L), merged.keys)
    }

    @Test fun aChangeIsWorthMoreThanADeletion() {
        val base = vault(book(1, "Emma"), book(2, "Dune"))
        val local = vault(book(2, "Dune"))
        val remote = vault(book(1, "Emma", rating = 4f, updatedAt = 200), book(2, "Dune"))
        assertEquals(listOf(1L, 2L), VaultMerge.merge(base, local, remote).books.map { it.id })
        // And the other way round.
        assertEquals(listOf(1L, 2L), VaultMerge.merge(base, remote, local).books.map { it.id })
    }

    @Test fun whenBothChangedTheSameBookTheLaterChangeCounts() {
        val base = vault(book(1, "Emma"))
        val earlier = vault(book(1, "Emma", rating = 2f, updatedAt = 200))
        val later = vault(book(1, "Emma", rating = 5f, updatedAt = 300))
        assertEquals(5f, VaultMerge.merge(base, earlier, later).books.single().rating)
        assertEquals(5f, VaultMerge.merge(base, later, earlier).books.single().rating)
    }

    @Test fun whatBelongedToSomethingThatIsGoneGoesWithIt() {
        val shelf = Shelf(id = 7, name = "Lieblinge", position = 0, createdAt = 1)
        val base = vault(book(1, "Emma"), book(2, "Dune"), shelves = listOf(shelf), links = listOf(BookShelf(1, 7), BookShelf(2, 7)),
            quotes = listOf(Quote(id = 1, bookId = 2, text = "Fear is the mind-killer.", createdAt = 1)), ornaments = listOf(Ornament(1, "list_7", OrnamentKind.CAT, 0)))
        // Here a quote was added to Dune. On the server Dune and the list were deleted.
        val local = base.copy(quotes = base.quotes + Quote(id = 2, bookId = 1, text = "Emma Woodhouse, handsome, clever, and rich.", createdAt = 2))
        val remote = vault(book(1, "Emma"))
        val merged = VaultMerge.merge(base, local, remote)
        assertEquals(listOf(1L), merged.books.map { it.id })
        assertTrue(merged.shelves.isEmpty())
        assertTrue(merged.links.isEmpty())
        assertTrue(merged.ornaments.isEmpty())
        assertEquals(listOf(2L), merged.quotes.map { it.id })
    }

    @Test fun withoutAnythingToCompareWithNothingIsThrownAway() {
        val local = vault(book(1, "Emma"), book(2, "Dune"))
        val remote = vault(book(2, "Dune", rating = 4f, updatedAt = 500), book(3, "Momo"))
        val merged = VaultMerge.merge(null, local, remote)
        assertEquals(listOf(1L, 2L, 3L), merged.books.map { it.id })
        assertEquals(4f, merged.books.first { it.id == 2L }.rating)
    }

    @Test fun anAnswerBeatsAQuestionAndSettingsFollowWhoChangedThem() {
        val open = LendRequest(id = "r", incoming = true, bookRemoteId = 1, bookTitle = "Emma", peerId = "p", peerName = "Ben", createdAt = 5)
        val answered = open.copy(status = LendStatus.ACCEPTED, answeredAt = 9)
        val base = vault(requests = listOf(open), prefs = VaultPrefs(profileName = "Anna"))
        val local = vault(requests = listOf(answered), prefs = VaultPrefs(profileName = "Anna"))
        val remote = vault(requests = listOf(open), prefs = VaultPrefs(profileName = "Anna B."))
        assertEquals(LendStatus.ACCEPTED, VaultMerge.merge(base, local, remote).requests.single().status)
        assertEquals(LendStatus.ACCEPTED, VaultMerge.merge(base, remote, local).requests.single().status)
        assertEquals("Anna B.", VaultMerge.merge(base, local, remote).prefs!!.profileName)
        assertEquals("Anna B.", VaultMerge.merge(base, remote, local).prefs!!.profileName)
        assertNull(VaultMerge.merge(null, vault(), vault()).prefs)
    }

    @Test fun idsNeverRepeatAndFitTheWebsite() {
        val ids = (1..5000).map { Ids.next() }
        assertEquals(5000, ids.toSet().size)
        assertEquals(ids, ids.sorted())
        // JavaScript keeps whole numbers exactly up to this.
        assertTrue(ids.all { it in 1..9_007_199_254_740_991 })
    }
}
