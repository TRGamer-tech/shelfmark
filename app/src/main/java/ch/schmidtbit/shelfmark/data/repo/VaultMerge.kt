package ch.schmidtbit.shelfmark.data.repo

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.data.share.VaultPrefs

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
 *
 * What belongs to a book (its quotes, notes, sessions, purchases and places on lists) goes
 * where the book goes. A side that deleted the book lost them along with it, without
 * anybody deciding about them one by one: when the book stays after all, because the other
 * side changed it, they stay as that other side has them. Gone is only what was deleted
 * where the book still stood.
 */
object VaultMerge {
    fun merge(base: BackupPayload?, local: BackupPayload, remote: BackupPayload): BackupPayload {
        val books = three(base?.books, local.books, remote.books, { it.id }) { mine, theirs -> if (mine.updatedAt > theirs.updatedAt) mine else theirs }
        val shelves = three(base?.shelves, local.shelves, remote.shelves, { it.id })
        val bookIds = books.mapTo(HashSet()) { it.id }
        val shelfIds = shelves.mapTo(HashSet()) { it.id }
        val booksHere = local.books.mapTo(HashSet()) { it.id }
        val booksThere = remote.books.mapTo(HashSet()) { it.id }
        val shelvesHere = local.shelves.mapTo(HashSet()) { it.id }
        val shelvesThere = remote.shelves.mapTo(HashSet()) { it.id }
        fun listOf(key: String): Long? = key.takeIf { it.startsWith("list_") }?.removePrefix("list_")?.toLongOrNull()
        return remote.copy(
            exportedAt = maxOf(local.exportedAt, remote.exportedAt),
            books = books.sortedBy(Book::id),
            shelves = shelves.sortedBy { it.id },
            // Whatever belonged to a book or a list that is gone goes with it.
            links = owned(base?.links, local.links, remote.links, { it.bookId to it.shelfId },
                { it.bookId in booksHere && it.shelfId in shelvesHere }, { it.bookId in booksThere && it.shelfId in shelvesThere })
                .filter { it.bookId in bookIds && it.shelfId in shelfIds }.sortedWith(compareBy({ it.bookId }, { it.shelfId })),
            quotes = owned(base?.quotes, local.quotes, remote.quotes, { it.id }, { it.bookId in booksHere }, { it.bookId in booksThere })
                .filter { it.bookId in bookIds }.sortedBy { it.id },
            sessions = owned(base?.sessions, local.sessions, remote.sessions, { it.id }, { it.bookId in booksHere }, { it.bookId in booksThere })
                .filter { it.bookId in bookIds }.sortedBy { it.id },
            notes = owned(base?.notes, local.notes, remote.notes, { it.id }, { it.bookId in booksHere }, { it.bookId in booksThere })
                .filter { it.bookId in bookIds }.sortedBy { it.id },
            goals = three(base?.goals, local.goals, remote.goals, { it.id }).sortedBy { it.id },
            purchases = owned(base?.purchases, local.purchases, remote.purchases, { it.id }, { it.bookId in booksHere }, { it.bookId in booksThere })
                .filter { it.bookId in bookIds }.sortedBy { it.id },
            // What decorates a list of the reader's own belongs to that list in the same way.
            ornaments = owned(base?.ornaments, local.ornaments, remote.ornaments, { it.id },
                { o -> listOf(o.shelfKey)?.let { it in shelvesHere } ?: true }, { o -> listOf(o.shelfKey)?.let { it in shelvesThere } ?: true })
                .filter { o -> !o.shelfKey.startsWith("list_") || listOf(o.shelfKey) in shelfIds }.sortedBy { it.id },
            prefs = prefs(base?.prefs, local.prefs, remote.prefs),
        )
    }

    /** Each setting by itself: one that only this device changed stays, every other one is the server's. */
    private fun prefs(base: VaultPrefs?, local: VaultPrefs?, remote: VaultPrefs?): VaultPrefs? {
        if (remote == null) return local
        if (local == null || base == null) return remote
        fun <T> pick(of: (VaultPrefs) -> T): T = if (of(remote) == of(base)) of(local) else of(remote)
        return VaultPrefs(
            profileName = pick { it.profileName },
            shareStatus = pick { it.shareStatus },
            shareRatings = pick { it.shareRatings },
            minutesPerPage = pick { it.minutesPerPage },
            theme = pick { it.theme },
            customThemes = pick { it.customThemes },
            viewMode = pick { it.viewMode },
            sort = pick { it.sort },
            motion = pick { it.motion },
        )
    }

    /**
     * [three] for what belongs to something else. [here] and [there] say whether the owner
     * of an entry still exists on this device and on the server. A side without the owner
     * has no say about the entry: it counts as not having touched it.
     */
    private fun <T : Any, K> owned(base: List<T>?, local: List<T>, remote: List<T>, key: (T) -> K, here: (T) -> Boolean, there: (T) -> Boolean): List<T> {
        val was = base.orEmpty()
        return three(base, local + was.filterNot(here), remote + was.filterNot(there), key)
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
