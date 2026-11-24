package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.OrnamentKind
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.repo.CustomTheme
import ch.schmidtbit.shelfmark.data.repo.LoanBooks
import ch.schmidtbit.shelfmark.data.server.ServerApi
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.data.share.VaultPrefs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/**
 * The documents the app exchanges with the server, as examples in supabase/samples.
 * The website is written against these files, so they have to say what the app really
 * writes, and for a loan what it really reads: this test fails as soon as they differ. After a change to the format on
 * purpose, write them anew with SHELFMARK_WRITE_SAMPLES=1 and look at the difference.
 */
class ContractSamplesTest {
    private val pretty = Json { prettyPrint = true; prettyPrintIndent = "  " }
    private val folder = File("../supabase/samples")

    private val anna = "11111111-1111-4111-8111-111111111111"
    private val ben = "22222222-2222-4222-8222-222222222222"

    // Days are days since 1970, moments are milliseconds since 1970.
    private val day = 20_780L
    private val moment = 1_795_400_000_000L

    // Anna lent Dune to Ben, through a loan between friends. Momo she borrowed by hand, from somebody without Shelfmark.
    private val lentLoan = "3f2a9c1e-7b4d-4e8a-9c0d-112233445566"

    private val books = listOf(
        Book(
            id = 1, title = "Der Vorleser", authors = "Bernhard Schlink", isbn = "9783257229530", publisher = "Diogenes", publishedYear = "1997",
            language = "de", pageCount = 206, format = BookFormat.PAPERBACK, description = "Sie ist reizbar, rätselhaft und viel älter als er.",
            coverUrl = "https://covers.openlibrary.org/b/id/10527919-L.jpg", status = ReadingStatus.READ, rating = 4.5f, spice = 2,
            review = "Leise und hart zugleich.", startedOn = day - 12, finishedOn = day - 3, currentPage = 206, readCount = 1, favorite = true,
            genres = "Roman", tags = "Schule, Klassiker", addedAt = moment - 40 * 86_400_000L, updatedAt = moment - 3 * 86_400_000L,
        ),
        Book(
            id = 2, title = "Der Prozess", authors = "Franz Kafka", pageCount = 256, format = BookFormat.PAPERBACK, status = ReadingStatus.READING,
            startedOn = day - 2, currentPage = 120, lendable = false, addedAt = moment - 20 * 86_400_000L, updatedAt = moment,
        ),
        Book(
            id = 3, title = "Dune", subtitle = "Der Wüstenplanet", authors = "Frank Herbert", pageCount = 896, format = BookFormat.HARDCOVER,
            status = ReadingStatus.NONE, lentTo = "Ben", lentSince = day - 1, loanId = lentLoan, series = "Dune", seriesPosition = 1f,
            addedAt = moment - 10 * 86_400_000L, updatedAt = moment - 86_400_000L,
        ),
        Book(
            id = 1_795_400_000_000_123, title = "Babel", authors = "R. F. Kuang", status = ReadingStatus.WISHLIST, ownership = Ownership.NOT_OWNED,
            lendable = false, addedAt = moment, updatedAt = moment,
        ),
        Book(
            id = 5, title = "Momo", authors = "Michael Ende", format = BookFormat.AUDIOBOOK, pageCount = 480, status = ReadingStatus.ABANDONED,
            ownership = Ownership.BORROWED, borrowedFrom = "Clara", lendable = false, coverPath = "cover_5.jpg", addedAt = moment, updatedAt = moment,
        ),
    )

