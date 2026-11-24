package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.repo.BackupManager
import ch.schmidtbit.shelfmark.data.repo.CoverStore
import ch.schmidtbit.shelfmark.data.repo.ImportResult
import ch.schmidtbit.shelfmark.data.repo.LibraryRepository
import ch.schmidtbit.shelfmark.data.repo.RejectReason
import ch.schmidtbit.shelfmark.data.repo.SettingsRepository
import ch.schmidtbit.shelfmark.data.repo.SocialRepository
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/** One simulated phone: its own database, settings and repositories. */
private class Device(context: Context, folder: TemporaryFolder, name: String) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val db = AppDatabase.inMemory(context)
    val settings = SettingsRepository(PreferenceDataStoreFactory.create(scope = scope) { folder.newFile("$name.preferences_pb").also { it.delete() } })
    val covers = CoverStore(context)
    val library = LibraryRepository(db, covers)
    val social = SocialRepository(db, settings)
    val backup = BackupManager(db, covers)

    init {
        runBlocking { settings.setProfileName(name) }
    }

    fun close() {
        db.close()
        scope.cancel()
    }
}

/** What still goes from phone to phone as a file: a shelf to look at, and a backup. */
@RunWith(RobolectricTestRunner::class)
class SocialFlowTest {
    @get:Rule val folder = TemporaryFolder()
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val devices = mutableListOf<Device>()

    private fun device(name: String) = Device(context, folder, name).also { devices += it }

    @After fun tearDown() = devices.forEach { it.close() }

    @Test fun aShelfTravelsAsAFile() = runBlocking {
        val anna = device("Anna")
        val ben = device("Ben")
        val duneId = anna.library.addBook(Book(title = "Dune", authors = "Frank Herbert", status = ReadingStatus.READ, rating = 5f))
        anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", lentTo = "Clara"))
        val momoId = anna.library.addBook(Book(title = "Momo", authors = "Michael Ende"))

        // Anna shares her library, Ben opens the file.
        val libraryFile = ShareCodec.encode(anna.social.exportLibrary(includeStatus = true, includeRatings = true))
        val imported = ben.social.import(libraryFile) as ImportResult.LibraryImported
        assertEquals("Anna", imported.name)
        assertEquals(3, imported.bookCount)
        val annasBooks = ben.social.friendBooks(imported.friendId).first()
        val dune = annasBooks.first { it.title == "Dune" }
        assertTrue(dune.available)
        assertEquals(duneId, dune.remoteId)
        assertEquals(5f, dune.rating)
        assertEquals(ReadingStatus.READ, dune.status)
        // Lent by hand, to somebody without Shelfmark: not to be had right now.
        assertFalse(annasBooks.first { it.title == "Emma" }.available)
        // A shelf from a file is a shelf to look at. The friend is not connected, and nothing is asked through a file.
        assertFalse(ben.social.friend(imported.friendId).first()!!.online)
        assertEquals(0, ben.social.waitingLoans.first())

        // A book that a loan between friends has reserved or out is taken, though the book itself does not say so yet.
        fun loanOf(bookId: Long, state: LoanState) = Loan(id = "loan-$bookId", lender = true, peerId = "cleo", peerName = "Cleo", bookId = bookId, title = "?", state = state)
        anna.db.social().upsertLoans(listOf(loanOf(duneId, LoanState.AGREED), loanOf(momoId, LoanState.ASKED)))
        assertEquals(1, anna.social.waitingLoans.first())
        val later = anna.social.exportLibrary(includeStatus = true, includeRatings = true).library!!.books.associateBy { it.title }
        assertFalse(later.getValue("Dune").available)
        // A question alone takes nothing off the shelf.
        assertTrue(later.getValue("Momo").available)
        // What I borrowed is not mine to lend, and a loan of mine as borrower holds none of my books.
        anna.db.social().upsertLoans(listOf(Loan(id = "loan-x", lender = false, peerId = "cleo", peerName = "Cleo", bookId = momoId, title = "?", state = LoanState.ON_LOAN)))
        assertTrue(anna.social.exportLibrary(includeStatus = true, includeRatings = true).library!!.books.first { it.title == "Momo" }.available)
    }

