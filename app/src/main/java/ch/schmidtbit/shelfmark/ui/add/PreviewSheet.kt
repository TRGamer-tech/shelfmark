@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.add

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.edit.StatusChips
import ch.schmidtbit.shelfmark.ui.labelRes

/** "2014 · 320 pages · Paperback", leaving out what is unknown. */
@Composable
fun RemoteBook.metaLine(): String = listOfNotNull(
    year.takeIf { it.isNotBlank() },
    pageCount.takeIf { it > 0 }?.let { stringResource(R.string.pages_short, it) },
    format.takeIf { it != BookFormat.UNKNOWN }?.let { stringResource(it.labelRes()) },
    language.takeIf { it.isNotBlank() }?.uppercase(),
    publisher.takeIf { it.isNotBlank() },
).joinToString(" · ")

/**
 * What the catalogue knows about a book, with the choice of list to put it on.
 * [existingId] is set when the book is already in the library.
 */
@Composable
fun PreviewSheet(
    book: RemoteBook,
    existingId: Long?,
    onDismiss: () -> Unit,
    onAdd: (ReadingStatus) -> Unit,
    onEditFirst: () -> Unit,
    onOpenExisting: (Long) -> Unit,
) {
    var status by rememberSaveable { mutableStateOf(ReadingStatus.NONE) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 20.dp)
                .testTag("previewSheet"),
        ) {
            Row {
                BookCover(book.title, book.authorLine, book.coverUrl.ifBlank { null }, Modifier.width(96.dp))
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(book.title, style = MaterialTheme.typography.titleLarge, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    if (book.subtitle.isNotBlank()) Text(book.subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (book.authors.isNotEmpty()) {
                        Text(book.authorLine, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp))
                    }
                    Text(book.metaLine(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                    if (book.isbn.isNotBlank()) Text("ISBN ${book.isbn}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (book.description.isNotBlank()) {
                Text(book.description, style = MaterialTheme.typography.bodyMedium, maxLines = 8, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 16.dp))
            }
            Spacer(Modifier.height(16.dp))
            if (existingId != null) {
                Text(stringResource(R.string.add_already_in_library), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(8.dp))
                Button(onClick = { onOpenExisting(existingId) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.add_open_existing)) }
            } else {
                Text(stringResource(R.string.edit_add_to), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                StatusChips(status) { status = it }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onEditFirst, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.add_edit_first), maxLines = 1) }
                    Button(onClick = { onAdd(status) }, modifier = Modifier.weight(1f).testTag("confirmAdd")) { Text(stringResource(R.string.add_confirm), maxLines = 1) }
                }
            }
        }
    }
}
