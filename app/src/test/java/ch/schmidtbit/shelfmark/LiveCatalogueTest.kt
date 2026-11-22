package ch.schmidtbit.shelfmark

import ch.schmidtbit.shelfmark.data.remote.BookLookup
import ch.schmidtbit.shelfmark.data.remote.GoogleBooksApi
import ch.schmidtbit.shelfmark.data.remote.OkHttpFetcher
import ch.schmidtbit.shelfmark.data.remote.OpenLibraryApi
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/**
 * Talks to the real catalogues with the real HTTP stack.
 * Skipped unless SHELFMARK_LIVE=1 is set, so normal test runs stay offline.
 */
class LiveCatalogueTest {
    private val fetcher = OkHttpFetcher(OkHttpClient())
    private val lookup = BookLookup(listOf(OpenLibraryApi(fetcher), GoogleBooksApi(fetcher)))

    @Before fun onlyWhenAskedFor() = assumeTrue(System.getenv("SHELFMARK_LIVE") == "1")

    @Test fun isbnLookupFindsAGermanPaperback() = runBlocking {
        val book = lookup.byIsbn("9783257229530", "de")
        assertNotNull(book)
        println("LIVE isbn -> $book")
        assertEquals("Der Vorleser", book!!.title)
        assertTrue(book.authors.any { "Schlink" in it })
        assertTrue(book.pageCount > 100)
    }

    @Test fun titleAndAuthorSearchFindsBooks() = runBlocking {
        val results = lookup.search("dune frank herbert", 10, "en")
        println("LIVE search -> ${results.take(5).map { it.title + " / " + it.authorLine + " / " + it.isbn }}")
        assertTrue(results.any { it.title.contains("Dune", ignoreCase = true) })
    }

    @Test fun partialInputAlreadyGivesSuggestions() = runBlocking {
        val results = lookup.search("die unendliche gesch", 6, "de", partial = true)
        println("LIVE suggest -> ${results.map { it.title }}")
        assertTrue(results.any { it.title.contains("unendliche Geschichte", ignoreCase = true) })
    }

    @Test fun unknownIsbnIsNotFound() = runBlocking {
        // Valid check digit, but in a range no publisher uses.
        assertEquals(null, lookup.byIsbn("9786999999994", "en"))
    }

    private fun report(name: String, book: ch.schmidtbit.shelfmark.data.remote.RemoteBook?) =
        println("LIVE $name -> ${book?.title} / ${book?.authorLine} / ${book?.isbn} / ${book?.pageCount} p / ${book?.year} / cover=${book?.coverUrl?.take(60)}")

    @Test fun lobidKnowsTheGermanPaperback() = runBlocking {
        val api = ch.schmidtbit.shelfmark.data.remote.LobidApi(fetcher)
        val book = api.byIsbn("9783257229530", "de")
        report("lobid isbn", book)
        assertEquals("Der Vorleser", book!!.title)
        val found = api.search("die unendliche geschichte ende", 8, "de", false)
        println("LIVE lobid search -> ${found.map { it.title }}")
        assertTrue(found.isNotEmpty())
    }

    @Test fun k10plusKnowsTheGermanPaperback() = runBlocking {
        val api = ch.schmidtbit.shelfmark.data.remote.SruCatalogue.k10plus(fetcher)
        val book = api.byIsbn("9783257229530", "de")
        report("k10plus isbn", book)
        assertEquals("Der Vorleser", book!!.title)
        assertTrue(api.search("unendliche geschichte ende", 15, "de", false).any { it.title.contains("unendliche Geschichte", ignoreCase = true) })
    }

    @Test fun swisscoveryKnowsTheGermanPaperback() = runBlocking {
        val api = ch.schmidtbit.shelfmark.data.remote.SruCatalogue.swisscovery(fetcher)
        val book = api.byIsbn("9783257229530", "de")
        report("swisscovery isbn", book)
        assertEquals("Der Vorleser", book!!.title)
        assertTrue(api.search("unendliche geschichte ende", 15, "de", false).any { it.title.contains("unendliche Geschichte", ignoreCase = true) })
    }

    @Test fun appleBooksFindsTitlesWithCovers() = runBlocking {
        val found = ch.schmidtbit.shelfmark.data.remote.ITunesApi(fetcher) { "CH" }.search("der vorleser schlink", 5, "de", false)
        report("applebooks search", found.firstOrNull())
        assertTrue(found.first().coverUrl.startsWith("https://"))
    }

    @Test fun allCataloguesTogetherFindAnOldGermanEdition() = runBlocking {
        val everything = BookLookup(
            listOf(
                OpenLibraryApi(fetcher), GoogleBooksApi(fetcher), ch.schmidtbit.shelfmark.data.remote.ITunesApi(fetcher) { "CH" },
                ch.schmidtbit.shelfmark.data.remote.LobidApi(fetcher), ch.schmidtbit.shelfmark.data.remote.SruCatalogue.dnb(fetcher),
                ch.schmidtbit.shelfmark.data.remote.SruCatalogue.k10plus(fetcher), ch.schmidtbit.shelfmark.data.remote.SruCatalogue.swisscovery(fetcher),
            ),
        )
        // A Swiss classic, a recent German novel by ISBN, and a title search.
        listOf("9783423282734", "9783257069709", "9783462050974").forEach { isbn -> report("all isbn $isbn", everything.byIsbn(isbn, "de")) }
        val results = everything.search("homo faber frisch", 10, "de")
        println("LIVE all search -> ${results.take(5).map { it.title + " / " + it.authorLine + " / cover=" + it.coverUrl.isNotBlank() }}")
        assertTrue(results.first().title.contains("Homo faber", ignoreCase = true))
    }
}
