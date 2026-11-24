package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.withFormOf
import ch.schmidtbit.shelfmark.data.model.withStatus
import ch.schmidtbit.shelfmark.data.model.withStatusOf
import ch.schmidtbit.shelfmark.data.server.HttpAnswer
import ch.schmidtbit.shelfmark.data.server.HttpPoster
import ch.schmidtbit.shelfmark.data.server.LazyPoster
import ch.schmidtbit.shelfmark.data.server.OkHttpPoster
import ch.schmidtbit.shelfmark.data.server.ServerConfig
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.ShareCodec
import ch.schmidtbit.shelfmark.ui.components.ratingFor
import ch.schmidtbit.shelfmark.ui.formatRating
import ch.schmidtbit.shelfmark.util.Numbers
import ch.schmidtbit.shelfmark.util.finite
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Random
import java.util.concurrent.TimeUnit

/** The small rules that keep one odd value, one slow line or one stale screen from costing somebody their library. */
class SafetyNetTest {

    // ---- numbers ----

    @Test fun onlyAPlainNumberIsANumber() {
        assertEquals(2.5, Numbers.decimal("2,5")!!, 0.0)
        assertEquals(12.0, Numbers.decimal(" 12 ")!!, 0.0)
        assertEquals(0.5, Numbers.decimal(".5")!!, 0.0)
        // Kotlin would read every one of these, the first three as numbers that cannot be stored.
        for (text in listOf("1e39", "NaN", "Infinity", "-1", "+1", "0x10", "1.2.3", "eins", "", "1 000")) assertNull(text, Numbers.decimal(text))

        assertEquals(3f, Numbers.seriesPosition("3"))
        assertEquals(2.5f, Numbers.seriesPosition("2,5"))
        assertEquals(0f, Numbers.seriesPosition("1e39"))
        assertEquals(0f, Numbers.seriesPosition("10000"))
        assertEquals(0f, Numbers.seriesPosition(""))
        assertTrue(Numbers.seriesPosition("9999").isFinite())

        // What a field lets in while somebody types.
        for (text in listOf("", "1", "12", "1,", "1,5", "1.25")) assertTrue(text, Numbers.typable(text))
        for (text in listOf("1e", "1e39", "-", "1,2,3", "a", "1 ")) assertFalse(text, Numbers.typable(text))

        assertEquals(0f, Float.POSITIVE_INFINITY.finite())
        assertEquals(0f, Float.NaN.finite())
        assertEquals(4.5f, 4.5f.finite())
        assertEquals(0.0, Double.NEGATIVE_INFINITY.finite(), 0.0)
        assertEquals("0", formatRating(Float.POSITIVE_INFINITY))
    }

    @Test fun aNumberThatIsNoneIsWrittenAndReadAsNotSet() {
        val odd = Book(id = 1, title = "Dune", rating = Float.NaN, seriesPosition = Float.POSITIVE_INFINITY, addedAt = 1, updatedAt = 1)
        val library = BackupPayload(
            exportedAt = 0,
            books = listOf(odd),
            shelves = emptyList(),
            links = emptyList(),
            quotes = emptyList(),
            sessions = listOf(ReadingSession(id = 1, bookId = 1, startedAt = 1, minutes = Float.NEGATIVE_INFINITY)),
            purchases = listOf(Purchase(id = 1, bookId = 1, day = 1, price = Double.NaN)),
        )
        // The writer of JSON refuses such numbers. Here they are written as what they mean.
        val written = ShareCodec.encodeVault(library).toString()
        assertFalse(written, written.contains("Infinity") || written.contains("NaN"))
        val back = ShareCodec.decodeVault(Json.parseToJsonElement(written))!!
        assertEquals(0f, back.books.single().rating)
        assertEquals(0f, back.books.single().seriesPosition)
        assertEquals(0f, back.sessions.single().minutes)
        assertEquals(0.0, back.purchases.single().price, 0.0)

        // Written by something else, far too large for the kind of number it is read into.
        val strange = """{"exportedAt":1,"books":[{"id":1,"title":"Dune","seriesPosition":1e39,"rating":4.5}],"shelves":[],"links":[],"quotes":[],
            "sessions":[{"id":1,"bookId":1,"minutes":1e999}],"purchases":[{"id":1,"bookId":1,"day":1,"price":1e999}]}"""
        val read = ShareCodec.decodeVault(Json.parseToJsonElement(strange))
        assertNotNull(read)
        assertEquals(0f, read!!.books.single().seriesPosition)
        assertEquals(4.5f, read.books.single().rating)
        assertEquals(0f, read.sessions.single().minutes)
        assertEquals(0.0, read.purchases.single().price, 0.0)

        // What is no number at all is still a document this version cannot read.
        assertNull(ShareCodec.decodeVault(Json.parseToJsonElement("""{"exportedAt":1,"books":[{"id":1,"title":"Dune","rating":"vier"}],"shelves":[],"links":[],"quotes":[]}""")))
    }

