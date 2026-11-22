package ch.schmidtbit.shelfmark.data.remote

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException

/** One online catalogue. */
interface BookSource {
    val name: String

    /** False for catalogues that are too slow or too literal to be asked on every keystroke. */
    val suggests: Boolean get() = true
    /** [partial] is true while the user is still typing, so the last word may be incomplete. */
    suspend fun search(query: String, limit: Int, lang: String, partial: Boolean = false): List<RemoteBook>
    suspend fun byIsbn(isbn: String, lang: String): RemoteBook?
}

/**
 * Asks every catalogue at once and merges the answers, so a book missing from one
 * (or a catalogue that is down) does not leave the user empty handed.
 * Throws [IOException] only when every catalogue failed.
 *
 * Once the first catalogue has found something the others get [graceMs] more to add
 * their part. That keeps a scan quick even when one catalogue is having a slow day.
 */
class BookLookup(
    private val sources: List<BookSource>,
    private val timeoutMs: Long = 12_000,
    /** Extra time for the others after the first hit, when one book is looked up by ISBN. */
    private val graceMs: Long = 3_500,
) {
    suspend fun search(query: String, limit: Int = 20, lang: String = "en", partial: Boolean = false): List<RemoteBook> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return emptyList()
        val asked = if (partial) sources.filter { it.suggests } else sources
        // Suggestions have to feel instant. A search the user asked for may take its time to be complete.
        val grace = if (partial) graceMs / 2 else graceMs * 2
        val perSource = askAll(asked, grace, { it.isNullOrEmpty() }) { it.search(trimmed, limit, lang, partial) }.map { it.orEmpty() }
        return rank(trimmed, merge(perSource)).take(limit)
    }

    suspend fun byIsbn(isbn: String, lang: String = "en"): RemoteBook? {
        val found = askAll(sources, graceMs, { it == null }) { it.byIsbn(isbn, lang) }.filterNotNull()
        if (found.isEmpty()) return null
        // The first catalogue that knows the book sets the base, the others fill the gaps.
        val merged = found.drop(1).fold(found.first()) { acc, other -> acc.fillFrom(other) }
        return merged.copy(isbn = merged.isbn.ifBlank { isbn })
    }

    private suspend fun <T> askAll(asked: List<BookSource>, grace: Long, isEmpty: (T?) -> Boolean, block: suspend (BookSource) -> T): List<T?> = coroutineScope {
        val outcomes = java.util.concurrent.atomic.AtomicReferenceArray<Result<T>?>(asked.size)
        val finished = Channel<Int>(asked.size.coerceAtLeast(1))
        val jobs = asked.mapIndexed { index, source ->
            launch {
                val outcome = try {
                    Result.success(withTimeout(timeoutMs) { block(source) })
                } catch (e: CancellationException) {
                    // A timeout of one catalogue must not cancel the others.
                    if (e is kotlinx.coroutines.TimeoutCancellationException) Result.failure(IOException("timeout")) else throw e
                } catch (e: Exception) {
                    Result.failure(e)
                }
                outcomes.set(index, outcome)
                finished.send(index)
            }
        }
        var open = asked.size
        var deadline: Long? = null
        while (open > 0) {
            val wait = deadline?.let { it - System.nanoTime() / 1_000_000 }
            val index = if (wait == null) finished.receive() else withTimeoutOrNull(wait.coerceAtLeast(0)) { finished.receive() } ?: break
            open--
            val value = outcomes.get(index)?.getOrNull()
            if (deadline == null && outcomes.get(index)?.isSuccess == true && !isEmpty(value)) {
                deadline = System.nanoTime() / 1_000_000 + grace
            }
        }
        jobs.forEach { it.cancel() }
        val done = (0 until asked.size).map { outcomes.get(it) }
        if (done.isNotEmpty() && done.all { it == null || it.isFailure } && done.any { it != null }) {
            throw IOException("All catalogues failed", done.firstNotNullOfOrNull { it?.exceptionOrNull() })
        }
        done.map { it?.getOrNull() }
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

        /**
         * Puts the books that best fit what was typed first. Library catalogues like to
         * answer "der vorleser" with study guides about it, the novel itself should win.
         */
        fun rank(query: String, books: List<RemoteBook>): List<RemoteBook> {
            val words = searchWords(query).map { RemoteBook.normalise(it) }.filter { it.isNotEmpty() }
            if (words.isEmpty()) return books
            fun score(book: RemoteBook): Double {
                val title = RemoteBook.normalise(book.title)
                val people = RemoteBook.normalise(book.authorLine)
                val inTitle = words.count { it in title }
                val inPeople = words.count { it !in title && it in people }
                var points = (inTitle + inPeople).toDouble() / words.size * 10
                // Every query word accounted for by the title alone, and little else in the title.
                val titleWords = words.filter { it in title }.sumOf { it.length }
                if (title.isNotEmpty()) points += 4.0 * titleWords / title.length.coerceAtLeast(titleWords)
                if (book.coverUrl.isNotBlank()) points += 1.0
                if (book.isbn.isNotBlank()) points += 0.5
                if (book.authors.isNotEmpty()) points += 0.5
                return points
            }
            return books.withIndex().sortedWith(compareByDescending<IndexedValue<RemoteBook>> { score(it.value) }.thenBy { it.index }).map { it.value }
        }
    }
}
