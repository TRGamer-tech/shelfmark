@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.add

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import ch.schmidtbit.shelfmark.AppContainer
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.cart.Cart
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.withDefaultsFor
import ch.schmidtbit.shelfmark.data.remote.RemoteBook
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.containerViewModel
import ch.schmidtbit.shelfmark.util.Dates
import ch.schmidtbit.shelfmark.util.Isbn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale

data class SearchUiState(
    val query: String = "",
    val results: List<RemoteBook> = emptyList(),
    val loading: Boolean = false,
    /** True while the list holds quick suggestions for a half-typed query. */
    val suggestions: Boolean = false,
    val failed: Boolean = false,
    /** True once a search has finished, so "nothing found" is only shown after really looking. */
    val searched: Boolean = false,
    val preview: RemoteBook? = null,
)

class SearchViewModel(private val container: AppContainer, initialQuery: String) : ViewModel() {
    var state by mutableStateOf(SearchUiState(query = initialQuery))
        private set
    private var job: Job? = null
    private var enrichJob: Job? = null
    private val lang: String get() = Locale.getDefault().language.ifBlank { "en" }

    init {
        if (initialQuery.isNotBlank()) submit()
    }

    /** Called on every keystroke: after a short pause the catalogues are asked for suggestions. */
    fun onQueryChange(text: String) {
        state = state.copy(query = text, failed = false)
        job?.cancel()
        if (text.trim().length < MIN_CHARS) {
            state = state.copy(results = emptyList(), loading = false, searched = false)
            return
        }
        job = viewModelScope.launch {
            delay(TYPING_PAUSE_MS)
            run(partial = true, limit = 8)
        }
    }

    /** The full search, when the user presses the search key. */
    fun submit() {
        job?.cancel()
        if (state.query.isBlank()) return
        job = viewModelScope.launch { run(partial = false, limit = 30) }
    }