    // ---- screens that were open while something else changed the book ----

    @Test fun theFormOnlyWritesWhatTheReaderChangedInIt() {
        val opened = Book(id = 7, title = "Dune", authors = "Frank Herbert", pageCount = 600, coverUrl = "https://catalogue.example/old.jpg", rating = 3f, addedAt = 1, updatedAt = 1)
        // While the form stood open: stars and a review on the book page, and a sync that brought another cover and a publisher.
        val stored = opened.copy(rating = 5f, review = "Sand.", status = ReadingStatus.READ, coverUrl = "https://catalogue.example/new.jpg", publisher = "Ace", updatedAt = 9)
        // In the form the reader corrected the title and the number of pages, and nothing else.
        val form = opened.copy(title = "Dune Messiah", pageCount = 336)
        val saved = stored.withFormOf(opened, form)
        assertEquals("Dune Messiah", saved.title)
        assertEquals(336, saved.pageCount)
        // Everything the form never showed stays as it is stored.
        assertEquals(5f, saved.rating)
        assertEquals("Sand.", saved.review)
        assertEquals(ReadingStatus.READ, saved.status)
        // And so does what the form showed but the reader left alone.
        assertEquals("https://catalogue.example/new.jpg", saved.coverUrl)
        assertEquals("Ace", saved.publisher)
        assertEquals("Frank Herbert", saved.authors)

        // A form that nobody touched changes nothing at all.
        assertEquals(stored, stored.withFormOf(opened, opened))
        // And every field of the form can be changed through it.
        val all = opened.copy(
            title = "T", subtitle = "S", authors = "A", isbn = "9780441172719", publisher = "P", publishedYear = "1965", language = "en", pageCount = 1,
            format = BookFormat.PAPERBACK, description = "D", coverUrl = "https://c.example/x.jpg", coverPath = "x.jpg", genres = "G", tags = "t", series = "R", seriesPosition = 2f,
        )
        assertEquals(all.copy(rating = 5f, review = "Sand.", status = ReadingStatus.READ, updatedAt = 9), stored.withFormOf(opened, all))
    }

    @Test fun aMoveToAnotherListCanBeTakenBackExactly() {
        val shelf = Book(id = 1, title = "Dune", pageCount = 600, addedAt = 1, updatedAt = 1)
        val reading = shelf.copy(status = ReadingStatus.READING, startedOn = 100, currentPage = 250)
        val read = shelf.copy(status = ReadingStatus.READ, startedOn = 100, finishedOn = 120, currentPage = 600, readCount = 2)
        for (before in listOf(shelf, reading, read)) {
            for (status in ReadingStatus.entries) {
                val moved = before.withStatus(status, today = 500)
                assertEquals("$before to $status", before, moved.withStatusOf(before))
            }
        }
        // What else happened to the book since the move stays.
        val rated = read.withStatus(ReadingStatus.READING, 500).copy(rating = 4f, review = "Noch einmal.")
        assertEquals(read.copy(rating = 4f, review = "Noch einmal."), rated.withStatusOf(read))
    }

    @Test fun aScreenReaderSetsStarsOnTheStepsThereAre() {
        assertEquals(3.5f, ratingFor(3.3f))
        assertEquals(3f, ratingFor(3.2f))
        assertEquals(5f, ratingFor(9f))
        assertEquals(0f, ratingFor(-1f))
        assertEquals(0f, ratingFor(Float.NaN))
    }

    // ---- the line to the server ----

    @Test fun aLibraryAndAPictureAreGivenTimeOnASlowLine() {
        val config = ServerConfig("https://example.supabase.co", "sb_publishable_test")
        val poster = OkHttpPoster(OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build())
        fun secondsFor(url: String) = TimeUnit.NANOSECONDS.toSeconds(poster.callFor(Request.Builder().url(url).post("{}".toRequestBody()).build()).timeout().timeoutNanos())
        // Whatever carries a whole library, a friend's or a picture may take a minute.
        for (large in listOf(config.rpc("shelfmark_vault_pull"), config.rpc("shelfmark_vault_push"), config.rpc("shelfmark_publish"), config.rpc("shelfmark_sync"), config.cover("me/photo.jpg"), config.coverList)) {
            assertEquals(large, 60L, secondsFor(large))
        }
        // A question and its answer keep the short limit, so that a dead line is noticed soon.
        for (small in listOf(config.rpc("shelfmark_hello"), config.rpc("shelfmark_loan_act"), config.rpc("shelfmark_ping"), config.auth("token?grant_type=password"))) {
            assertEquals(small, 20L, secondsFor(small))
        }
    }

