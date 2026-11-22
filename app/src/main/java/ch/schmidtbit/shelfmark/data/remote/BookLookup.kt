package ch.schmidtbit.shelfmark.data.remote

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeout
import java.io.IOException

/** One online catalogue. */
interface BookSource {
    val name: String
    /** [partial] is true while the user is still typing, so the last word may be incomplete. */
    suspend fun search(query: String, limit: Int, lang: String, partial: Boolean = false): List<RemoteBook>
    suspend fun byIsbn(isbn: String, lang: String): RemoteBook?
}

/**
 * Asks every catalogue at once and merges the answers, so a book missing from one
 * (or a catalogue that is down) does not leave the user empty handed.
 * Throws [IOException] only when every catalogue failed.
 */
class BookLookup(private val sources: List<BookSource>, private val timeoutMs: Long = 12_000) {

    suspend fun search(query: String, limit: Int = 20, lang: String = "en", partial: Boolean = false): List<RemoteBook> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return emptyList()
        val perSource = askAll { it.search(trimmed, limit, lang, partial) }.map { it.orEmpty() }
        return merge(perSource).take(limit)
    }

    suspend fun byIsbn(isbn: String, lang: String = "en"): RemoteBook? {
        val found = askAll { it.byIsbn(isbn, lang) }.filterNotNull()
        if (found.isEmpty()) return null
        // The first catalogue that knows the book sets the base, the others fill the gaps.
        // Open Library covers are larger, so they win when available.
        val merged = found.drop(1).fold(found.first()) { acc, other -> acc.fillFrom(other) }
        val bestCover = found.firstOrNull { it.source == "openlibrary" && it.coverUrl.isNotBlank() }?.coverUrl
        return merged.copy(coverUrl = bestCover ?: merged.coverUrl, isbn = merged.isbn.ifBlank { isbn })
    }

    private suspend fun <T> askAll(block: suspend (BookSource) -> T): List<T?> = coroutineScope {
        val outcomes = sources.map { source ->
            async {
                try {
                    Result.success(withTimeout(timeoutMs) { block(source) })
                } catch (e: CancellationException) {
                    // A timeout of one catalogue must not cancel the others.
                    if (e is kotlinx.coroutines.TimeoutCancellationException) Result.failure(IOException("timeout")) else throw e
                } catch (e: Exception) {
                    Result.failure(e)
                }
            }
        }.awaitAll()
        if (outcomes.isNotEmpty() && outcomes.all { it.isFailure }) {
            throw IOException("All catalogues failed", outcomes.first().exceptionOrNull())
        }
        outcomes.map { it.getOrNull() }
    }

    companion object {
        /**
         * Round-robin over the catalogues. Records with the same title and first author
         * are treated as the same book and merged, so the list shows each book once.
         */
        fun merge(perSource: List<List<RemoteBook>>): List<RemoteBook> {
            val merged = LinkedHashMap<String, RemoteBook>()
            val longest = perSource.maxOfOrNull { it.size } ?: 0
            for (i in 0 until longest) {
                for (list in perSource) {
                    val book = list.getOrNull(i) ?: continue
                    val key = RemoteBook.normalise(book.title) + "|" + RemoteBook.normalise(book.authors.firstOrNull().orEmpty())
                    merged[key] = merged[key]?.fillFrom(book) ?: book
                }
            }
            return merged.values.toList()
        }
    }
}
