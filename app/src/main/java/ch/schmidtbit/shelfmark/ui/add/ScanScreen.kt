package ch.schmidtbit.shelfmark.ui.add

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.FlashOff
import androidx.compose.material.icons.rounded.FlashOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.schmidtbit.shelfmark.AppContainer
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.withDefaultsFor
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.ui.camera.CameraPreview
import ch.schmidtbit.shelfmark.ui.camera.IsbnAnalyzer
import ch.schmidtbit.shelfmark.ui.camera.WithCameraPermission
import ch.schmidtbit.shelfmark.ui.containerViewModel
import ch.schmidtbit.shelfmark.util.Dates
import ch.schmidtbit.shelfmark.util.Isbn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.Locale

sealed interface ScanState {
    data object Scanning : ScanState
    data class Looking(val isbn: String) : ScanState
    data class Found(val book: RemoteBook, val existingId: Long?) : ScanState
    data class NotFound(val isbn: String) : ScanState
    data class Failed(val isbn: String) : ScanState
}

class ScanViewModel(private val container: AppContainer) : ViewModel() {
    var state by mutableStateOf<ScanState>(ScanState.Scanning)
        private set

    /** Id and title of the book that was just added, for the confirmation bar. */
    var lastAdded by mutableStateOf<Pair<Long, String>?>(null)
        private set

    /** Called for every barcode the camera sees and for typed ISBNs. Ignored while a result is open. */
    fun onIsbn(raw: String) {
        if (state != ScanState.Scanning) return
        val isbn = Isbn.to13(raw) ?: return
        state = ScanState.Looking(isbn)
        viewModelScope.launch {
            val owned = container.library.findByIsbn(isbn)
            if (owned != null) {
                state = ScanState.Found(owned.toRemote(), owned.id)
                return@launch
            }
            state = try {
                val found = container.lookup.byIsbn(isbn, Locale.getDefault().language.ifBlank { "en" })
                if (found != null) ScanState.Found(found, null) else ScanState.NotFound(isbn)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ScanState.Failed(isbn)
            }
        }
    }

    fun retry(isbn: String) {
        state = ScanState.Scanning
        onIsbn(isbn)
    }

    fun resume() {
        state = ScanState.Scanning
    }

    fun add(book: RemoteBook, status: ReadingStatus) {
        container.launch {
            val id = container.library.addBook(book.toBook().withDefaultsFor(status, Dates.today()))
            container.findCoverLater(id)
            lastAdded = id to book.title
            state = ScanState.Scanning
        }
    }

    private fun Book.toRemote() = RemoteBook(
        title = title,
        subtitle = subtitle,
        authors = authors.split(',').map { it.trim() }.filter { it.isNotEmpty() },
        isbn = isbn,
        publisher = publisher,
        year = publishedYear,
        pageCount = pageCount,
        description = description,
        coverUrl = coverUrl,
        language = language,
        format = format,
    )
}

/** Point the camera at the barcode on the back of a book. Several books can be scanned in a row. */
@Composable
fun ScanScreen(onBack: () -> Unit, onOpenBook: (Long) -> Unit, onManual: (Book) -> Unit) {
    val viewModel = containerViewModel { ScanViewModel(it) }
    val haptics = LocalHapticFeedback.current
    var torch by rememberSaveable { mutableStateOf(false) }
    var typed by rememberSaveable { mutableStateOf("") }
    val analyzer = remember {
        IsbnAnalyzer { isbn ->
            if (viewModel.state == ScanState.Scanning) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            viewModel.onIsbn(isbn)
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        WithCameraPermission {
            CameraPreview(Modifier.fillMaxSize(), torch = torch, analyzer = analyzer)
            // Aiming frame, shaped like a barcode.
            Box(
                Modifier
                    .align(Alignment.Center)
                    .padding(bottom = 120.dp)
                    .size(width = 290.dp, height = 150.dp)
                    .border(3.dp, Color.White.copy(alpha = 0.9f), RoundedCornerShape(18.dp)),
            )
        }
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Rounded.Close, contentDescription = stringResource(R.string.action_close), tint = Color.White) }
            Text(
                stringResource(R.string.scan_hint),
                color = Color.White,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { torch = !torch }) {
                Icon(if (torch) Icons.Rounded.FlashOn else Icons.Rounded.FlashOff, contentDescription = stringResource(R.string.scan_torch), tint = Color.White)
            }
        }

        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().imePadding().padding(16.dp)) {
            viewModel.lastAdded?.let { (id, title) ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth().testTag("scanAdded")) {
                    Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.scan_added, title), Modifier.weight(1f), maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = { onOpenBook(id) }) { Text(stringResource(R.string.action_open)) }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                if (viewModel.state is ScanState.Looking) {
                    Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp)
                        Spacer(Modifier.width(16.dp))
                        Text(stringResource(R.string.scan_looking, (viewModel.state as ScanState.Looking).isbn))
                    }
                } else {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = typed,
                            onValueChange = { typed = it.take(17) },
                            label = { Text(stringResource(R.string.scan_type_isbn)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { viewModel.onIsbn(typed) }),
                            modifier = Modifier.weight(1f).testTag("isbnField"),
                        )
                        Button(onClick = { viewModel.onIsbn(typed) }, enabled = Isbn.isValid(typed), modifier = Modifier.testTag("isbnLookup")) {
                            Text(stringResource(R.string.scan_lookup))
                        }
                    }
                }
            }
        }
    }

    when (val state = viewModel.state) {
        is ScanState.Found -> PreviewSheet(
            book = state.book,
            existingId = state.existingId,
            onDismiss = viewModel::resume,
            onAdd = { status -> typed = ""; viewModel.add(state.book, status) },
            onEditFirst = { viewModel.resume(); onManual(state.book.toBook()) },
            onOpenExisting = { id -> viewModel.resume(); onOpenBook(id) },
        )
        is ScanState.NotFound -> AlertDialog(
            onDismissRequest = viewModel::resume,
            title = { Text(stringResource(R.string.scan_not_found_title)) },
            text = { Text(stringResource(R.string.scan_not_found_text, state.isbn)) },
            confirmButton = {
                TextButton(onClick = { viewModel.resume(); onManual(Book(title = "", isbn = state.isbn)) }) { Text(stringResource(R.string.search_manual)) }
            },
            dismissButton = { TextButton(onClick = viewModel::resume) { Text(stringResource(R.string.scan_continue)) } },
        )
        is ScanState.Failed -> AlertDialog(
            onDismissRequest = viewModel::resume,
            title = { Text(stringResource(R.string.scan_failed_title)) },
            text = { Text(stringResource(R.string.search_failed)) },
            confirmButton = { TextButton(onClick = { viewModel.retry(state.isbn) }) { Text(stringResource(R.string.action_retry)) } },
            dismissButton = {
                TextButton(onClick = { viewModel.resume(); onManual(Book(title = "", isbn = state.isbn)) }) { Text(stringResource(R.string.search_manual)) }
            },
        )
        else -> Unit
    }
}