    @Test fun everyKindOfCallReachesTheServerThroughTheLazyPoster() = runBlocking {
        val seen = ArrayList<String>()
        var built = 0
        val real = object : HttpPoster {
            override suspend fun post(url: String, headers: Map<String, String>, body: String): HttpAnswer = HttpAnswer(200, "{}").also { seen += "POST $url" }
            override suspend fun send(method: String, url: String, headers: Map<String, String>, body: ByteArray?): HttpAnswer = HttpAnswer(200, "{}").also { seen += "$method $url" }
        }
        val lazy = LazyPoster { built++; real }
        // Nothing is built to start the app.
        assertEquals(0, built)
        assertEquals(200, lazy.post("https://s.example/a", emptyMap(), "{}").code)
        // A picture is sent, not answered with "not implemented", which is what a poster made of one function says.
        assertEquals(200, lazy.send("POST", "https://s.example/photo.jpg", emptyMap(), byteArrayOf(1)).code)
        assertEquals(200, lazy.send("DELETE", "https://s.example/photo.jpg", emptyMap(), null).code)
        assertEquals(listOf("POST https://s.example/a", "POST https://s.example/photo.jpg", "DELETE https://s.example/photo.jpg"), seen)
        assertEquals(1, built)
        assertEquals(501, HttpPoster { _, _, _ -> HttpAnswer(200, "{}") }.send("DELETE", "https://s.example/photo.jpg", emptyMap(), null).code)
    }

    // ---- what leaves the phone without anybody deciding so ----

    @Test fun nothingOfTheAppIsBackedUpOrTransferredByTheSystem() {
        // The tests run in the app's own folder.
        val main = File("src/main")
        val manifest = File(main, "AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:allowBackup=\"false\""))
        assertFalse(manifest.contains("android:allowBackup=\"true\""))
        assertTrue(manifest.contains("android:dataExtractionRules=\"@xml/data_extraction_rules\""))
        assertTrue(manifest.contains("android:fullBackupContent=\"@xml/backup_rules\""))

        val everyPlace = listOf("root", "file", "database", "sharedpref", "external")
        fun excluded(rules: String) = Regex("""<exclude domain="([a-z_]+)" path="\."\s*/>""").findAll(rules).map { it.groupValues[1] }.toList()
        // Before Android 12: one list.
        val old = File(main, "res/xml/backup_rules.xml").readText()
        assertFalse(old.contains("<include"))
        assertEquals(everyPlace, excluded(old))
        // From Android 12: one for the backup in the cloud, one for the move to a new phone.
        val rules = File(main, "res/xml/data_extraction_rules.xml").readText()
        assertFalse(rules.contains("<include"))
        val cloud = rules.substringAfter("<cloud-backup>").substringBefore("</cloud-backup>")
        val transfer = rules.substringAfter("<device-transfer>").substringBefore("</device-transfer>")
        assertEquals(everyPlace, excluded(cloud))
        assertEquals(everyPlace, excluded(transfer))
    }

    // ---- a long list from another app ----

    @Test fun theFirstBookThatIsTheSameIsFoundAtOnce() {
        val random = Random(11)
        fun book(n: Int, id: Long = 0) = Book(
            id = id,
            title = "Buch ${n % 700}",
            authors = if (n % 3 == 0) "" else "Autorin ${n % 40}, Zweite",
            isbn = if (n % 4 == 0) "97800000" + (10000 + n % 900) else "",
            addedAt = 1,
            updatedAt = 1,
        )
        // Whatever the old way of looking (book by book) found, the index finds, for a library that grows while it is asked.
        val plain = ArrayList<Book>()
        val index = CsvImporter.Index(emptyList())
        repeat(3000) {
            val next = book(random.nextInt(5000))
            val expected = plain.indexOfFirst { CsvImporter.sameBook(it, next) }
            assertEquals(expected, index.find(next))
            if (expected < 0) {
                plain += next
                index.add(next)
            } else if (it % 5 == 0) {
                // A book that gains an ISBN is found by it from then on.
                val filled = CsvImporter.fillGaps(plain[expected], next)
                plain[expected] = filled
                index.replace(expected, filled)
            }
        }
        assertEquals(plain.size, index.size)
        assertEquals(plain, (0 until index.size).map { index[it] })

        // And it does so quickly: forty thousand books held against forty thousand.
        val many = (0 until 40_000).map { Book(id = it + 1L, title = "Titel $it", authors = "Autor ${it % 500}", isbn = "9781" + (100000000 + it), addedAt = 1, updatedAt = 1) }
        val started = System.nanoTime()
        val large = CsvImporter.Index(many)
        var found = 0
        for (wanted in many) if (large.find(wanted.copy(id = 0, isbn = "")) >= 0) found++
        assertEquals(40_000, found)
        assertEquals(-1, large.find(Book(title = "Unbekannt", addedAt = 1, updatedAt = 1)))
        val seconds = (System.nanoTime() - started) / 1e9
        assertTrue("took $seconds s", seconds < 10)
    }
}