    private val vault = BackupPayload(
        exportedAt = moment,
        books = books,
        shelves = listOf(Shelf(id = 1, name = "Lieblinge", position = 0, createdAt = moment), Shelf(id = 2, name = "Urlaub", position = 1, createdAt = moment)),
        links = listOf(BookShelf(1, 1), BookShelf(3, 1)),
        quotes = listOf(Quote(id = 1, bookId = 1, text = "Ich habe damals nichts offenbart, was ich hätte verschweigen müssen.", page = 129, note = "Kapitel 7", createdAt = moment)),
        sessions = listOf(
            ReadingSession(id = 1, bookId = 2, startedAt = moment - 86_400_000L, startPage = 0, endPage = 60, minutes = 75f),
            ReadingSession(id = 2, bookId = 2, startedAt = moment, startPage = 60, endPage = 120, minutes = 80f, note = "Im Zug"),
        ),
        notes = listOf(Note(id = 1, bookId = 2, title = "Figuren", text = "K. hat keinen Vornamen, nur einen Buchstaben.", page = 14, createdAt = moment)),
        goals = listOf(Goal(id = 1, kind = GoalKind.BOOKS, target = 12, startDay = 0, endDay = 0, repeat = GoalRepeat.YEARLY, createdAt = moment)),
        purchases = listOf(Purchase(id = 1, bookId = 1, day = day - 30, price = 14.9, currency = "CHF", store = "Orell Füssli")),
        ornaments = listOf(Ornament(id = 1, shelfKey = "READING", kind = OrnamentKind.CANDLE, position = 1), Ornament(id = 2, shelfKey = "list_1", kind = OrnamentKind.CAT, position = 2)),
        prefs = VaultPrefs(
            profileName = "Anna", shareStatus = true, shareRatings = false, minutesPerPage = 2f, theme = "custom:moor",
            customThemes = listOf(CustomTheme("moor", "Moor", 0xFF101510.toInt(), 0xFF1C241C.toInt(), 0xFF7BC47F.toInt(), 0xFFE8F0E8.toInt())),
            viewMode = "SPINES", sort = "TITLE", motion = false,
        ),
    )

    private fun library(includeStatus: Boolean, includeRatings: Boolean): JsonElement = ShareCodec.encodeElement(
        Envelope(
            type = Envelope.TYPE_LIBRARY,
            library = ShareCodec.buildLibrary(anna, "Anna", vault.books, vault.shelves, vault.links, includeStatus, includeRatings, now = moment),
        ),
    )

    /**
     * A loan as shelfmark_sync, shelfmark_loan_ask and shelfmark_loan_act tell it to one of its
     * two sides, here to Anna, the lender: Ben has her Dune and it is due back in three weeks.
     */
    private val loan = buildJsonObject {
        put("id", lentLoan)
        put("role", "lender")
        put("peer", ben)
        put("peerName", "Ben")
        put("bookId", 3)
        put("book", buildJsonObject {
            put("title", "Dune")
            put("authors", "Frank Herbert")
            put("isbn", "")
            put("coverUrl", "")
            put("pageCount", 896)
            put("format", "HARDCOVER")
        })
        put("note", "Für die Ferien?")
        put("state", "on_loan")
        put("reason", "")
        put("dueOn", day + 20)
        put("askedAt", moment - 3 * 86_400_000L)
        put("agreedAt", moment - 2 * 86_400_000L)
        put("handedAt", moment - 86_400_000L - 3_600_000L)
        put("receivedAt", moment - 86_400_000L)
        put("givenBackAt", JsonNull)
        put("closedAt", JsonNull)
        put("updatedAt", moment - 86_400_000L)
        put("byMe", false)
    }

    private fun check(name: String, document: JsonElement) {
        val text = pretty.encodeToString(JsonElement.serializer(), document) + "\n"
        val file = File(folder, name)
        if (System.getenv("SHELFMARK_WRITE_SAMPLES") == "1") {
            folder.mkdirs()
            file.writeText(text)
        }
        assertEquals("supabase/samples/$name is not what the app writes. See the note on this test.", file.takeIf { it.exists() }?.readText(), text)
    }

    @Test fun theSamplesAreWhatTheAppWrites() {
        check("vault.json", ShareCodec.encodeVault(vault))
        check("library-everything.json", library(includeStatus = true, includeRatings = true))
        check("library-owned-only.json", library(includeStatus = false, includeRatings = false))
        check("loan.json", loan)
    }