    @Test fun misdirectedFilesAreRejected() = runBlocking {
        val anna = device("Anna")
        val ben = device("Ben")
        anna.library.addBook(Book(title = "Dune"))
        val libraryFile = ShareCodec.encode(anna.social.exportLibrary(true, true))

        assertEquals(ImportResult.Rejected(RejectReason.OWN_LIBRARY), anna.social.import(libraryFile))
        assertEquals(ImportResult.Rejected(RejectReason.NOT_SHELFMARK), ben.social.import("just some text"))
        assertEquals(ImportResult.Rejected(RejectReason.NEWER_VERSION), ben.social.import(libraryFile.replaceFirst("\"v\":1", "\"v\":2")))

        // A borrow request and its answer, as files of a version from before the loans: said to be
        // from an older version, whoever they were meant for, and nothing comes of them.
        val request = """{"app":"shelfmark","v":1,"type":"lend_request","request":{"requestId":"req-1","bookId":1,"bookTitle":"Dune","fromId":"b","fromName":"Ben","toId":"a","note":"?","createdAt":5}}"""
        val answer = """{"app":"shelfmark","v":1,"type":"lend_answer","answer":{"requestId":"req-1","accepted":true,"bookTitle":"Dune","fromId":"a","fromName":"Anna","toId":"b","answeredAt":9}}"""
        assertEquals(ImportResult.Rejected(RejectReason.OLD_REQUEST), anna.social.import(request))
        assertEquals(ImportResult.Rejected(RejectReason.OLD_REQUEST), ben.social.import(answer))
        assertTrue(anna.social.loans.first().isEmpty())
        assertTrue(anna.library.getBook(anna.library.allBooks().single().id)!!.lentTo.isBlank())
        // A Shelfmark file of a kind nobody ever wrote is simply none.
        assertEquals(ImportResult.Rejected(RejectReason.NOT_SHELFMARK), ben.social.import("""{"app":"shelfmark","v":1,"type":"something_else"}"""))
    }

    @Test fun reimportingALibraryReplacesTheOldSnapshot() = runBlocking {
        val anna = device("Anna")
        val ben = device("Ben")
        val id = anna.library.addBook(Book(title = "Dune"))
        val first = ben.social.import(ShareCodec.encode(anna.social.exportLibrary(true, true))) as ImportResult.LibraryImported
        anna.library.deleteBook(id)
        anna.library.addBook(Book(title = "Emma"))
        anna.library.addBook(Book(title = "Persuasion"))
        ben.social.import(ShareCodec.encode(anna.social.exportLibrary(true, false)))
        assertEquals(1, ben.social.friends.first().size)
        assertEquals(listOf("Emma", "Persuasion"), ben.social.friendBooks(first.friendId).first().map { it.title })
        assertFalse(ben.social.friend(first.friendId).first()!!.includesRatings)
    }

    @Test fun backupRestoresBooksListsAndQuotes() = runBlocking {
        val old = device("Old phone")
        val bookId = old.library.addBook(Book(title = "Dune", rating = 4.5f, spice = 1, review = "Sand everywhere"))
        val shelfId = old.library.createShelf("Sci-Fi")
        old.library.setOnShelf(bookId, shelfId, true)
        old.library.saveQuote(Quote(bookId = bookId, text = "Fear is the mind-killer.", page = 12))
        val zip = ByteArrayOutputStream().also { old.backup.export(it) }.toByteArray()

        val fresh = device("New phone")
        fresh.library.addBook(Book(title = "Will be replaced"))
        assertEquals(1, fresh.backup.restore(ByteArrayInputStream(zip)))
        val restored = fresh.library.books.first().single()
        assertEquals("Dune", restored.title)
        assertEquals(4.5f, restored.rating)
        assertEquals("Sand everywhere", restored.review)
        assertEquals("Sci-Fi", fresh.library.shelves.first().single().name)
        assertEquals(1, fresh.library.links.first().size)
        assertEquals("Fear is the mind-killer.", fresh.library.quotes.first().single().quote.text)

        // Garbage is refused and leaves the library alone.
        assertNull(fresh.backup.restore(ByteArrayInputStream("not a zip".toByteArray())))
        assertEquals(1, fresh.library.books.first().size)
    }
}