    private suspend fun run(partial: Boolean, limit: Int) {
        val query = state.query.trim()
        state = state.copy(loading = true, failed = false)
        try {
            val isbn = Isbn.to13(query)
            val results = if (isbn != null) listOfNotNull(container.lookup.byIsbn(isbn, lang)) else container.lookup.search(query, limit, lang, partial)
            state = state.copy(results = results, loading = false, suggestions = partial && isbn == null, searched = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            state = state.copy(loading = false, failed = true, searched = true)
        }
    }

    /** Opens the preview and quietly fetches the blurb and binding the result list did not carry. */
    fun preview(book: RemoteBook?) {
        enrichJob?.cancel()
        state = state.copy(preview = book)
        if (book == null || book.isbn.isBlank() || book.description.isNotBlank()) return
        enrichJob = viewModelScope.launch {
            val detail = runCatching { withTimeoutOrNull(8_000) { container.lookup.byIsbn(book.isbn, lang) } }.getOrNull() ?: return@launch
            if (state.preview?.isbn == book.isbn) {
                // The title and authors the user picked stay, only the gaps are filled.
                state = state.copy(preview = state.preview?.fillFrom(detail.copy(coverUrl = "")))
            }
        }
    }

    fun libraryFlow() = container.library.books

    fun existing(book: RemoteBook, library: List<Book>): Long? = library.firstOrNull { owned ->
        (book.isbn.isNotBlank() && owned.isbn == book.isbn) ||
            (RemoteBook.normalise(owned.title) == RemoteBook.normalise(book.title) &&
                RemoteBook.normalise(owned.authors.substringBefore(',')) == RemoteBook.normalise(book.authors.firstOrNull().orEmpty()))
    }?.id

    fun add(book: RemoteBook, status: ReadingStatus, onAdded: (Long) -> Unit) {
        container.launch {
            val id = container.library.addBook(book.toBook().withDefaultsFor(status, Dates.today()))
            container.findCoverLater(id)
            onAdded(id)
        }
    }

    fun cart() = container.cart.cart

    /**
     * The button of a result and of the preview: onto the book cart, or off it again. A list
     * chosen in the preview is the book's own, for it and not for the others on the cart.
     */
    fun toggleCart(book: RemoteBook, status: ReadingStatus = ReadingStatus.NONE) {
        container.launch { container.cart.change { it.toggle(book.toBook(), status) } }
    }

    companion object {
        const val MIN_CHARS = 3
        const val TYPING_PAUSE_MS = 450L
    }
}

@Composable
fun SearchScreen(
    initialQuery: String,
    onBack: () -> Unit,
    onOpenBook: (Long) -> Unit,
    onManual: (Book) -> Unit,
    onScan: () -> Unit,
    onOpenCart: () -> Unit = {},
) {
    val viewModel = containerViewModel { SearchViewModel(it, initialQuery) }
    val state = viewModel.state
    val library by remember { viewModel.libraryFlow() }.collectAsStateWithLifecycle(initialValue = emptyList())
    val cart by remember { viewModel.cart() }.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { if (initialQuery.isBlank()) focus.requestFocus() }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.search_title)) }, navigationIcon = { BackButton(onBack) })
        },
        bottomBar = { CartBar(onOpenCart, Modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                placeholder = { Text(stringResource(R.string.search_hint)) },
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                trailingIcon = {
                    if (state.query.isNotEmpty()) {
                        IconButton(onClick = { viewModel.onQueryChange("") }) { Icon(Icons.Rounded.Close, contentDescription = stringResource(R.string.action_clear)) }
                    } else {
                        IconButton(onClick = onScan) { Icon(Icons.Rounded.QrCodeScanner, contentDescription = stringResource(R.string.add_scan)) }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { keyboard?.hide(); viewModel.submit() }),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(focus).testTag("searchField"),
            )
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).size(width = 0.dp, height = 4.dp)) {
                if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            // A new answer is read from its first book. Without this the list would keep the place of
            // whatever stood at its top before, the hint for instance, and the best hits would lie above the screen.
            // Only for an answer that is new, not for the same one after the phone was turned.
            val list = rememberLazyListState()
            var answered by rememberSaveable { mutableIntStateOf(state.results.hashCode()) }
            LaunchedEffect(state.results) {
                if (state.results.hashCode() != answered) {
                    answered = state.results.hashCode()
                    list.scrollToItem(0)
                }
            }
            LazyColumn(Modifier.weight(1f).testTag("searchResults"), state = list, contentPadding = PaddingValues(bottom = 24.dp)) {
                if (state.results.isNotEmpty()) {
                    item(key = "heading") {
                        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                stringResource(if (state.suggestions) R.string.search_suggestions else R.string.search_results),
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f),
                            )
                            if (state.suggestions) {
                                TextButton(onClick = { keyboard?.hide(); viewModel.submit() }) { Text(stringResource(R.string.search_show_all)) }
                            }
                        }
                    }
                }
                itemsIndexed(state.results, key = { index, book -> "$index-${book.title}-${book.isbn}" }) { _, book ->
                    val owned = library.any { it.isbn.isNotBlank() && it.isbn == book.isbn }
                    val onCart = cart.entryOf(book.toBook()) != null
                    ResultRow(book, owned, onCart, onToggleCart = { viewModel.toggleCart(book) }) { keyboard?.hide(); viewModel.preview(book) }
                    HorizontalDivider(Modifier.padding(start = 84.dp), color = MaterialTheme.colorScheme.outlineVariant)
                }
                item(key = "footer") {
                    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        when {
                            state.failed -> Text(stringResource(R.string.search_failed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge)
                            state.loading && state.results.isEmpty() -> CircularProgressIndicator()
                            state.searched && state.results.isEmpty() -> Text(stringResource(R.string.search_nothing), style = MaterialTheme.typography.bodyLarge)
                            state.results.isEmpty() -> Text(
                                stringResource(R.string.search_intro),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.size(16.dp))
                        // Old editions without a catalogue entry can always be typed in.
                        OutlinedButton(
                            onClick = { onManual(Book(title = state.query.trim().takeIf { Isbn.to13(it) == null }.orEmpty(), isbn = Isbn.to13(state.query).orEmpty())) },
                            modifier = Modifier.testTag("manualEntry"),
                        ) { Text(stringResource(R.string.search_manual)) }
                    }
                }
            }
        }
    }

    state.preview?.let { book ->
        var existingId by remember(book.title, book.isbn) { mutableStateOf<Long?>(null) }
        LaunchedEffect(book.title, book.isbn, library) { existingId = viewModel.existing(book, library) }
        PreviewSheet(
            book = book,
            existingId = existingId,
            onDismiss = { viewModel.preview(null) },
            onAdd = { status -> viewModel.add(book, status) { id -> viewModel.preview(null); onOpenBook(id) } },
            onEditFirst = { viewModel.preview(null); onManual(book.toBook()) },
            onOpenExisting = { id -> viewModel.preview(null); onOpenBook(id) },
            onCart = cart.entryOf(book.toBook()) != null,
            onToggleCart = { status -> viewModel.toggleCart(book, status); viewModel.preview(null) },
        )
    }
}

@Composable
private fun ResultRow(book: RemoteBook, owned: Boolean, onCart: Boolean, onToggleCart: () -> Unit, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Result lists load the medium sized cover, the large one is kept for the library.
        BookCover(book.title, book.authorLine, book.coverUrl.replace("-L.jpg", "-M.jpg").ifBlank { null }, Modifier.width(52.dp), elevation = 2.dp)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(book.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (book.authors.isNotEmpty()) {
                Text(book.authorLine, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val meta = book.metaLine()
            if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (owned) Text(stringResource(R.string.add_already_in_library), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            // Several books of one search, one tap each: a series is found once and put on the cart volume by volume.
            CartToggle(onCart, onToggleCart, Modifier.testTag("cartToggle_" + Cart.keyOf(book.toBook())))
        }
    }
}
