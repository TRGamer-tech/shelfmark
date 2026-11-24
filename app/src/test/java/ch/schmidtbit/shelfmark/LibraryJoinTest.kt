package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.repo.LibraryJoin
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.VaultPrefs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** An account and a device that both have books, put together. One test for each rule. */
class LibraryJoinTest {
    private fun book(id: Long, title: String, author: String = "", isbn: String = "", updatedAt: Long = 100) =
        Book(id = id, title = title, authors = author, isbn = isbn, addedAt = 1, updatedAt = updatedAt)

    private fun library(
        vararg books: Book,
        shelves: List<Shelf> = emptyList(),
        links: List<BookShelf> = emptyList(),
        quotes: List<Quote> = emptyList(),
        sessions: List<ReadingSession> = emptyList(),
        notes: List<Note> = emptyList(),
        goals: List<Goal> = emptyList(),
        purchases: List<Purchase> = emptyList(),
        ornaments: List<Ornament> = emptyList(),
        prefs: VaultPrefs? = null,
    ) = BackupPayload(0, books.toList(), shelves, links, quotes, sessions, notes, goals, purchases, ornaments, prefs)

    /** New numbers that are easy to recognise. */
    private fun counter(): () -> Long {
        var next = 9000L
        return { next++ }
    }

    @Test fun aBookBothHaveBecomesOne() {
        val account = library(book(1, "Emma", "Jane Austen", isbn = "9780141439587"), book(2, "Dune", "Frank Herbert"), book(3, "Momo", "Michael Ende"))
        val device = library(
            // The same ISBN, though the title is written differently.
            book(50, "Emma (Penguin Classics)", "Austen, Jane", isbn = "9780141439587"),
            // No ISBN on either side, but the same title and first author, whatever the capitals and whoever else is named.
            book(51, "DUNE", "Frank Herbert, Brian Herbert"),
            // The same title by somebody else is another book.
            book(52, "Momo", "Somebody Else"),
        )
        val joined = LibraryJoin.join(account, device, counter())
        assertEquals(listOf(1L, 2L, 3L, 52L), joined.books.map { it.id })
        assertEquals(listOf("Emma", "Dune", "Momo", "Momo"), joined.books.map { it.title })
    }

    @Test fun theCopyThatWasChangedLastStaysAndTakesWhatItLacksFromTheOther() {
        val onAccount = Book(
            id = 1, title = "Emma", authors = "Jane Austen", isbn = "9780141439587", publisher = "Penguin", pageCount = 474, rating = 5f,
            coverUrl = "https://covers.example/emma.jpg", format = BookFormat.PAPERBACK, loanId = "loan-1", addedAt = 1, updatedAt = 100,
        )
        val onDevice = Book(
            id = 50, title = "Emma", subtitle = "A Novel", authors = "Jane Austen", review = "Wunderbar.", pageCount = 512, status = ReadingStatus.READING,
            currentPage = 80, startedOn = 19_000, spice = 1, addedAt = 2, updatedAt = 200,
        )
        // The device's copy is the later one. It stays as it is where it says something...
        val later = LibraryJoin.join(library(onAccount), library(onDevice), counter()).books.single()
        assertEquals("A Novel", later.subtitle)
        assertEquals("Wunderbar.", later.review)
        assertEquals(512, later.pageCount)
        assertEquals(ReadingStatus.READING, later.status)
        assertEquals(80, later.currentPage)
        assertEquals(200L, later.updatedAt)
        // ...and what it leaves empty comes from the other one.
        assertEquals("9780141439587", later.isbn)
        assertEquals("Penguin", later.publisher)
        assertEquals(5f, later.rating)
        assertEquals("https://covers.example/emma.jpg", later.coverUrl)
        assertEquals(BookFormat.PAPERBACK, later.format)
        // Its number is the account's, which is the one the website and the loans between friends know.
        assertEquals(1L, later.id)
        assertEquals("loan-1", later.loanId)

        // The other way round the account's copy stays, and takes from the device's what it lacks.
        val earlier = LibraryJoin.join(library(onAccount.copy(updatedAt = 300)), library(onDevice), counter()).books.single()
        assertEquals(474, earlier.pageCount)
        assertEquals(ReadingStatus.NONE, earlier.status)
        assertEquals(0, earlier.currentPage)
        assertEquals("A Novel", earlier.subtitle)
        assertEquals("Wunderbar.", earlier.review)
        assertEquals(1, earlier.spice)
        assertEquals(19_000L, earlier.startedOn)
        assertEquals(1L, earlier.id)

        // A cover is taken over whole or not at all: a photo on the device is not paired with the address of another picture.
        val photographed = LibraryJoin.join(library(onAccount), library(onDevice.copy(coverPath = "photo.jpg")), counter()).books.single()
        assertEquals("photo.jpg", photographed.coverPath)
        assertEquals("", photographed.coverUrl)
    }

