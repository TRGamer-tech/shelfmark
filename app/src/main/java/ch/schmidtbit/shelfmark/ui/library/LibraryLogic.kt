package ch.schmidtbit.shelfmark.ui.library

import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.repo.SortOrder

/** Which slice of the library is on screen. */
sealed interface LibraryFilter {
    data object All : LibraryFilter
    data class Status(val status: ReadingStatus) : LibraryFilter
    data class OnShelf(val shelfId: Long) : LibraryFilter
    /** My books that are currently with someone else. */
    data object LentOut : LibraryFilter
    /** Books I have on loan from someone. */
    data object Borrowed : LibraryFilter
}

object LibraryLogic {
    fun matches(book: Book, filter: LibraryFilter, shelfMembers: Set<Long>): Boolean = when (filter) {
        LibraryFilter.All -> true
        is LibraryFilter.Status -> book.status == filter.status
        is LibraryFilter.OnShelf -> book.id in shelfMembers
        LibraryFilter.LentOut -> book.lentTo.isNotBlank()
        LibraryFilter.Borrowed -> book.ownership == Ownership.BORROWED
    }

    fun matchesQuery(book: Book, query: String): Boolean {
        val q = query.trim()
        if (q.isEmpty()) return true
        return q.split(' ').filter { it.isNotBlank() }.all { word ->
            book.title.contains(word, ignoreCase = true) ||
                book.subtitle.contains(word, ignoreCase = true) ||
                book.authors.contains(word, ignoreCase = true) ||
                book.isbn.contains(word)
        }
    }

    fun sort(books: List<Book>, order: SortOrder): List<Book> = when (order) {
        SortOrder.ADDED -> books.sortedWith(compareByDescending<Book> { it.addedAt }.thenByDescending { it.id })
        SortOrder.TITLE -> books.sortedBy { sortKey(it.title) }
        SortOrder.AUTHOR -> books.sortedWith(compareBy<Book> { authorKey(it.authors) }.thenBy { sortKey(it.title) })
        SortOrder.RATING -> books.sortedWith(compareByDescending<Book> { it.rating }.thenBy { sortKey(it.title) })
    }

    fun apply(books: List<Book>, links: List<BookShelf>, filter: LibraryFilter, query: String, order: SortOrder): List<Book> {
        val members = if (filter is LibraryFilter.OnShelf) links.filter { it.shelfId == filter.shelfId }.map { it.bookId }.toSet() else emptySet()
        return sort(books.filter { matches(it, filter, members) && matchesQuery(it, query) }, order)
    }

    /** Leading articles are ignored when sorting, in English and German. */
    internal fun sortKey(title: String): String {
        val lower = title.trim().lowercase()
        val article = listOf("the ", "a ", "an ", "der ", "die ", "das ", "ein ", "eine ").firstOrNull { lower.startsWith(it) }
        return if (article != null) lower.removePrefix(article) else lower
    }

    /** Sorts by surname: "Frank Herbert" files under H. */
    internal fun authorKey(authors: String): String {
        val first = authors.substringBefore(',').trim()
        if (first.isEmpty()) return "￿"
        return (first.substringAfterLast(' ') + " " + first).lowercase()
    }
}
