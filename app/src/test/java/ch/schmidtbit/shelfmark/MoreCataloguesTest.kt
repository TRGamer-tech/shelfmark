package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.BookSource
import ch.schmidtbit.shelfmark.data.remote.CoverFinder
import ch.schmidtbit.shelfmark.data.remote.HttpFetcher
import ch.schmidtbit.shelfmark.data.remote.ITunesApi
import ch.schmidtbit.shelfmark.data.remote.ImageProbe
import ch.schmidtbit.shelfmark.data.remote.LobidApi
import ch.schmidtbit.shelfmark.data.remote.MarcXml
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.data.remote.SruCatalogue
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The library catalogues and Apple Books, against answers recorded from the real services. */
class MoreCataloguesTest {
    private fun fixture(name: String): String =
        javaClass.classLoader!!.getResourceAsStream("fixtures/$name")!!.bufferedReader().use { it.readText() }

    private fun serving(name: String, seen: MutableList<String> = mutableListOf()) = HttpFetcher { url -> seen += url; fixture(name) }

    @Test fun k10plusRecordIsReadFromMarc() = runBlocking {
        val seen = mutableListOf<String>()
        val book = SruCatalogue.k10plus(serving("k10plus_isbn.xml", seen)).byIsbn("9783257229530", "de")!!
        assertTrue(seen.single().contains("query=pica.isb%3D9783257229530"))
        assertEquals("Der Vorleser", book.title)
        assertEquals("Roman", book.subtitle)
        assertEquals(listOf("Bernhard Schlink"), book.authors)
        assertEquals("Diogenes", book.publisher)
        assertEquals(206, book.pageCount)
        assertEquals("ger", book.language)
        assertTrue(book.year.matches(Regex("""(19|20)\d\d""")))
        // Among several editions the one that carries the scanned ISBN comes first.
        assertEquals("9783257229530", book.isbn)
    }

    @Test fun swisscoveryRecordIsReadFromMarc() = runBlocking {
        val book = SruCatalogue.swisscovery(serving("swisscovery_isbn.xml")).byIsbn("9783257229530", "de")!!
        // The Swiss catalogue wraps the article in marks so it can be skipped when sorting.
        assertEquals("Der Vorleser", book.title)
        assertEquals("Roman", book.subtitle)
        assertEquals(listOf("Bernhard Schlink"), book.authors)
        assertEquals("Diogenes", book.publisher)
        assertEquals(206, book.pageCount)
        assertEquals("9783257229530", book.isbn)
    }

    @Test fun sruSearchSpellsEachCatalogueItsOwnWay() = runBlocking {
        val seen = mutableListOf<String>()
        SruCatalogue.k10plus(serving("k10plus_isbn.xml", seen)).search("Der Vorleser: Schlink!", 20, "de", false)
        SruCatalogue.swisscovery(serving("swisscovery_isbn.xml", seen)).search("vorleser schlink", 20, "de", false)
        SruCatalogue.dnb(serving("k10plus_isbn.xml", seen)).search("vorleser schlink", 20, "de", false)
        SruCatalogue.dnb(serving("k10plus_isbn.xml", seen)).byIsbn("9783257229530", "de")
        fun query(url: String) = java.net.URLDecoder.decode(url.substringAfter("&query=").substringBefore("&maximumRecords"), "UTF-8")
        assertEquals("(pica.tit=Der or pica.per=Der) and (pica.tit=Vorleser or pica.per=Vorleser) and (pica.tit=Schlink or pica.per=Schlink)", query(seen[0]))
        assertTrue(seen[0].endsWith("maximumRecords=15"))
        assertEquals("(alma.title=vorleser or alma.creator=vorleser) and (alma.title=schlink or alma.creator=schlink) and alma.mms_material_type=BK", query(seen[1]))
        assertEquals("(tit=vorleser or per=vorleser) and (tit=schlink or per=schlink) and mat=books", query(seen[2]))
        assertTrue(seen[3].contains("services.dnb.de/sru/dnb") && seen[3].contains("query=num%3D9783257229530"))
    }

    @Test fun marcHelpersTidyNamesAndTitles() {
        assertEquals("Bernhard Schlink", MarcXml.personName("Schlink, Bernhard"))
        assertEquals("Johann Wolfgang von Goethe", MarcXml.personName("Goethe, Johann Wolfgang von,"))
        assertEquals("Homer", MarcXml.personName("Homer"))
        assertEquals("Der Vorleser", MarcXml.cleanTitle("<<Der>> Vorleser /"))
        assertEquals("Die Wand", MarcXml.cleanTitle("\u0098Die\u009C Wand :"))
        assertTrue(MarcXml.parse("<html>not a catalogue answer</html>", "x").isEmpty())
        assertTrue(MarcXml.parse("garbage", "x").isEmpty())
    }

