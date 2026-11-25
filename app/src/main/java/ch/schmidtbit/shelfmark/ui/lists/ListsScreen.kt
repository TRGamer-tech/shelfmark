@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.lists

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.CardGiftcard
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DoNotDisturbOn
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.SectionTitle
import ch.schmidtbit.shelfmark.ui.awayWords
import ch.schmidtbit.shelfmark.ui.coverModelOf
import ch.schmidtbit.shelfmark.ui.labelRes
import ch.schmidtbit.shelfmark.ui.library.LibraryFilter
import ch.schmidtbit.shelfmark.ui.library.LibraryViewModel

/** Overview of the built-in lists and the user's own lists. Tapping one opens it on the shelf. */
@Composable
fun ListsScreen(viewModel: LibraryViewModel, onOpenList: (LibraryFilter) -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val container = LocalContainer.current
    val coverDir = container.covers.dir
    var creating by rememberSaveable { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<Shelf?>(null) }
    var deleting by remember { mutableStateOf<Shelf?>(null) }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.tab_lists), style = MaterialTheme.typography.headlineSmall) }) },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("lists"), contentPadding = PaddingValues(bottom = 24.dp)) {
            item { SectionTitle(stringResource(R.string.lists_standard)) }
            val standard = listOf(
                ReadingStatus.READING to Icons.Rounded.AutoStories,
                ReadingStatus.NONE to Icons.AutoMirrored.Rounded.MenuBook,
                ReadingStatus.READ to Icons.Rounded.CheckCircle,
                ReadingStatus.WISHLIST to Icons.Rounded.CardGiftcard,
                ReadingStatus.ABANDONED to Icons.Rounded.DoNotDisturbOn,
            )
            items(standard, key = { it.first.name }) { (status, icon) ->
                ListCard(
                    name = stringResource(status.labelRes()),
                    icon = icon,
                    books = state.all.filter { it.status == status },
                    coverDir = coverDir,
                    onClick = { onOpenList(LibraryFilter.Status(status)) },
                    tag = "list_${status.name}",
                )
            }
            item {
                Row(Modifier.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    SectionTitle(stringResource(R.string.lists_custom), Modifier.weight(1f))
                    TextButton(onClick = { creating = true }, modifier = Modifier.testTag("newList")) {
                        Icon(Icons.Rounded.Add, contentDescription = null)
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.lists_new))
                    }
                }
            }
            if (state.shelves.isEmpty()) {
                item {
                    Text(
                        stringResource(R.string.lists_custom_empty),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }
            items(state.shelves, key = { "shelf${it.id}" }) { shelf ->
                val members = remember(state.links, shelf.id) { state.links.filter { it.shelfId == shelf.id }.map { it.bookId }.toSet() }
                ListCard(
                    name = shelf.name,
                    icon = Icons.Rounded.Bookmark,
                    books = state.all.filter { it.id in members },
                    coverDir = coverDir,
                    onClick = { onOpenList(LibraryFilter.OnShelf(shelf.id)) },
                    tag = "list_custom_${shelf.id}",
                    onRename = { renaming = shelf },
                    onDelete = { deleting = shelf },
                )
            }
        }
    }

    if (creating) {
        NameDialog(
            title = stringResource(R.string.lists_new),
            initial = "",
            onDismiss = { creating = false },
            onConfirm = { name ->
                creating = false
                container.launch { container.library.createShelf(name) }
            },
        )
    }
    renaming?.let { shelf ->
        NameDialog(
            title = stringResource(R.string.lists_rename),
            initial = shelf.name,
            onDismiss = { renaming = null },
            onConfirm = { name ->
                renaming = null
                container.launch { container.library.renameShelf(shelf, name) }
            },
        )
    }
    deleting?.let { shelf ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(stringResource(R.string.lists_delete_title, shelf.name)) },
            text = { Text(stringResource(R.string.lists_delete_text)) },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    container.launch { container.library.deleteShelf(shelf.id) }
                }) { Text(stringResource(R.string.action_delete)) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@Composable
private fun ListCard(
    name: String,
    icon: ImageVector,
    books: List<Book>,
    coverDir: java.io.File,
    onClick: () -> Unit,
    tag: String,
    onRename: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
) {
    var menu by remember { mutableStateOf(false) }
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag(tag),
    ) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleMedium)
                Text(
                    pluralStringResource(R.plurals.book_count, books.size, books.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // A peek at the first few books on the list.
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                books.take(4).forEach { book ->
                    BookCover(book.title, book.authors, coverModelOf(coverDir, book), Modifier.width(30.dp), cornerRadius = 2.dp, elevation = 1.dp, away = awayWords(LocalResources.current, book))
                }
            }
            if (onRename != null && onDelete != null) {
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Rounded.MoreVert, contentDescription = stringResource(R.string.action_more))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.lists_rename)) }, onClick = { menu = false; onRename() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.action_delete)) }, onClick = { menu = false; onDelete() })
                    }
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
        }
    }
}

@Composable
fun NameDialog(title: String, initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var name by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(40) },
                label = { Text(stringResource(R.string.lists_name)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("nameField"),
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(name.trim()) }, enabled = name.isNotBlank()) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
