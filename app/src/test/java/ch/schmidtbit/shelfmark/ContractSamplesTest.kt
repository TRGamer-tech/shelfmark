package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Goal
import ch.schmidtbit.shelfmark.data.model.GoalKind
import ch.schmidtbit.shelfmark.data.model.GoalRepeat
import ch.schmidtbit.shelfmark.data.model.LendRequest
import ch.schmidtbit.shelfmark.data.model.LendStatus
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
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.Envelope
import ch.schmidtbit.shelfmark.data.share.LendAnswerMsg
import ch.schmidtbit.shelfmark.data.share.LendRequestMsg
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.data.share.VaultPrefs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File

/**
 * The documents the app exchanges with the server, as examples in supabase/samples.
 * The website is written against these files, so they have to say what the app really
 * writes: this test fails as soon as they differ. After a change to the format on
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
            status = ReadingStatus.NONE, lentTo = "Ben", lentSince = day - 1, series = "Dune", seriesPosition = 1f,
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
        requests = listOf(
            LendRequest(id = "req-1", incoming = true, bookRemoteId = 3, bookTitle = "Dune", bookAuthors = "Frank Herbert", peerId = ben, peerName = "Ben", note = "Für die Ferien?", status = LendStatus.ACCEPTED, createdAt = moment - 2 * 86_400_000L, answeredAt = moment - 86_400_000L),
            LendRequest(id = "req-2", incoming = false, bookRemoteId = 7, bookTitle = "Emma", peerId = ben, peerName = "Ben", createdAt = moment),
        ),
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

    private val request = ShareCodec.encodeElement(
        Envelope(
            type = Envelope.TYPE_REQUEST,
            request = LendRequestMsg(requestId = "req-1", bookId = 3, bookTitle = "Dune", bookAuthors = "Frank Herbert", fromId = ben, fromName = "Ben", toId = anna, note = "Für die Ferien?", createdAt = moment),
        ),
    )

    private val answer = ShareCodec.encodeElement(
        Envelope(
            type = Envelope.TYPE_ANSWER,
            answer = LendAnswerMsg(requestId = "req-1", accepted = true, bookTitle = "Dune", fromId = anna, fromName = "Anna", toId = ben, answeredAt = moment),
        ),
    )

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
        check("lend-request.json", request)
        check("lend-answer.json", answer)
    }

    @Test fun aVaultIsReadBackTheSame() {
        assertEquals(vault, ShareCodec.decodeVault(ShareCodec.encodeVault(vault)))
        // A document from a newer client may hold things this app does not know. They do no harm.
        val newer = Json.parseToJsonElement("""{"exportedAt":1,"books":[{"id":9,"title":"X","somethingNew":true}],"shelves":[],"links":[],"quotes":[],"fromTheFuture":{"a":1}}""")
        assertEquals("X", ShareCodec.decodeVault(newer)!!.books.single().title)
    }

    @Test fun whatTheWebsiteWritesIsUnderstood() {
        // Written by the website's own tests. Until that file exists there is nothing to check here.
        val file = File("../web/e2e/fixtures/vault-from-web.json").takeIf { it.exists() } ?: return
        val vault = ShareCodec.decodeVault(Json.parseToJsonElement(file.readText()))
        assertNotNull("The app cannot read a vault the website wrote.", vault)
        assertEquals(true, vault!!.books.isNotEmpty())
    }
}