    @Test fun everythingThatBelongsToEitherCopyIsKeptAndWhatBothSayOnce() {
        val favourites = Shelf(id = 7, name = "Lieblinge", position = 0, createdAt = 1)
        val account = library(
            book(1, "Emma", "Jane Austen"),
            shelves = listOf(favourites),
            links = listOf(BookShelf(1, 7)),
            quotes = listOf(Quote(id = 1, bookId = 1, text = "Handsome, clever, and rich.", page = 1, createdAt = 10)),
            sessions = listOf(ReadingSession(id = 1, bookId = 1, startedAt = 1000, startPage = 0, endPage = 30, minutes = 20f)),
            notes = listOf(Note(id = 1, bookId = 1, title = "Frage", text = "Wer ist Mr. Knightley?", createdAt = 10)),
            purchases = listOf(Purchase(id = 1, bookId = 1, day = 19_000, price = 12.5, currency = "CHF", store = "Orell Füssli")),
        )
        val device = library(
            book(50, "Emma", "Jane Austen"),
            shelves = listOf(Shelf(id = 70, name = "Lieblinge", position = 0, createdAt = 2), Shelf(id = 71, name = "Ferien", position = 1, createdAt = 2)),
            links = listOf(BookShelf(50, 70), BookShelf(50, 71)),
            quotes = listOf(
                // Says the same as the account's quote, written down at another moment: once is enough.
                Quote(id = 60, bookId = 50, text = "Handsome, clever, and rich.", page = 1, createdAt = 99),
                Quote(id = 61, bookId = 50, text = "Seldom, very seldom.", page = 400, createdAt = 99),
            ),
            sessions = listOf(
                ReadingSession(id = 60, bookId = 50, startedAt = 1000, startPage = 0, endPage = 30, minutes = 20f),
                ReadingSession(id = 61, bookId = 50, startedAt = 2000, startPage = 30, endPage = 80, minutes = 45f),
            ),
            notes = listOf(Note(id = 60, bookId = 50, title = "Frage", text = "Wer ist Mr. Knightley?", createdAt = 99), Note(id = 61, bookId = 50, text = "Highbury ist klein.", createdAt = 99)),
            purchases = listOf(
                Purchase(id = 60, bookId = 50, day = 19_000, price = 12.5, currency = "CHF", store = "Orell Füssli"),
                Purchase(id = 61, bookId = 50, day = 19_500, price = 3.0, currency = "CHF", store = "Brocki"),
            ),
        )
        val joined = LibraryJoin.join(account, device, counter())
        assertEquals(listOf(1L), joined.books.map { it.id })
        // Everything now belongs to the one book that is left.
        assertEquals(listOf(1L to 1, 61L to 400), joined.quotes.map { it.id to it.page })
        assertTrue(joined.quotes.all { it.bookId == 1L })
        assertEquals(listOf(1L to 30, 61L to 80), joined.sessions.map { it.id to it.endPage })
        assertTrue(joined.sessions.all { it.bookId == 1L })
        assertEquals(listOf("Wer ist Mr. Knightley?", "Highbury ist klein."), joined.notes.map { it.text })
        assertTrue(joined.notes.all { it.bookId == 1L })
        assertEquals(listOf("Orell Füssli", "Brocki"), joined.purchases.map { it.store })
        assertTrue(joined.purchases.all { it.bookId == 1L })
        // On the list both had, and on the one only the device had.
        assertEquals(listOf(BookShelf(1, 7), BookShelf(1, 71)), joined.links)
    }