    @Test fun aLoanIsReadTheWayTheSampleSaysIt() {
        assertEquals(
            Loan(
                id = lentLoan, lender = true, peerId = ben, peerName = "Ben", bookId = 3,
                title = "Dune", authors = "Frank Herbert", pageCount = 896, format = BookFormat.HARDCOVER,
                note = "Für die Ferien?", state = LoanState.ON_LOAN, dueOn = day + 20,
                askedAt = moment - 3 * 86_400_000L, agreedAt = moment - 2 * 86_400_000L, handedAt = moment - 86_400_000L - 3_600_000L,
                receivedAt = moment - 86_400_000L, updatedAt = moment - 86_400_000L, byMe = false,
            ),
            ServerApi.readLoan(loan),
        )
        // The sample and the vault tell one story: the book in the vault is lent through this very loan,
        // and it says what the rules for the books make of it.
        val lent = vault.books.single { it.loanId == lentLoan }
        assertEquals(3L, lent.id)
        assertEquals("Ben", lent.lentTo)
        assertEquals(day - 1, lent.lentSince)
        assertEquals(1_111_235_846_714_580L, LoanBooks.loanBookId(lentLoan))
        // The other side of the same loan, and a loan that never got a day.
        val asBorrower = ServerApi.readLoan(buildJsonObject { loan.forEach { (key, value) -> put(key, value) }; put("role", "borrower"); put("dueOn", JsonNull); put("byMe", true) })!!
        assertEquals(false, asBorrower.lender)
        assertNull(asBorrower.dueOn)
        assertEquals(true, asBorrower.byMe)
        // What is no loan, or a loan in a state from the future, is left out and breaks nothing.
        assertNull(ServerApi.readLoan(buildJsonObject { loan.forEach { (key, value) -> put(key, value) }; put("state", "lost") }))
        assertNull(ServerApi.readLoan(buildJsonObject { put("id", lentLoan) }))
        assertNull(ServerApi.readLoan(JsonNull))
    }

    @Test fun aVaultIsReadBackTheSame() {
        assertEquals(vault, ShareCodec.decodeVault(ShareCodec.encodeVault(vault)))
        // A document from a newer client may hold things this app does not know. They do no harm.
        val newer = Json.parseToJsonElement("""{"exportedAt":1,"books":[{"id":9,"title":"X","somethingNew":true}],"shelves":[],"links":[],"quotes":[],"fromTheFuture":{"a":1}}""")
        assertEquals("X", ShareCodec.decodeVault(newer)!!.books.single().title)
        // And one from before the loans still lists borrow requests. It is read without them.
        val older = Json.parseToJsonElement(
            """{"exportedAt":1,"books":[{"id":3,"title":"Dune","lentTo":"Ben","lentSince":20779}],"shelves":[],"links":[],"quotes":[],
               "requests":[{"id":"req-1","incoming":true,"bookRemoteId":3,"bookTitle":"Dune","bookAuthors":"Frank Herbert","peerId":"$ben","peerName":"Ben","note":"Für die Ferien?","status":"ACCEPTED","createdAt":1795227200000,"answeredAt":1795313600000},
                           {"id":"req-2","incoming":false,"bookRemoteId":7,"bookTitle":"Emma","peerId":"$ben","peerName":"Ben","createdAt":1795400000000}]}""",
        )
        val read = ShareCodec.decodeVault(older)!!
        assertEquals("Ben", read.books.single().lentTo)
        assertEquals("", read.books.single().loanId)
    }

    @Test fun whatTheWebsiteWritesIsUnderstood() {
        // Written by the website's own tests. Until that file exists there is nothing to check here.
        val file = File("../web/e2e/fixtures/vault-from-web.json").takeIf { it.exists() } ?: return
        val vault = ShareCodec.decodeVault(Json.parseToJsonElement(file.readText()))
        assertNotNull("The app cannot read a vault the website wrote.", vault)
        assertEquals(true, vault!!.books.isNotEmpty())
    }
}
