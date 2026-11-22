package ch.schmidtbit.shelfmark.data.remote

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume

/** Answers whether an address really serves a picture (and not a "no cover" page). */
fun interface ImageProbe {
    suspend fun isImage(url: String): Boolean
}

class OkHttpImageProbe(private val client: OkHttpClient) : ImageProbe {
    override suspend fun isImage(url: String): Boolean = suspendCancellableCoroutine { cont ->
        val call = client.newCall(Request.Builder().url(url).header("User-Agent", OkHttpFetcher.USER_AGENT).build())
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resume(false)
            }

            override fun onResponse(call: Call, response: Response) {
                val ok = response.use {
                    // Placeholders for "no cover" are tiny, a real cover is at least a few kilobytes.
                    it.isSuccessful && it.header("Content-Type").orEmpty().startsWith("image") &&
                        (it.header("Content-Length")?.toLongOrNull()?.let { size -> size > 1_500 } ?: true)
                }
                if (cont.isActive) cont.resume(ok)
            }
        })
    }
}

/**
 * Collects cover pictures for a book from every place that might have one:
 * what the catalogues returned, cover services that answer by ISBN, and a title search.
 */
class CoverFinder(private val lookup: BookLookup, private val probe: ImageProbe) {

    /** All covers found, best guesses first, without duplicates. */
    suspend fun candidates(title: String, authors: String, isbn: String, lang: String = "en"): List<String> = coroutineScope {
        val byIsbn = async {
            if (isbn.isBlank()) emptyList() else isbnAddresses(isbn).map { url -> async { url.takeIf { safely { probe.isImage(it) } == true } } }.awaitAll().filterNotNull()
        }
        val fromLookup = async {
            if (isbn.isBlank()) null else safely { withTimeoutOrNull(10_000) { lookup.byIsbn(isbn, lang) } }?.coverUrl
        }
        val fromSearch = async {
            val query = (title + " " + authors.substringBefore(',')).trim()
            if (title.isBlank()) emptyList() else {
                val wanted = RemoteBook.normalise(title)
                safely { withTimeoutOrNull(12_000) { lookup.search(query, 12, lang) } }.orEmpty()
                    // Only books that are plausibly the same one, a cover of a different book is worse than none.
                    .filter { it.coverUrl.isNotBlank() && RemoteBook.normalise(it.title).let { t -> t == wanted || t.startsWith(wanted) || wanted.startsWith(t) } }
                    .map { it.coverUrl }
            }
        }
        (byIsbn.await() + listOfNotNull(fromLookup.await()) + fromSearch.await()).filter { it.isNotBlank() }.distinct()
    }

    suspend fun best(title: String, authors: String, isbn: String, lang: String = "en"): String? =
        candidates(title, authors, isbn, lang).firstOrNull()

    private suspend fun <T> safely(block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    companion object {
        /** Cover services that answer directly by ISBN, and say "not found" honestly when they have none. */
        fun isbnAddresses(isbn: String): List<String> = listOf(
            "https://covers.openlibrary.org/b/isbn/$isbn-L.jpg?default=false",
            "https://portal.dnb.de/opac/mvb/cover?isbn=$isbn",
        )
    }
}
