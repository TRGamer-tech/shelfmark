package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingSession
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
                      ornaments: List<Ornament> = emptyList(), prefs: VaultPrefs? = null) =
        BackupPayload(exportedAt = 0, books = books.toList(), shelves = shelves, links = links, quotes = quotes, ornaments = ornaments, prefs = prefs)

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

    private val favourites = Shelf(id = 7, name = "Lieblinge", position = 0, createdAt = 1)

    /** Dune with everything a book can have: two quotes, a note, a session, a purchase and a place on a list. */
    private fun duneWithEverything() = BackupPayload(
        exportedAt = 0,
        books = listOf(book(1, "Emma"), book(2, "Dune")),
        shelves = listOf(favourites),
        links = listOf(BookShelf(2, 7)),
        quotes = listOf(Quote(id = 1, bookId = 2, text = "Fear is the mind-killer.", createdAt = 1), Quote(id = 2, bookId = 2, text = "The spice must flow.", createdAt = 1)),
        sessions = listOf(ReadingSession(id = 1, bookId = 2, startedAt = 5, startPage = 0, endPage = 20, minutes = 30f)),
        notes = listOf(Note(id = 1, bookId = 2, text = "Wer ist Duncan?", createdAt = 1)),
        purchases = listOf(Purchase(id = 1, bookId = 2, price = 12.5, day = 19000)),
    )

    @Test fun whatBelongsToABookThatSurvivesItsDeletionSurvivesWithIt() {
        val base = duneWithEverything()
        // One side deleted Dune, and everything of it went along. The other side gave it stars.
        val deleted = base.copy(books = listOf(book(1, "Emma")), links = emptyList(), quotes = emptyList(), sessions = emptyList(), notes = emptyList(), purchases = emptyList())
        val changed = base.copy(books = listOf(book(1, "Emma"), book(2, "Dune", rating = 5f, updatedAt = 200)))
        for (merged in listOf(VaultMerge.merge(base, deleted, changed), VaultMerge.merge(base, changed, deleted))) {
            assertEquals(5f, merged.books.single { it.id == 2L }.rating)
            assertEquals(base.quotes, merged.quotes)
            assertEquals(base.sessions, merged.sessions)
            assertEquals(base.notes, merged.notes)
            assertEquals(base.purchases, merged.purchases)
            assertEquals(base.links, merged.links)
        }
    }

    @Test fun whatWasDeletedOnPurposeStaysDeleted() {
        val base = duneWithEverything()
        val deleted = base.copy(books = listOf(book(1, "Emma")), links = emptyList(), quotes = emptyList(), sessions = emptyList(), notes = emptyList(), purchases = emptyList())
        // Where Dune still stands, one quote was thrown out, the other one corrected, the note
        // deleted and the book taken off the list. That was meant, and it counts.
        val corrected = base.quotes[1].copy(text = "The spice must flow!")
        val changed = base.copy(
            books = listOf(book(1, "Emma"), book(2, "Dune", rating = 5f, updatedAt = 200)),
            quotes = listOf(corrected),
            notes = emptyList(),
            links = emptyList(),
        )
        for (merged in listOf(VaultMerge.merge(base, deleted, changed), VaultMerge.merge(base, changed, deleted))) {
            assertEquals(listOf(1L, 2L), merged.books.map { it.id })
            assertEquals(listOf(corrected), merged.quotes)
            assertTrue(merged.notes.isEmpty())
            assertTrue(merged.links.isEmpty())
            assertEquals(base.sessions, merged.sessions)
            assertEquals(base.purchases, merged.purchases)
        }
    }

    @Test fun aListThatSurvivesItsDeletionKeepsItsBooksAndItsOrnaments() {
        val base = duneWithEverything().copy(ornaments = listOf(Ornament(1, "list_7", OrnamentKind.CAT, 0)))
        val deleted = base.copy(shelves = emptyList(), links = emptyList(), ornaments = emptyList())
        val renamed = base.copy(shelves = listOf(favourites.copy(name = "Die Besten")))
        for (merged in listOf(VaultMerge.merge(base, deleted, renamed), VaultMerge.merge(base, renamed, deleted))) {
            assertEquals("Die Besten", merged.shelves.single().name)
            assertEquals(base.links, merged.links)
            assertEquals(base.ornaments, merged.ornaments)
        }
    }

    @Test fun whatBothSidesDeletedIsGoneWithAllThatBelongedToIt() {
        val base = duneWithEverything()
        val deleted = base.copy(books = listOf(book(1, "Emma")), links = emptyList(), quotes = emptyList(), sessions = emptyList(), notes = emptyList(), purchases = emptyList())
        val merged = VaultMerge.merge(base, deleted, deleted.copy(books = listOf(book(1, "Emma", rating = 3f, updatedAt = 200))))
        assertEquals(listOf(1L), merged.books.map { it.id })
        assertTrue(merged.quotes.isEmpty() && merged.sessions.isEmpty() && merged.notes.isEmpty() && merged.purchases.isEmpty() && merged.links.isEmpty())
    }

    @Test fun withoutAnythingToCompareWithNothingIsThrownAway() {
        val local = vault(book(1, "Emma"), book(2, "Dune"))
        val remote = vault(book(2, "Dune", rating = 4f, updatedAt = 500), book(3, "Momo"))
        val merged = VaultMerge.merge(null, local, remote)
        assertEquals(listOf(1L, 2L, 3L), merged.books.map { it.id })
        assertEquals(4f, merged.books.first { it.id == 2L }.rating)
    }

    @Test fun settingsFollowWhoChangedThem() {
        val base = vault(prefs = VaultPrefs(profileName = "Anna"))
        val local = vault(prefs = VaultPrefs(profileName = "Anna"))
        val remote = vault(prefs = VaultPrefs(profileName = "Anna B."))
        assertEquals("Anna B.", VaultMerge.merge(base, local, remote).prefs!!.profileName)
        assertEquals("Anna B.", VaultMerge.merge(base, remote, local).prefs!!.profileName)
        assertNull(VaultMerge.merge(null, vault(), vault()).prefs)
    }

    @Test fun twoSettingsChangedInTwoPlacesAreBothKept() {
        val base = vault(prefs = VaultPrefs(profileName = "Anna", theme = "system"))
        val local = vault(prefs = VaultPrefs(profileName = "Anna", theme = "night"))
        val remote = vault(prefs = VaultPrefs(profileName = "Anna B.", theme = "system"))
        assertEquals(VaultPrefs(profileName = "Anna B.", theme = "night"), VaultMerge.merge(base, local, remote).prefs)
        // The same setting changed in both places: the server's counts.
        val both = vault(prefs = VaultPrefs(profileName = "Änni", theme = "system"))
        assertEquals("Anna B.", VaultMerge.merge(base, both, remote).prefs!!.profileName)
    }

    @Test fun idsNeverRepeatAndFitTheWebsite() {
        val ids = (1..5000).map { Ids.next() }
        assertEquals(5000, ids.toSet().size)
        assertEquals(ids, ids.sorted())
        // JavaScript keeps whole numbers exactly up to this.
        assertTrue(ids.all { it in 1..9_007_199_254_740_991 })
    }
}
