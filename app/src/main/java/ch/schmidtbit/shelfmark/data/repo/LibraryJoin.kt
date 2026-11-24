package ch.schmidtbit.shelfmark.data.repo

import ch.schmidtbit.shelfmark.data.importer.CsvImporter
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.share.BackupPayload
import ch.schmidtbit.shelfmark.util.Ids

/**
 * Puts two libraries together that were never the same one: the library of an account and
 * the library of a device that signs in to it with books of its own. There is nothing the
 * two started from, so [VaultMerge] has nothing to go by. What counts here is what a
 * reader would say when shown both:
 *
 *  - Two books are the same book by the rule of the import ([CsvImporter.sameBook]): an
 *    equal ISBN, or the same title and first author. They become one. The copy that was
 *    changed last is the one that stays, and what it leaves empty is filled from the other.
 *    One copy of the device goes with one copy of the account: whoever has a book twice on
 *    one side has it twice afterwards as well.
 *  - Everything that belongs to either copy is kept: reading sessions, quotes, notes,
 *    purchases, places on lists. Two entries that say exactly the same are kept once.
 *  - Books that only one side has stay as they are.
 *  - Lists with the same name, whatever the capitals, become one list.
 *  - Ornaments and goals of both are kept, identical ones once.
 *  - The settings are the account's.
 *
 * The numbers that books and lists go by are the account's wherever the account has the
 * book or the list: those are the numbers the website, the other devices and the loans
 * between friends know. Something of the device whose number is taken gets a new one.
 */
object LibraryJoin {
    fun join(account: BackupPayload, device: BackupPayload, newId: () -> Long = Ids::next): BackupPayload {
        // ---- books ----
        val books = account.books.toMutableList()
        val known = CsvImporter.Index(account.books)
        val paired = HashSet<Int>()
        val bookIds = account.books.mapTo(HashSet()) { it.id }
        /** The number a book of the device goes by in the result. */
        val bookOf = HashMap<Long, Long>()
        for (copy in device.books) {
            var at = known.find(copy)
            // That copy of the account already has its partner. Another one that is the same book may still be free.
            if (at in paired) at = account.books.indices.firstOrNull { it !in paired && CsvImporter.sameBook(account.books[it], copy) } ?: -1
            if (at < 0) {
                val id = free(copy.id, bookIds, newId)
                books += copy.copy(id = id)
                bookOf[copy.id] = id
            } else {
                val theirs = account.books[at]
                val (kept, other) = if (copy.updatedAt > theirs.updatedAt) copy to theirs else theirs to copy
                // A loan between friends points at the account's book, whichever copy was changed last.
                books[at] = fill(kept, other).copy(id = theirs.id, loanId = theirs.loanId.ifBlank { copy.loanId })
                paired += at
                bookOf[copy.id] = theirs.id
            }
        }

        // ---- lists ----
        val shelves = account.shelves.toMutableList()
        val shelfIds = account.shelves.mapTo(HashSet()) { it.id }
        val byName = HashMap<String, Long>()
        account.shelves.forEach { byName.getOrPut(nameOf(it.name)) { it.id } }
        var position = (account.shelves.maxOfOrNull { it.position } ?: -1) + 1
        val shelfOf = HashMap<Long, Long>()
        for (shelf in device.shelves.sortedBy { it.position }) {
            shelfOf[shelf.id] = byName.getOrPut(nameOf(shelf.name)) {
                // New to the account: it comes after the lists that are there, in the order it had.
                free(shelf.id, shelfIds, newId).also { id -> shelves += shelf.copy(id = id, position = position++) }
            }
        }
        val links = (account.links + device.links.mapNotNull { link -> BookShelf(bookOf[link.bookId] ?: return@mapNotNull null, shelfOf[link.shelfId] ?: return@mapNotNull null) }).distinct()

        // An ornament stands on a shelf, and a list of the reader's own is named by its number.
        fun keyOf(shelfKey: String): String? {
            if (!shelfKey.startsWith(LIST)) return shelfKey
            val list = shelfKey.removePrefix(LIST).toLongOrNull() ?: return null
            return shelfOf[list]?.let { LIST + it }
        }

        return BackupPayload(
            exportedAt = maxOf(account.exportedAt, device.exportedAt),
            books = books.sortedBy(Book::id),
            shelves = shelves.sortedBy { it.id },
            links = links.sortedWith(compareBy({ it.bookId }, { it.shelfId })),
            // "The same" for a quote or a note is what it says and where. When it was written down does not count.
            quotes = both(
                account.quotes, device.quotes.mapNotNull { quote -> bookOf[quote.bookId]?.let { quote.copy(bookId = it) } },
                { it.id }, { it.copy(id = 0, createdAt = 0, fromOcr = false) }, { quote, id -> quote.copy(id = id) }, newId,
            ).sortedBy { it.id },
            // A sitting is the same one when it began at the same moment and went as far.
            sessions = both(
                account.sessions, device.sessions.mapNotNull { session -> bookOf[session.bookId]?.let { session.copy(bookId = it) } },
                { it.id }, { it.copy(id = 0) }, { session, id -> session.copy(id = id) }, newId,
            ).sortedBy { it.id },
            notes = both(
                account.notes, device.notes.mapNotNull { note -> bookOf[note.bookId]?.let { note.copy(bookId = it) } },
                { it.id }, { it.copy(id = 0, createdAt = 0) }, { note, id -> note.copy(id = id) }, newId,
            ).sortedBy { it.id },
            goals = both(account.goals, device.goals, { it.id }, { it.copy(id = 0, createdAt = 0) }, { goal, id -> goal.copy(id = id) }, newId).sortedBy { it.id },
            purchases = both(
                account.purchases, device.purchases.mapNotNull { purchase -> bookOf[purchase.bookId]?.let { purchase.copy(bookId = it) } },
                { it.id }, { it.copy(id = 0) }, { purchase, id -> purchase.copy(id = id) }, newId,
            ).sortedBy { it.id },
            ornaments = both(
                account.ornaments, device.ornaments.mapNotNull { ornament -> keyOf(ornament.shelfKey)?.let { ornament.copy(shelfKey = it) } },
                { it.id }, { it.copy(id = 0) }, { ornament, id -> ornament.copy(id = id) }, newId,
            ).sortedBy { it.id },
            prefs = account.prefs ?: device.prefs,
        )
    }