    @Test fun booksOnlyOneSideHasStayAsTheyAre() {
        val account = library(book(1, "Emma", "Jane Austen"), quotes = listOf(Quote(id = 1, bookId = 1, text = "Handsome.", createdAt = 1)))
        val dune = Book(id = 50, title = "Dune", authors = "Frank Herbert", rating = 4f, review = "Sand.", status = ReadingStatus.READ, finishedOn = 19_000, addedAt = 5, updatedAt = 7)
        // The device's second book happens to go by the number the account's Emma has (libraries that came from the desktop app count from one).
        val momo = Book(id = 1, title = "Momo", authors = "Michael Ende", addedAt = 5, updatedAt = 7)
        val device = library(
            dune, momo,
            quotes = listOf(Quote(id = 1, bookId = 1, text = "Zeit ist Leben.", createdAt = 1), Quote(id = 2, bookId = 50, text = "Fear is the mind-killer.", createdAt = 1)),
            sessions = listOf(ReadingSession(id = 1, bookId = 1, startedAt = 5, startPage = 0, endPage = 10)),
        )
        val joined = LibraryJoin.join(account, device, counter())
        // Emma and Dune are untouched. Momo is the same book under a new number, and what belongs to it went along.
        assertEquals(account.books.single(), joined.books.first { it.title == "Emma" })
        assertEquals(dune, joined.books.first { it.title == "Dune" })
        val moved = joined.books.first { it.title == "Momo" }
        assertEquals(momo.copy(id = moved.id), moved)
        assertTrue(moved.id >= 9000)
        assertEquals(listOf("Handsome.", "Fear is the mind-killer.", "Zeit ist Leben."), joined.quotes.sortedBy { it.id }.map { it.text })
        assertEquals(1L, joined.quotes.first { it.text == "Handsome." }.bookId)
        assertEquals(moved.id, joined.quotes.first { it.text == "Zeit ist Leben." }.bookId)
        // The quote's own number was taken as well.
        assertEquals(3, joined.quotes.map { it.id }.toSet().size)
        assertEquals(moved.id, joined.sessions.single().bookId)
    }

    @Test fun oneCopyGoesWithOneCopy() {
        // Two editions of the same novel on the account, and one copy on the device: nothing of the account's is folded into anything.
        val account = library(book(1, "Emma", "Jane Austen"), book(2, "Emma", "Jane Austen"))
        assertEquals(listOf(1L, 2L), LibraryJoin.join(account, library(book(50, "Emma", "Jane Austen")), counter()).books.map { it.id })
        // Two on each side: each finds its partner, and there are two afterwards.
        val device = library(book(50, "Emma", "Jane Austen", updatedAt = 500), book(51, "Emma", "Jane Austen", updatedAt = 600))
        val both = LibraryJoin.join(account, device, counter())
        assertEquals(listOf(1L to 500L, 2L to 600L), both.books.map { it.id to it.updatedAt })
        // Three on the device and one on the account: one pair, and the other two stay as they are.
        val three = library(book(50, "Emma", "Jane Austen"), book(51, "Emma", "Jane Austen"), book(52, "Emma", "Jane Austen"))
        assertEquals(listOf(1L, 51L, 52L), LibraryJoin.join(library(book(1, "Emma", "Jane Austen")), three, counter()).books.map { it.id })
    }

    @Test fun listsWithTheSameNameBecomeOneList() {
        val account = library(
            book(1, "Emma", "Jane Austen"),
            shelves = listOf(Shelf(id = 7, name = "Lieblinge", position = 0, createdAt = 1), Shelf(id = 8, name = "Klassiker", position = 1, createdAt = 1)),
            links = listOf(BookShelf(1, 7)),
            ornaments = listOf(Ornament(1, "list_7", OrnamentKind.CAT, 0)),
        )
        val device = library(
            book(50, "Momo", "Michael Ende"),
            shelves = listOf(
                Shelf(id = 70, name = " lieblinge ", position = 0, createdAt = 2),
                Shelf(id = 71, name = "Ferien", position = 1, createdAt = 2),
                // A list of another name that goes by a number the account uses.
                Shelf(id = 8, name = "Geliehen", position = 2, createdAt = 2),
            ),
            links = listOf(BookShelf(50, 70), BookShelf(50, 71), BookShelf(50, 8)),
            ornaments = listOf(Ornament(1, "list_70", OrnamentKind.PLANT, 2), Ornament(2, "list_8", OrnamentKind.MUG, 0)),
        )
        val joined = LibraryJoin.join(account, device, counter())
        // The account's list keeps its name and its place. Lists that are new come after, in the order they had.
        val names = joined.shelves.sortedBy { it.position }.map { it.name }
        assertEquals(listOf("Lieblinge", "Klassiker", "Ferien", "Geliehen"), names)
        val borrowed = joined.shelves.first { it.name == "Geliehen" }
        assertTrue(borrowed.id >= 9000)
        // The books of both are on the one list, and the device's other lists kept theirs.
        assertEquals(setOf(BookShelf(1, 7), BookShelf(50, 7), BookShelf(50, 71), BookShelf(50, borrowed.id)), joined.links.toSet())
        // What stood on the device's lists stands on the lists they became.
        assertEquals(
            setOf("list_7" to OrnamentKind.CAT, "list_7" to OrnamentKind.PLANT, "list_${borrowed.id}" to OrnamentKind.MUG),
            joined.ornaments.map { it.shelfKey to it.kind }.toSet(),
        )
        assertEquals(3, joined.ornaments.map { it.id }.toSet().size)
    }

