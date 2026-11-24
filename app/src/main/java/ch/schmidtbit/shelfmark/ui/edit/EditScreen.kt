@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.edit

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.ImageSearch
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.isAudio
import ch.schmidtbit.shelfmark.data.model.withDefaultsFor
import ch.schmidtbit.shelfmark.data.model.withFormOf
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.camera.PhotoCapture
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.DiscardDialog
import ch.schmidtbit.shelfmark.ui.coverModel
import ch.schmidtbit.shelfmark.ui.labelRes
import ch.schmidtbit.shelfmark.util.Dates
import ch.schmidtbit.shelfmark.util.Isbn
import ch.schmidtbit.shelfmark.util.Numbers
import kotlinx.serialization.json.Json

private val BookSaver = Saver<Book?, String>(
    save = { it?.let { book -> Json.encodeToString(Book.serializer(), book) } ?: "" },
    restore = { if (it.isEmpty()) null else Json.decodeFromString(Book.serializer(), it) },
)

/**
 * The form for typing in a book by hand or correcting one. With [bookId] 0 it creates a
 * new book, starting from whatever the scanner or the search left as a draft.
 */
@Composable
fun EditScreen(bookId: Long, onBack: () -> Unit, onSaved: (Long) -> Unit) {
    val container = LocalContainer.current
    var book by rememberSaveable(stateSaver = BookSaver) { mutableStateOf(null) }
    // The book as the form found it. What differs from it when the form is saved is what the reader did here.
    var opened by rememberSaveable(stateSaver = BookSaver) { mutableStateOf(null) }
    var status by rememberSaveable { mutableStateOf(ReadingStatus.NONE) }
    var seriesPosition by rememberSaveable { mutableStateOf("") }
    var openedPosition by rememberSaveable { mutableStateOf("") }
    var askDiscard by remember { mutableStateOf(false) }
    var takingPhoto by remember { mutableStateOf(false) }
    var searchingCover by remember { mutableStateOf(false) }
    val isNew = bookId == 0L

    LaunchedEffect(bookId) {
        if (book == null) {
            val loaded = if (isNew) container.draft ?: Book(title = "") else container.library.getBook(bookId)
            container.draft = null
            if (loaded == null) onBack() else {
                book = loaded
                opened = loaded
                status = loaded.status
                seriesPosition = loaded.seriesPosition.takeIf { it.isFinite() && it > 0f }?.let { if (it % 1f == 0f) it.toInt().toString() else it.toString() }.orEmpty()
                openedPosition = seriesPosition
            }
        }
    }
    val current = book ?: return
    val found = opened ?: current
    // Something was typed, picked or photographed here that is not saved yet.
    val changed = current != found || seriesPosition != openedPosition || (isNew && status != found.status)
    val leave = { if (changed) askDiscard = true else onBack() }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) container.launch {
            container.covers.saveFromUri(uri)?.let { name -> book = (book ?: current).copy(coverPath = name) }
        }
    }

    if (takingPhoto) {
        BackHandler { takingPhoto = false }
        PhotoCapture(
            hint = stringResource(R.string.edit_cover_photo_hint),
            onCaptured = { bitmap ->
                takingPhoto = false
                container.launch { book = (book ?: current).copy(coverPath = container.covers.saveBitmap(bitmap)) }
            },
            onClose = { takingPhoto = false },
        )
        return
    }

    fun save() {
        val cleanedIsbn = Isbn.to13(current.isbn) ?: Isbn.clean(current.isbn)
        val toSave = current.copy(
            title = current.title.trim(),
            authors = current.authors.trim(),
            isbn = cleanedIsbn,
            // A position the reader did not touch stays what it is, also one this field cannot write.
            seriesPosition = if (seriesPosition == openedPosition) found.seriesPosition else Numbers.seriesPosition(seriesPosition),
        )
        container.launch {
            val id = if (isNew) {
                container.library.addBook(toSave.withDefaultsFor(status, Dates.today())).also { container.findCoverLater(it) }
            } else {
                // Onto the book as it is stored now, not as it was when the form was opened: stars
                // given on the book page behind this form, or a change a sync brought, are not written over.
                container.library.modify(toSave.id) { stored -> stored.withFormOf(found, toSave) }
                toSave.id
            }
            onSaved(id)
        }
    }

    // Back with something typed asks first. With nothing typed it just goes back.
    BackHandler(enabled = changed) { askDiscard = true }
    if (askDiscard) DiscardDialog(onKeep = { askDiscard = false }) { askDiscard = false; onBack() }

    if (searchingCover) {
        CoverPickerDialog(current.title, current.authors, Isbn.to13(current.isbn).orEmpty(), onDismiss = { searchingCover = false }) { url ->
            searchingCover = false
            book = current.copy(coverUrl = url, coverPath = "")
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (isNew) R.string.edit_title_new else R.string.edit_title)) },
                navigationIcon = { BackButton(leave) },
                actions = {
                    TextButton(onClick = ::save, enabled = current.title.isNotBlank(), modifier = Modifier.testTag("saveBook")) {
                        Text(stringResource(R.string.action_save))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BookCover(current.title.ifBlank { stringResource(R.string.field_title) }, current.authors, current.coverModel(), Modifier.width(92.dp))
                Spacer(Modifier.width(16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedButton(onClick = { takingPhoto = true }) {
                        Icon(Icons.Rounded.CameraAlt, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.edit_cover_camera))
                    }
                    OutlinedButton(onClick = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                        Icon(Icons.Rounded.PhotoLibrary, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.edit_cover_gallery))
                    }
                    OutlinedButton(onClick = { searchingCover = true }, enabled = current.title.isNotBlank() || current.isbn.isNotBlank(), modifier = Modifier.testTag("searchCover")) {
                        Icon(Icons.Rounded.ImageSearch, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.cover_search))
                    }
                    if (current.coverPath.isNotBlank() || current.coverUrl.isNotBlank()) {
                        TextButton(onClick = { book = current.copy(coverPath = "", coverUrl = "") }) {
                            Icon(Icons.Rounded.Delete, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.edit_cover_remove))
                        }
                    }
                }
            }

            Field(current.title, { book = current.copy(title = it) }, R.string.field_title, tag = "fieldTitle", capitalize = true)
            Field(current.subtitle, { book = current.copy(subtitle = it) }, R.string.field_subtitle, capitalize = true)
            Field(current.authors, { book = current.copy(authors = it) }, R.string.field_authors, tag = "fieldAuthors", words = true, supporting = R.string.field_authors_hint)

            Text(stringResource(R.string.field_format), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(BookFormat.HARDCOVER, BookFormat.PAPERBACK, BookFormat.EBOOK, BookFormat.AUDIOBOOK, BookFormat.OTHER).forEach { format ->
                    FilterChip(
                        selected = current.format == format,
                        onClick = { book = current.copy(format = if (current.format == format) BookFormat.UNKNOWN else format) },
                        label = { Text(stringResource(format.labelRes())) },
                        modifier = Modifier.testTag("format_${format.name}"),
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Field(
                    value = current.pageCount.takeIf { it > 0 }?.toString().orEmpty(),
                    onChange = { book = current.copy(pageCount = it.filter(Char::isDigit).take(5).toIntOrNull() ?: 0) },
                    label = if (current.isAudio) R.string.field_minutes else R.string.field_pages,
                    modifier = Modifier.weight(1f),
                    number = true,
                    tag = "fieldPages",
                )
                Field(current.publishedYear, { book = current.copy(publishedYear = it.take(10)) }, R.string.field_year, Modifier.weight(1f), number = true)
            }
            Field(current.isbn, { book = current.copy(isbn = it.take(17)) }, R.string.field_isbn, number = true, tag = "fieldIsbn")
            Field(current.publisher, { book = current.copy(publisher = it) }, R.string.field_publisher, words = true)
            Field(current.language, { book = current.copy(language = it) }, R.string.field_language)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Field(current.series, { book = current.copy(series = it) }, R.string.field_series, Modifier.weight(2f), words = true)
                // Only what can become a plain number gets in: digits and one comma or point.
                Field(seriesPosition, { if (Numbers.typable(it) || it.length < seriesPosition.length) seriesPosition = it.take(7) }, R.string.field_series_position, Modifier.weight(1f), number = true, tag = "fieldSeriesPosition")
            }
            Field(current.genres, { book = current.copy(genres = it) }, R.string.field_genres, supporting = R.string.field_comma_hint, words = true)
            Field(current.tags, { book = current.copy(tags = it) }, R.string.field_tags, supporting = R.string.field_comma_hint)
            OutlinedTextField(
                value = current.description,
                onValueChange = { book = current.copy(description = it) },
                label = { Text(stringResource(R.string.field_description)) },
                minLines = 4,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().testTag("fieldDescription"),
            )

            if (isNew) {
                Text(stringResource(R.string.edit_add_to), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                StatusChips(status) { status = it }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** The five built-in lists as a row of chips. */
@Composable
fun StatusChips(selected: ReadingStatus, onSelect: (ReadingStatus) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(ReadingStatus.NONE, ReadingStatus.WISHLIST, ReadingStatus.READING, ReadingStatus.READ, ReadingStatus.ABANDONED).forEach { status ->
            FilterChip(
                selected = selected == status,
                onClick = { onSelect(status) },
                label = { Text(stringResource(status.labelRes())) },
                modifier = Modifier.testTag("pick_${status.name}"),
            )
        }
    }
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    label: Int,
    modifier: Modifier = Modifier,
    number: Boolean = false,
    capitalize: Boolean = false,
    words: Boolean = false,
    supporting: Int? = null,
    tag: String = "",
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(stringResource(label), maxLines = 1) },
        singleLine = true,
        supportingText = supporting?.let { { Text(stringResource(it)) } },
        keyboardOptions = KeyboardOptions(
            keyboardType = if (number) KeyboardType.Number else KeyboardType.Text,
            capitalization = when {
                words -> KeyboardCapitalization.Words
                capitalize -> KeyboardCapitalization.Sentences
                else -> KeyboardCapitalization.None
            },
        ),
        modifier = (if (tag.isEmpty()) modifier else modifier.testTag(tag)).fillMaxWidth(),
    )
}
