package ch.schmidtbit.shelfmark

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.schmidtbit.shelfmark.data.db.AppDatabase
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.LendStatus
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
import org.junit.Assert.assertNotNull
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

/** The whole friend workflow, played between two simulated phones exchanging files. */
@RunWith(RobolectricTestRunner::class)
class SocialFlowTest {
    @get:Rule val folder = TemporaryFolder()
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val devices = mutableListOf<Device>()

    private fun device(name: String) = Device(context, folder, name).also { devices += it }

    @After fun tearDown() = devices.forEach { it.close() }

    @Test fun shareLibraryRequestBookAndAnswerYes() = runBlocking {
        val anna = device("Anna")
        val ben = device("Ben")
        val duneId = anna.library.addBook(Book(title = "Dune", authors = "Frank Herbert", status = ReadingStatus.READ, rating = 5f))
        anna.library.addBook(Book(title = "Emma", authors = "Jane Austen", lentTo = "Clara"))

        // Anna shares her library, Ben opens the file.
        val libraryFile = ShareCodec.encode(anna.social.exportLibrary(includeStatus = true, includeRatings = true))
        val imported = ben.social.import(libraryFile) as ImportResult.LibraryImported
        assertEquals("Anna", imported.name)
        assertEquals(2, imported.bookCount)
        val annasBooks = ben.social.friendBooks(imported.friendId).first()
        val dune = annasBooks.first { it.title == "Dune" }
        assertTrue(dune.available)
        assertEquals(5f, dune.rating)
        assertEquals(ReadingStatus.READ, dune.status)
        assertFalse(annasBooks.first { it.title == "Emma" }.available)

        // Ben asks for Dune, the request travels to Anna.
        val requestFile = ShareCodec.encode(ben.social.createRequest(dune, "Für die Ferien?"))
        assertEquals(LendStatus.PENDING, ben.social.requests.first().single().status)
        val received = anna.social.import(requestFile) as ImportResult.RequestReceived
        assertEquals("Ben", received.fromName)
        assertEquals("Dune", received.bookTitle)
        assertEquals(1, anna.social.pendingIncoming.first())
        val incoming = anna.social.requests.first().single()
        assertTrue(incoming.incoming)
        assertEquals("Für die Ferien?", incoming.note)

        // Anna says yes: her copy is now marked as lent to Ben.
        val answerFile = ShareCodec.encode(anna.social.answerRequest(received.requestId, accept = true)!!)
        assertEquals(0, anna.social.pendingIncoming.first())
        val lent = anna.library.getBook(duneId)!!
        assertEquals("Ben", lent.lentTo)
        assertNotNull(lent.lentSince)
        assertFalse(lent.availableToLend)

        // Ben opens the answer.
        val answer = ben.social.import(answerFile) as ImportResult.AnswerReceived
        assertTrue(answer.accepted)
        assertEquals("Anna", answer.fromName)
        assertEquals(LendStatus.ACCEPTED, ben.social.requests.first().single().status)

        // Opening the request file a second time must not reopen the question.
        anna.social.import(requestFile)
        assertEquals(LendStatus.ACCEPTED, anna.social.requests.first().single().status)
    }

    @Test fun answeringNoLeavesTheBookAvailable() = runBlocking {
        val anna = device("Anna")
        val ben = device("Ben")
        val id = anna.library.addBook(Book(title = "Dune"))
        val friend = ben.social.import(ShareCodec.encode(anna.social.exportLibrary(true, true))) as ImportResult.LibraryImported
        val book = ben.social.friendBooks(friend.friendId).first().single()
        val request = anna.social.import(ShareCodec.encode(ben.social.createRequest(book, ""))) as ImportResult.RequestReceived
        val answer = ben.social.import(ShareCodec.encode(anna.social.answerRequest(request.requestId, accept = false)!!)) as ImportResult.AnswerReceived
        assertFalse(answer.accepted)
        assertEquals(LendStatus.DECLINED, ben.social.requests.first().single().status)
        assertTrue(anna.library.getBook(id)!!.availableToLend)
    }

    @Test fun misdirectedFilesAreRejected() = runBlocking {
        val anna = device("Anna")
        val ben = device("Ben")
        val clara = device("Clara")
        anna.library.addBook(Book(title = "Dune"))
        val libraryFile = ShareCodec.encode(anna.social.exportLibrary(true, true))

        assertEquals(ImportResult.Rejected(RejectReason.OWN_LIBRARY), anna.social.import(libraryFile))
        assertEquals(ImportResult.Rejected(RejectReason.NOT_SHELFMARK), ben.social.import("just some text"))

        val friend = ben.social.import(libraryFile) as ImportResult.LibraryImported
        val request = ShareCodec.encode(ben.social.createRequest(ben.social.friendBooks(friend.friendId).first().single(), ""))
        // Clara is not the owner Ben asked.
        assertEquals(ImportResult.Rejected(RejectReason.NOT_FOR_ME), clara.social.import(request))
        // An answer to a request Clara never made.
        val received = anna.social.import(request) as ImportResult.RequestReceived
        val answer = ShareCodec.encode(anna.social.answerRequest(received.requestId, true)!!)
        assertEquals(ImportResult.Rejected(RejectReason.UNKNOWN_REQUEST), clara.social.import(answer))
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