    private const val LIST = "list_"

    private fun nameOf(list: String): String = list.trim().lowercase()

    /** [wanted] if nothing goes by that number yet, otherwise a new one. Either way it is taken from now on. */
    private fun free(wanted: Long, taken: MutableSet<Long>, newId: () -> Long): Long {
        var id = wanted
        while (!taken.add(id)) id = newId()
        return id
    }

    /**
     * What both sides have of one kind of thing. Everything of the account stays as it is.
     * Of the device comes what the account does not say already ([says] is an entry without
     * what does not count for that), under its own number if that is free.
     */
    private fun <T> both(account: List<T>, device: List<T>, id: (T) -> Long, says: (T) -> Any, numbered: (T, Long) -> T, newId: () -> Long): List<T> {
        val said = account.mapTo(HashSet()) { says(it) }
        val taken = account.mapTo(HashSet()) { id(it) }
        return account + device.filter { says(it) !in said }.map { numbered(it, free(id(it), taken, newId)) }
    }

    /**
     * The copy that stays, with what it leaves empty taken from [other]. The import fills
     * the same way ([CsvImporter.fillGaps]). On top of that come the fields a file from
     * another app never has. Which list a book is on, who has it and how far it was read
     * are no gaps: there the copy that was changed last simply says how it is.
     */
    private fun fill(kept: Book, other: Book): Book {
        // A cover is a picture and where it came from. It is taken over whole or not at all.
        val bare = kept.coverUrl.isBlank() && kept.coverPath.isBlank()
        return CsvImporter.fillGaps(kept, other).copy(
            subtitle = kept.subtitle.ifBlank { other.subtitle },
            authors = kept.authors.ifBlank { other.authors },
            language = kept.language.ifBlank { other.language },
            coverUrl = if (bare) other.coverUrl else kept.coverUrl,
            coverPath = if (bare) other.coverPath else kept.coverPath,
            spice = if (kept.spice > 0) kept.spice else other.spice,
            seriesPosition = if (kept.seriesPosition > 0f) kept.seriesPosition else other.seriesPosition,
        )
    }
}