    @Test fun ornamentsAndGoalsOfBothAreKeptAndIdenticalOnesOnce() {
        val year = Goal(id = 1, kind = GoalKind.BOOKS, target = 12, startDay = 0, endDay = 0, repeat = GoalRepeat.YEARLY, createdAt = 5)
        val account = library(goals = listOf(year), ornaments = listOf(Ornament(1, "READING", OrnamentKind.CANDLE, 0), Ornament(2, "READ", OrnamentKind.TROPHY, 3)))
        val device = library(
            goals = listOf(year.copy(id = 60, createdAt = 77), Goal(id = 61, kind = GoalKind.PAGES, target = 50, startDay = 0, endDay = 0, repeat = GoalRepeat.DAILY, createdAt = 77)),
            ornaments = listOf(
                Ornament(60, "READING", OrnamentKind.CANDLE, 0),
                // The same thing in another place, and another thing in the same place, are not the same.
                Ornament(61, "READING", OrnamentKind.CANDLE, 4),
                Ornament(2, "READ", OrnamentKind.GLOBE, 3),
            ),
        )
        val joined = LibraryJoin.join(account, device, counter())
        assertEquals(listOf(GoalKind.BOOKS, GoalKind.PAGES), joined.goals.map { it.kind })
        assertEquals(listOf(1L, 61L), joined.goals.map { it.id })
        assertEquals(
            setOf(Triple("READING", OrnamentKind.CANDLE, 0), Triple("READ", OrnamentKind.TROPHY, 3), Triple("READING", OrnamentKind.CANDLE, 4), Triple("READ", OrnamentKind.GLOBE, 3)),
            joined.ornaments.map { Triple(it.shelfKey, it.kind, it.position) }.toSet(),
        )
        assertEquals(4, joined.ornaments.map { it.id }.toSet().size)
    }

    @Test fun theSettingsAreTheAccounts() {
        val account = library(prefs = VaultPrefs(profileName = "Anna", theme = "midnight", shareRatings = false))
        val device = library(prefs = VaultPrefs(profileName = "Änni", theme = "paper"))
        assertEquals(account.prefs, LibraryJoin.join(account, device, counter()).prefs)
        // An account that never saved any keeps the device's.
        assertEquals(device.prefs, LibraryJoin.join(library(), device, counter()).prefs)
        assertNull(LibraryJoin.join(library(), library(), counter()).prefs)
    }

    @Test fun puttingTheSameLibraryInAgainChangesNothing() {
        val account = library(
            book(1, "Emma", "Jane Austen", updatedAt = 300), book(2, "Dune", "Frank Herbert"),
            shelves = listOf(Shelf(id = 7, name = "Lieblinge", position = 0, createdAt = 1)),
            links = listOf(BookShelf(1, 7)),
            quotes = listOf(Quote(id = 1, bookId = 1, text = "Handsome.", createdAt = 1)),
            goals = listOf(Goal(id = 1, kind = GoalKind.BOOKS, target = 12, startDay = 0, endDay = 0, repeat = GoalRepeat.YEARLY, createdAt = 5)),
            prefs = VaultPrefs(profileName = "Anna"),
        )
        val device = library(
            book(1, "Momo", "Michael Ende"), book(50, "Emma", "Jane Austen", updatedAt = 900),
            shelves = listOf(Shelf(id = 70, name = "lieblinge", position = 0, createdAt = 2), Shelf(id = 71, name = "Ferien", position = 1, createdAt = 2)),
            links = listOf(BookShelf(1, 70), BookShelf(50, 71)),
            quotes = listOf(Quote(id = 1, bookId = 1, text = "Zeit ist Leben.", createdAt = 1), Quote(id = 2, bookId = 50, text = "Seldom.", createdAt = 1)),
            sessions = listOf(ReadingSession(id = 1, bookId = 50, startedAt = 5, startPage = 0, endPage = 10)),
            ornaments = listOf(Ornament(1, "list_71", OrnamentKind.CAT, 0)),
            prefs = VaultPrefs(profileName = "Änni"),
        )
        val once = LibraryJoin.join(account, device, counter())
        // The account already holds both, as after a save that somebody else got in the way of: nothing is doubled.
        assertEquals(once, LibraryJoin.join(once, once, counter()))
        // A library put together with an empty one is itself, from either side.
        assertEquals(account, LibraryJoin.join(account, library(), counter()))
        assertFalse(LibraryJoin.join(library(), device, counter()).books.isEmpty())
        assertEquals(device.books, LibraryJoin.join(library(), device, counter()).books)
    }
}
