package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.BookSource
import ch.schmidtbit.shelfmark.data.remote.GoogleBooksApi
import ch.schmidtbit.shelfmark.data.remote.HttpFetcher
import ch.schmidtbit.shelfmark.data.remote.OpenLibraryApi
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** Parsers run against responses recorded from the real services. */
class CatalogueTest {
    private fun fixture(name: String): String =
        javaClass.classLoader!!.getResourceAsStream("fixtures/$name")!!.bufferedReader().use { it.readText() }

    /** Serves fixtures by URL fragment, 404 (null) for everything else. */
    private fun fakeHttp(vararg routes: Pair<String, String>, seen: MutableList<String> = mutableListOf()) = HttpFetcher { url ->
        seen += url
        routes.firstOrNull { url.contains(it.first) }?.second?.let(::fixture)
    }

    private val failing = HttpFetcher { throw IOException("HTTP 429") }

    @Test fun openLibrarySearchPrefersTheEditionInTheUsersLanguage() = runBlocking {
        val seen = mutableListOf<String>()
        val api = OpenLibraryApi(fakeHttp("search.json" to "ol_search.json", seen = seen))
        val results = api.search("der vorleser schlink", 5, "de")
        assertTrue(seen.single().contains("q=der+vorleser+schlink"))
        assertTrue(seen.single().contains("lang=de"))
        val first = results.first()
        assertEquals("Der Vorleser", first.title)
        assertEquals(listOf("Bernhard Schlink"), first.authors)
        assertEquals("9783257229530", first.isbn)
        assertEquals("Diogenes", first.publisher)
        assertEquals("1997", first.year)
        assertEquals(206, first.pageCount)
        assertEquals("https://covers.openlibrary.org/b/id/8782586-L.jpg", first.coverUrl)
        assertEquals(2, results.size)
    }

    @Test fun openLibraryIsbnCombinesEditionDataAndWorkBlurb() = runBlocking {
        val api = OpenLibraryApi(
            fakeHttp("api/books" to "ol_data.json", "/isbn/" to "ol_isbn.json", "/works/OL14871157W.json" to "ol_work.json"),
        )
        val book = api.byIsbn("9783257229530", "de")!!
        assertEquals("Der Vorleser", book.title)
        assertEquals(listOf("Bernhard Schlink"), book.authors)
        assertEquals(206, book.pageCount)
        assertEquals("Diogenes", book.publisher)
        assertEquals("2000", book.year)
        assertEquals(BookFormat.PAPERBACK, book.format)
        assertEquals("ger", book.language)
        assertTrue(book.description.startsWith("Sie ist reizbar"))
        assertTrue(book.coverUrl.startsWith("https://covers.openlibrary.org/"))
    }

    @Test fun openLibraryUnknownIsbnIsNull() = runBlocking {
        assertNull(OpenLibraryApi(HttpFetcher { url -> if (url.contains("api/books")) "{}" else null }).byIsbn("9780000000002", "en"))
    }

    @Test fun googleVolumesAreParsedAndCleaned() = runBlocking {
        val api = GoogleBooksApi(fakeHttp("volumes" to "google_volumes.json"))
        val results = api.search("vorleser", 10, "de")
        val first = results.first()
        assertEquals("Der Vorleser", first.title)
        assertEquals("Roman", first.subtitle)
        assertEquals("9783257229530", first.isbn)
        assertEquals("1997", first.year)
        assertEquals(208, first.pageCount)
        assertEquals("Sie ist reizbar, rätselhaft und viel älter als er.\n\nEin Roman über Schuld & Scham.", first.description)
        assertTrue(first.coverUrl.startsWith("https://"))
        assertTrue("edge=curl" !in first.coverUrl)
        // Old editions without a code still come through, that is what the title search is for.
        assertEquals("", results[1].isbn)
        assertEquals("Erika Muster, Hans Beispiel", results[1].authorLine)
        assertEquals("1953", results[1].year)
    }

    @Test fun googleKeyIsAppendedOnlyWhenSet() = runBlocking {
        val seen = mutableListOf<String>()
        GoogleBooksApi(fakeHttp(seen = seen)) { "" }.byIsbn("9783257229530", "de")
        GoogleBooksApi(fakeHttp(seen = seen)) { "my key" }.byIsbn("9783257229530", "de")
        assertTrue("key=" !in seen[0])
        assertTrue(seen[1].endsWith("&key=my+key"))
    }

