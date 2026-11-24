@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.quotes

import android.content.ClipboardManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.camera.Ocr
import ch.schmidtbit.shelfmark.ui.camera.PhotoCapture
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.ConfirmDelete
import ch.schmidtbit.shelfmark.ui.components.DiscardDialog
import ch.schmidtbit.shelfmark.ui.detail.NumberField
import ch.schmidtbit.shelfmark.util.OcrText
import kotlinx.coroutines.launch

/**
 * Create or edit a quote. The text can be typed, pasted from the clipboard (handy for
 * e-books), or read from a photo of the page with on-device text recognition.
 */
@Composable
fun QuoteEditScreen(quoteId: Long, presetBookId: Long, onBack: () -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val books by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())

    var loaded by rememberSaveable { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var bookId by rememberSaveable { mutableStateOf(presetBookId) }
    var fromOcr by rememberSaveable { mutableStateOf(false) }
    var createdAt by rememberSaveable { mutableStateOf(0L) }
    // The quote as it was found here: what is stored, or nothing at all for a new one.
    var found by rememberSaveable { mutableStateOf(listOf("", "", "", presetBookId.toString())) }
    var askDiscard by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }

    var pickingBook by remember { mutableStateOf(false) }
    var takingPhoto by remember { mutableStateOf(false) }
    var recognising by remember { mutableStateOf(false) }
    var ocrFailed by remember { mutableStateOf(false) }
    var ocrLines by remember { mutableStateOf<List<String>?>(null) }

    LaunchedEffect(quoteId) {
        if (!loaded) {
            if (quoteId != 0L) {
                container.library.getQuote(quoteId)?.let { q ->
                    text = q.text
                    page = q.page.takeIf { it > 0 }?.toString().orEmpty()
                    note = q.note
                    bookId = q.bookId
                    fromOcr = q.fromOcr
                    createdAt = q.createdAt
                    found = listOf(text, page, note, bookId.toString())
                }
            } else {
                // Text another app shared with Shelfmark arrives here.
                container.pendingQuoteText?.let { text = it.trim() }
                container.pendingQuoteText = null
            }
            loaded = true
        }
    }

    fun runOcr(block: suspend () -> List<String>) {
        recognising = true
        ocrFailed = false
        scope.launch {
            val lines = runCatching { block() }.getOrNull()
            recognising = false
            if (lines.isNullOrEmpty()) ocrFailed = true else ocrLines = lines
        }
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) runOcr { Ocr.lines(context, uri) }
    }

    if (takingPhoto) {
        BackHandler { takingPhoto = false }
        PhotoCapture(
            hint = stringResource(R.string.quote_photo_hint),
            onCaptured = { bitmap ->
                takingPhoto = false
                runOcr { Ocr.lines(bitmap) }
            },
            onClose = { takingPhoto = false },
        )
        return
    }

    val selectedBook = books.firstOrNull { it.id == bookId }
    val canSave = text.isNotBlank() && selectedBook != null
    // Text that another app handed over counts as typed: it is nowhere else in Shelfmark yet.
    val changed = loaded && listOf(text, page, note, bookId.toString()) != found
    val leave = { if (changed) askDiscard = true else onBack() }
    BackHandler(enabled = changed) { askDiscard = true }
    if (askDiscard) DiscardDialog(onKeep = { askDiscard = false }) { askDiscard = false; onBack() }
    if (askDelete) {
        ConfirmDelete(stringResource(R.string.delete_quote_title), onDismiss = { askDelete = false }) {
            askDelete = false
            container.launch { container.library.deleteQuote(quoteId) }
            onBack()
        }
    }

    fun save() {
        val quote = Quote(
            id = quoteId,
            bookId = bookId,
            text = text.trim().trim('„', '“', '”', '"'),
            page = page.toIntOrNull() ?: 0,
            note = note.trim(),
            fromOcr = fromOcr,
            createdAt = if (createdAt > 0) createdAt else System.currentTimeMillis(),
        )
        container.launch { container.library.saveQuote(quote) }
        onBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (quoteId == 0L) R.string.quote_add else R.string.quote_edit)) },
                navigationIcon = { BackButton(leave) },
                actions = {
                    if (quoteId != 0L) {
                        IconButton(onClick = { askDelete = true }, modifier = Modifier.testTag("deleteQuote")) {
                            Icon(Icons.Rounded.Delete, contentDescription = stringResource(R.string.action_delete))
                        }
                    }
                    TextButton(onClick = ::save, enabled = canSave, modifier = Modifier.testTag("saveQuote")) { Text(stringResource(R.string.action_save)) }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedCard(onClick = { pickingBook = true }, modifier = Modifier.fillMaxWidth().testTag("pickBook")) {
                Column(Modifier.padding(16.dp)) {
                    Text(stringResource(R.string.quote_book), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        selectedBook?.title ?: stringResource(if (books.isEmpty()) R.string.quote_no_books else R.string.quote_choose_book),
                        style = MaterialTheme.typography.titleMedium,
                        color = if (selectedBook != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.primary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(
                    onClick = { takingPhoto = true },
                    label = { Text(stringResource(R.string.quote_from_camera)) },
                    leadingIcon = { Icon(Icons.Rounded.CameraAlt, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    modifier = Modifier.testTag("quoteCamera"),
                )
                AssistChip(
                    onClick = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    label = { Text(stringResource(R.string.quote_from_image)) },
                    leadingIcon = { Icon(Icons.Rounded.PhotoLibrary, contentDescription = null, modifier = Modifier.size(18.dp)) },
                )
                AssistChip(
                    onClick = {
                        val clipboard = context.getSystemService(ClipboardManager::class.java)
                        val pasted = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
                        if (pasted.isNotBlank()) text = if (text.isBlank()) pasted.trim() else text.trimEnd() + " " + pasted.trim()
                    },
                    label = { Text(stringResource(R.string.quote_paste)) },
                    leadingIcon = { Icon(Icons.Rounded.ContentPaste, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    modifier = Modifier.testTag("quotePaste"),
                )
            }
            if (recognising) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 3.dp)
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.quote_recognising))
                }
            }
            if (ocrFailed) Text(stringResource(R.string.quote_ocr_failed), color = MaterialTheme.colorScheme.error)
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text(stringResource(R.string.quote_text)) },
                minLines = 5,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().testTag("quoteText"),
            )
            NumberField(page, { page = it }, stringResource(R.string.field_page), Modifier.fillMaxWidth(), "quotePage")
            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                label = { Text(stringResource(R.string.quote_note)) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    if (pickingBook) {
        BookPicker(books, onDismiss = { pickingBook = false }) { picked ->
            bookId = picked.id
            pickingBook = false
        }
    }
    ocrLines?.let { lines ->
        LinePicker(lines, onDismiss = { ocrLines = null }) { chosen ->
            ocrLines = null
            if (chosen.isNotBlank()) {
                text = if (text.isBlank()) chosen else text.trimEnd() + " " + chosen
                fromOcr = true
            }
        }
    }
}

@Composable
private fun BookPicker(books: List<Book>, onDismiss: () -> Unit, onPick: (Book) -> Unit) {
    var query by remember { mutableStateOf("") }
    val visible = remember(books, query) {
        if (query.isBlank()) books else books.filter { it.title.contains(query.trim(), true) || it.authors.contains(query.trim(), true) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.quote_choose_book)) },
        text = {
            Column {
                if (books.size > 6) {
                    OutlinedTextField(query, { query = it }, placeholder = { Text(stringResource(R.string.library_search_hint)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                }
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(visible, key = { it.id }) { book ->
                        Column(Modifier.fillMaxWidth().clickable { onPick(book) }.padding(vertical = 10.dp).testTag("pick_book_${book.id}")) {
                            Text(book.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (book.authors.isNotBlank()) Text(book.authors, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Shows the recognised lines so the user can tick the ones that belong to the quote. */
@Composable
private fun LinePicker(lines: List<String>, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    val selected = remember(lines) { mutableStateListOf<Boolean>().apply { addAll(List(lines.size) { false }) } }
    val chosen = lines.filterIndexed { index, _ -> selected[index] }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.quote_pick_lines)) },
        text = {
            Column {
                Row {
                    TextButton(onClick = { selected.indices.forEach { selected[it] = true } }) { Text(stringResource(R.string.action_select_all)) }
                    TextButton(onClick = { selected.indices.forEach { selected[it] = false } }) { Text(stringResource(R.string.action_select_none)) }
                }
                LazyColumn(Modifier.heightIn(max = 380.dp).testTag("ocrLines")) {
                    itemsIndexed(lines) { index, line ->
                        Row(Modifier.fillMaxWidth().clickable { selected[index] = !selected[index] }, verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = selected[index], onCheckedChange = { selected[index] = it })
                            Text(line, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(OcrText.join(chosen)) }, enabled = chosen.isNotEmpty()) { Text(stringResource(R.string.quote_use_lines)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
