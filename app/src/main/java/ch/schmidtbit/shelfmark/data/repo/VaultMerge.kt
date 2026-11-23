package ch.schmidtbit.shelfmark.data.repo

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.share.BackupPayload

/**
 * Brings together two versions of a library that both changed since they were last the
 * same: the one on this phone and the one on the server (changed on the website or on
 * another phone). [base] is what both started from.
 *
 * Each book, list, quote and so on is looked at by itself:
 *  - changed on one side only: that change counts,
 *  - new on one side: it is kept,
 *  - deleted on one side and untouched on the other: it is gone,
 *  - deleted on one side but changed on the other: it stays, a change is worth more than a deletion,
 *  - changed on both sides: for a book the later change wins, for everything else the server.
 */
object VaultMerge {
    fun merge(base: BackupPayload?, local: BackupPayload, remote: BackupPayload): BackupPayload {
        val books = three(base?.books, local.books, remote.books, { it.id }) { mine, theirs -> if (mine.updatedAt > theirs.updatedAt) mine else theirs }
        val shelves = three(base?.shelves, local.shelves, remote.shelves, { it.id })
        val bookIds = books.mapTo(HashSet()) { it.id }
        val shelfIds = shelves.mapTo(HashSet()) { it.id }
        return remote.copy(
            exportedAt = maxOf(local.exportedAt, remote.exportedAt),
            books = books.sortedBy(Book::id),
            shelves = shelves.sortedBy { it.id },
            // Whatever belonged to a book or a list that is gone goes with it.
            links = three(base?.links, local.links, remote.links, { it.bookId to it.shelfId })
                .filter { it.bookId in bookIds && it.shelfId in shelfIds }.sortedWith(compareBy({ it.bookId }, { it.shelfId })),
            quotes = three(base?.quotes, local.quotes, remote.quotes, { it.id }).filter { it.bookId in bookIds }.sortedBy { it.id },
            sessions = three(base?.sessions, local.sessions, remote.sessions, { it.id }).filter { it.bookId in bookIds }.sortedBy { it.id },
            notes = three(base?.notes, local.notes, remote.notes, { it.id }).filter { it.bookId in bookIds }.sortedBy { it.id },
            goals = three(base?.goals, local.goals, remote.goals, { it.id }).sortedBy { it.id },
            purchases = three(base?.purchases, local.purchases, remote.purchases, { it.id }).filter { it.bookId in bookIds }.sortedBy { it.id },
            ornaments = three(base?.ornaments, local.ornaments, remote.ornaments, { it.id })
                .filter { o -> !o.shelfKey.startsWith("list_") || o.shelfKey.removePrefix("list_").toLongOrNull() in shelfIds }.sortedBy { it.id },
            // An answer is a change, so an answered request beats the same request still waiting.
            requests = three(base?.requests, local.requests, remote.requests, { it.id }) { mine, theirs ->
                if ((mine.answeredAt ?: 0) > (theirs.answeredAt ?: 0)) mine else theirs
            }.sortedWith(compareBy({ it.createdAt }, { it.id })),
            prefs = when {
                remote.prefs == null -> local.prefs
                local.prefs == null || local.prefs == base?.prefs -> remote.prefs
                remote.prefs == base?.prefs -> local.prefs
                else -> remote.prefs
            },
        )
    }

    private fun <T : Any, K> three(base: List<T>?, local: List<T>, remote: List<T>, key: (T) -> K, both: (T, T) -> T = { _, theirs -> theirs }): List<T> {
        val was = base.orEmpty().associateBy(key)
        val mine = local.associateBy(key)
        val theirs = remote.associateBy(key)
        val out = ArrayList<T>()
        for (k in LinkedHashSet(theirs.keys + mine.keys)) {
            val b = was[k]
            val l = mine[k]
            val r = theirs[k]
            val kept: T? = when {
                l == null -> if (b == null || r != b) r else null
                r == null -> if (b == null || l != b) l else null
                l == r -> l
                b == null -> both(l, r)
                l == b -> r
                r == b -> l
                else -> both(l, r)
            }
            if (kept != null) out += kept
        }
        return out
    }
}
