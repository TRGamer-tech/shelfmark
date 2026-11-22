package ch.schmidtbit.shelfmark.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.schmidtbit.shelfmark.AppContainer
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookShelf
import ch.schmidtbit.shelfmark.data.model.Ornament
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.repo.Settings
import ch.schmidtbit.shelfmark.data.repo.SortOrder
import ch.schmidtbit.shelfmark.data.repo.ViewMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class LibraryState(
    val loading: Boolean = true,
    val all: List<Book> = emptyList(),
    val visible: List<Book> = emptyList(),
    val shelves: List<Shelf> = emptyList(),
    val links: List<BookShelf> = emptyList(),
    val ornaments: List<Ornament> = emptyList(),
    val settings: Settings = Settings(),
    val filter: LibraryFilter = LibraryFilter.All,
    val query: String = "",
) {
    fun count(status: ReadingStatus): Int = all.count { it.status == status }
    fun count(shelf: Shelf): Int = links.count { it.shelfId == shelf.id }
    val lentOut: Int get() = all.count { it.lentTo.isNotBlank() }
    val borrowed: Int get() = all.count { it.ownership == Ownership.BORROWED }
}

private data class LibraryData(val books: List<Book>, val shelves: List<Shelf>, val links: List<BookShelf>, val ornaments: List<Ornament>)

/** Shared by the library tab and the lists tab, so picking a list there filters the shelf here. */
class LibraryViewModel(private val container: AppContainer) : ViewModel() {
    private val filter = MutableStateFlow<LibraryFilter>(LibraryFilter.All)
    private val query = MutableStateFlow("")

    private val data = combine(container.library.books, container.library.shelves, container.library.links, container.library.ornaments) { books, shelves, links, ornaments ->
        LibraryData(books, shelves, links, ornaments)
    }

    val state: StateFlow<LibraryState> = combine(data, container.settings.settings, filter, query) { (books, shelves, links, ornaments), settings, filter, query ->
        // A list that was deleted while selected falls back to everything.
        val safeFilter = if (filter is LibraryFilter.OnShelf && shelves.none { it.id == filter.shelfId }) LibraryFilter.All else filter
        LibraryState(
            loading = false,
            all = books,
            visible = LibraryLogic.apply(books, links, safeFilter, query, settings.sort),
            shelves = shelves,
            links = links,
            ornaments = ornaments,
            settings = settings,
            filter = safeFilter,
            query = query,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryState())

    fun setFilter(value: LibraryFilter) { filter.value = value }
    fun setQuery(value: String) { query.value = value }
    fun setViewMode(value: ViewMode) { viewModelScope.launch { container.settings.setViewMode(value) } }
    fun setSort(value: SortOrder) { viewModelScope.launch { container.settings.setSort(value) } }
}