    @Test fun lookupMergesBothCataloguesForAnIsbn() = runBlocking {
        val ol = OpenLibraryApi(fakeHttp("api/books" to "ol_data.json", "/isbn/" to "ol_isbn.json"))
        val google = GoogleBooksApi(fakeHttp("volumes" to "google_volumes.json"))
        val book = BookLookup(listOf(ol, google)).byIsbn("9783257229530", "de")!!
        assertEquals("Der Vorleser", book.title)
        assertEquals(206, book.pageCount)                       // first catalogue wins where both know
        assertEquals("Roman", book.subtitle)                     // gap filled by the second
        assertTrue(book.description.startsWith("Sie ist reizbar"))
        assertEquals(BookFormat.PAPERBACK, book.format)
        assertTrue(book.coverUrl.contains("openlibrary"))
    }

    @Test fun lookupSurvivesOneCatalogueBeingDown() = runBlocking {
        val google = GoogleBooksApi(failing)
        val ol = OpenLibraryApi(fakeHttp("search.json" to "ol_search.json"))
        val results = BookLookup(listOf(ol, google)).search("der vorleser", 20, "de")
        assertEquals("Der Vorleser", results.first().title)
    }

    @Test fun lookupFailsOnlyWhenEveryCatalogueFails() {
        val lookup = BookLookup(listOf(OpenLibraryApi(failing), GoogleBooksApi(failing)))
        assertThrows(IOException::class.java) { runBlocking { lookup.search("anything") } }
        assertThrows(IOException::class.java) { runBlocking { lookup.byIsbn("9783257229530") } }
    }

    @Test fun aSlowCatalogueDoesNotBlockTheOthers() = runBlocking {
        val slow = object : BookSource {
            override val name = "slow"
            override suspend fun search(query: String, limit: Int, lang: String, partial: Boolean): List<RemoteBook> { delay(60_000); return emptyList() }
            override suspend fun byIsbn(isbn: String, lang: String): RemoteBook? { delay(60_000); return null }
        }
        val ol = OpenLibraryApi(fakeHttp("search.json" to "ol_search.json"))
        val results = BookLookup(listOf(slow, ol), timeoutMs = 200).search("der vorleser", 20, "de")
        assertEquals(2, results.size)
    }

    @Test fun searchResultsAreInterleavedAndDeduplicated() {
        val a = listOf(RemoteBook("Der Vorleser", authors = listOf("Bernhard Schlink"), isbn = "9783257229530"), RemoteBook("Homo faber", authors = listOf("Max Frisch")))
        val b = listOf(RemoteBook("DER VORLESER.", authors = listOf("Bernhard Schlink"), description = "Blurb"), RemoteBook("Stiller", authors = listOf("Max Frisch")))
        val merged = BookLookup.merge(listOf(a, b))
        assertEquals(listOf("Der Vorleser", "Homo faber", "Stiller"), merged.map { it.title })
        assertEquals("Blurb", merged[0].description)
        assertEquals("9783257229530", merged[0].isbn)
    }

    @Test fun typingAddsAPrefixWildcardToTheLastWord() {
        val api = OpenLibraryApi(failing)
        assertEquals("der vorl*", api.buildQuery("der vorl", partial = true))
        assertEquals("grimm märch*", api.buildQuery("Grimm märch", partial = true).lowercase())
        // A finished word (trailing space), a one letter stub, or a submitted search stay literal.
        assertEquals("der vorleser", api.buildQuery("der vorleser ", partial = true))
        assertEquals("der v", api.buildQuery("der v", partial = true))
        assertEquals("der vorl", api.buildQuery("der vorl", partial = false))
        // Search syntax characters cannot break the query.
        assertEquals("title foo bar*", api.buildQuery("title:(foo) \"bar", partial = true))
        assertEquals("", api.buildQuery(" :) ", partial = true))
    }

    @Test fun suggestModeSendsTheWildcard() = runBlocking {
        val seen = mutableListOf<String>()
        BookLookup(listOf(OpenLibraryApi(fakeHttp("search.json" to "ol_search.json", seen = seen)))).search("der vorl", 6, "de", partial = true)
        assertTrue(seen.single().contains("q=der+vorl*") || seen.single().contains("q=der+vorl%2A"))
    }

    @Test fun blankQueryDoesNotHitTheNetwork() = runBlocking {
        assertTrue(BookLookup(listOf(OpenLibraryApi(failing))).search("   ").isEmpty())
    }
}