    @Test fun lobidRecordIsRead() = runBlocking {
        val seen = mutableListOf<String>()
        val book = LobidApi(serving("lobid_isbn.json", seen)).byIsbn("9783257229530", "de")!!
        assertTrue(seen.single().contains("q=isbn%3A9783257229530"))
        assertEquals("Der Vorleser", book.title)
        assertEquals("Roman", book.subtitle)
        assertEquals(listOf("Bernhard Schlink"), book.authors)
        assertEquals("Diogenes", book.publisher)
        assertEquals("1997", book.year)
        assertEquals(206, book.pageCount)
        assertEquals("ger", book.language)
        assertEquals("9783257229530", book.isbn)
    }

    @Test fun lobidSuggestsWithAWildcard() = runBlocking {
        val seen = mutableListOf<String>()
        LobidApi(serving("lobid_search.json", seen)).search("der vorl", 6, "de", partial = true)
        assertTrue(seen.single().contains("q=der+AND+vorl*") || seen.single().contains("q=der+AND+vorl%2A"))
        assertTrue(seen.single().contains("filter=type%3ABook"))
    }

    @Test fun appleBooksGivesBlurbAndALargeCover() = runBlocking {
        val seen = mutableListOf<String>()
        val results = ITunesApi(serving("itunes_search.json", seen)) { "CH" }.search("der vorleser schlink", 5, "de", false)
        assertTrue(seen.single().contains("country=ch"))
        val first = results.first()
        assertEquals("Der Vorleser", first.title)
        assertEquals(listOf("Bernhard Schlink"), first.authors)
        assertTrue(first.description.startsWith("Sie ist reizbar"))
        assertTrue(first.coverUrl.contains("600x600bb"))
        assertEquals(BookFormat.UNKNOWN, first.format)
    }

    @Test fun theNovelRanksAboveBooksAboutIt() {
        val books = listOf(
            RemoteBook("Erläuterungen zu Bernhard Schlink, Der Vorleser", authors = listOf("Magret Möckel"), isbn = "9783804417557"),
            RemoteBook("Bernhard Schlink: Der Vorleser", authors = listOf("Sascha Feuchert")),
            RemoteBook("Der Vorleser", authors = listOf("Bernhard Schlink"), isbn = "9783257229530", coverUrl = "https://example.org/c.jpg"),
        )
        assertEquals("Der Vorleser", BookLookup.rank("der vorleser schlink", books).first().title)
        assertEquals("Der Vorleser", BookLookup.rank("vorleser", books).first().title)
    }

    private class Canned(override val name: String, override val suggests: Boolean, val book: RemoteBook?, val delayMs: Long = 0) : BookSource {
        var searches = 0
        override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> { searches++; delay(delayMs); return listOfNotNull(book) }
        override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? { delay(delayMs); return book }
    }

    @Test fun slowCataloguesAreNotAskedOnEveryKeystroke() = runBlocking {
        val quick = Canned("quick", suggests = true, RemoteBook("Momo", authors = listOf("Michael Ende")))
        val thorough = Canned("thorough", suggests = false, RemoteBook("Momo", authors = listOf("Michael Ende"), pageCount = 304))
        val lookup = BookLookup(listOf(quick, thorough))
        assertEquals(0, lookup.search("mom", 6, "de", partial = true).single().pageCount)
        assertEquals(0, thorough.searches)
        // The full search asks everyone and merges what they know.
        assertEquals(304, lookup.search("momo", 20, "de").single().pageCount)
    }

    @Test fun aFoundBookDoesNotWaitLongForStragglers() = runBlocking {
        val quick = Canned("quick", true, RemoteBook("Momo", isbn = "9783522202558"))
        val straggler = Canned("straggler", true, RemoteBook("Momo", description = "late"), delayMs = 30_000)
        val started = System.nanoTime()
        val book = BookLookup(listOf(quick, straggler), timeoutMs = 60_000, graceMs = 150).byIsbn("9783522202558")!!
        assertEquals("", book.description)
        assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
    }

    @Test fun coverFinderChecksIsbnServicesAndMatchingTitles() = runBlocking {
        val catalogue = object : BookSource {
            override val name = "c"
            override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean) = listOf(
                RemoteBook("Momo", authors = listOf("Michael Ende"), coverUrl = "https://example.org/momo.jpg"),
                RemoteBook("Momos Welt", coverUrl = "https://example.org/other.jpg"),
                RemoteBook("Der Zauberberg", coverUrl = "https://example.org/wrong.jpg"),
            )
            override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? = null
        }
        // Only the German National Library has a picture for this ISBN.
        val probe = ImageProbe { url -> "portal.dnb.de" in url }
        val found = CoverFinder(BookLookup(listOf(catalogue)), probe).candidates("Momo", "Michael Ende", "9783522202558", "de")
        assertEquals(
            listOf("https://portal.dnb.de/opac/mvb/cover?isbn=9783522202558", "https://example.org/momo.jpg", "https://example.org/other.jpg"),
            found,
        )
        // Without an ISBN and without a matching title there is nothing to offer.
        assertNull(CoverFinder(BookLookup(listOf(catalogue)), probe).best("Etwas ganz anderes", "", "", "de"))
    }
}
