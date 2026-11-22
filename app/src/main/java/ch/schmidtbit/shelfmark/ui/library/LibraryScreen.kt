@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.progress
import ch.schmidtbit.shelfmark.data.repo.SortOrder
import ch.schmidtbit.shelfmark.data.repo.ViewMode
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.CoverShelf
import ch.schmidtbit.shelfmark.ui.components.RatingBar
import ch.schmidtbit.shelfmark.ui.components.ShelfItem
import ch.schmidtbit.shelfmark.ui.components.SpineShelf
import ch.schmidtbit.shelfmark.ui.coverModelOf
import ch.schmidtbit.shelfmark.ui.labelRes
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors

@Composable
fun LibraryScreen(
    viewModel: LibraryViewModel,
    onOpenBook: (Long) -> Unit,
    onAdd: () -> Unit,
    onSettings: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var searching by rememberSaveable { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (searching) {
                        OutlinedTextField(
                            value = state.query,
                            onValueChange = viewModel::setQuery,
                            placeholder = { Text(stringResource(R.string.library_search_hint)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            modifier = Modifier.fillMaxWidth().testTag("librarySearch"),
                        )
                    } else {
                        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineSmall)
                    }
                },
                actions = {
                    IconButton(onClick = {
                        if (searching) viewModel.setQuery("")
                        searching = !searching
                    }) {
                        Icon(
                            if (searching) Icons.Rounded.Close else Icons.Rounded.Search,
                            contentDescription = stringResource(if (searching) R.string.action_close else R.string.library_search_hint),
                        )
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Rounded.Tune, contentDescription = stringResource(R.string.library_view_options))
                        }
                        ViewMenu(
                            expanded = menuOpen,
                            onDismiss = { menuOpen = false },
                            viewMode = state.settings.viewMode,
                            sort = state.settings.sort,
                            onViewMode = viewModel::setViewMode,
                            onSort = viewModel::setSort,
                        )
                    }
                    IconButton(onClick = onSettings, modifier = Modifier.testTag("openSettings")) {
                        Icon(Icons.Rounded.Settings, contentDescription = stringResource(R.string.settings_title))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onAdd,
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.add_book)) },
                modifier = Modifier.testTag("addBook"),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            FilterRow(state, viewModel::setFilter)
            when {
                state.loading -> Unit
                state.all.isEmpty() -> EmptyLibrary(onAdd)
                state.visible.isEmpty() -> NothingMatches()
                else -> Shelves(state, onOpenBook)
            }
        }
    }
}

@Composable
private fun ViewMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    viewMode: ViewMode,
    sort: SortOrder,
    onViewMode: (ViewMode) -> Unit,
    onSort: (SortOrder) -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        MenuHeading(stringResource(R.string.library_view))
        ViewMode.entries.forEach { mode ->
            val label = when (mode) {
                ViewMode.COVERS -> R.string.view_covers
                ViewMode.SPINES -> R.string.view_spines
                ViewMode.LIST -> R.string.view_list
            }
            CheckItem(stringResource(label), mode == viewMode) { onViewMode(mode); onDismiss() }
        }
        HorizontalDivider()
        MenuHeading(stringResource(R.string.library_sort))
        SortOrder.entries.forEach { order ->
            CheckItem(stringResource(order.labelRes()), order == sort) { onSort(order); onDismiss() }
        }
    }
}

@Composable
private fun MenuHeading(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun CheckItem(text: String, checked: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(text) },
        onClick = onClick,
        leadingIcon = {
            if (checked) Icon(Icons.Rounded.Check, contentDescription = null) else Spacer(Modifier.size(24.dp))
        },
    )
}

@Composable
private fun FilterRow(state: LibraryState, onFilter: (LibraryFilter) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Chip(stringResource(R.string.filter_all), state.all.size, state.filter == LibraryFilter.All) { onFilter(LibraryFilter.All) }
        listOf(ReadingStatus.READING, ReadingStatus.NONE, ReadingStatus.READ, ReadingStatus.WISHLIST, ReadingStatus.ABANDONED).forEach { status ->
            val filter = LibraryFilter.Status(status)
            Chip(stringResource(status.labelRes()), state.count(status), state.filter == filter) { onFilter(filter) }
        }
        if (state.lentOut > 0 || state.filter == LibraryFilter.LentOut) {
            Chip(stringResource(R.string.filter_lent_out), state.lentOut, state.filter == LibraryFilter.LentOut) { onFilter(LibraryFilter.LentOut) }
        }
        if (state.borrowed > 0 || state.filter == LibraryFilter.Borrowed) {
            Chip(stringResource(R.string.filter_borrowed), state.borrowed, state.filter == LibraryFilter.Borrowed) { onFilter(LibraryFilter.Borrowed) }
        }
        state.shelves.forEach { shelf ->
            val filter = LibraryFilter.OnShelf(shelf.id)
            Chip(shelf.name, state.count(shelf), state.filter == filter) { onFilter(filter) }
        }
    }
}

@Composable
private fun Chip(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text("$label  $count", maxLines = 1) },
    )
}

@Composable
private fun Shelves(state: LibraryState, onOpenBook: (Long) -> Unit) {
    val coverDir = LocalContainer.current.covers.dir
    val reading = MaterialTheme.colorScheme.secondary
    val lent = LocalShelfColors.current.spice
    val items = remember(state.visible, coverDir) {
        state.visible.map { book ->
            ShelfItem(
                key = book.id,
                title = book.title,
                authors = book.authors,
                cover = coverModelOf(coverDir, book),
                pageCount = book.pageCount,
                format = book.format,
                ribbon = when {
                    book.lentTo.isNotBlank() -> lent
                    book.status == ReadingStatus.READING -> reading
                    else -> null
                },
            )
        }
    }
    val bottomSpace = PaddingValues(top = 4.dp, bottom = 96.dp)
    val header: @Composable () -> Unit = {
        Text(
            pluralStringResource(R.plurals.book_count, state.visible.size, state.visible.size),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
    }
    when (state.settings.viewMode) {
        ViewMode.COVERS -> CoverShelf(items, { onOpenBook(it.key) }, contentPadding = bottomSpace, header = header)
        ViewMode.SPINES -> SpineShelf(items, { onOpenBook(it.key) }, contentPadding = bottomSpace, header = header)
        ViewMode.LIST -> LazyColumn(contentPadding = bottomSpace, modifier = Modifier.fillMaxSize().testTag("bookList")) {
            item(key = "header") { header() }
            items(state.visible, key = { it.id }) { book ->
                BookRow(book, coverModelOf(coverDir, book)) { onOpenBook(book.id) }
                HorizontalDivider(Modifier.padding(start = 84.dp), color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
fun BookRow(book: Book, cover: Any?, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BookCover(book.title, book.authors, cover, Modifier.width(52.dp), elevation = 2.dp)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(book.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (book.authors.isNotBlank()) {
                Text(book.authors, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(book.status.labelRes()), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                if (book.rating > 0f) {
                    Spacer(Modifier.width(10.dp))
                    RatingBar(book.rating, starSize = 14.dp)
                }
            }
            book.progress?.takeIf { book.status == ReadingStatus.READING }?.let {
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(progress = { it }, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun EmptyLibrary(onAdd: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.AutoMirrored.Rounded.MenuBook, contentDescription = null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(72.dp))
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.library_empty_title), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.library_empty_text),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = onAdd) { Text(stringResource(R.string.library_empty_action)) }
    }
}

@Composable
private fun NothingMatches() {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(
            stringResource(R.string.library_nothing_matches),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
