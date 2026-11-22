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
}
