@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.detail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigationevent.NavigationEventTransitionState
import androidx.navigationevent.compose.LocalNavigationEventDispatcherOwner
import ch.schmidtbit.shelfmark.ui.components.AnimatedProgress
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.BookFormat
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.Note
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.Purchase
import ch.schmidtbit.shelfmark.data.model.Quote
import ch.schmidtbit.shelfmark.data.model.ReadingMath
import ch.schmidtbit.shelfmark.data.model.ReadingSession
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.Shelf
import ch.schmidtbit.shelfmark.data.model.isAudio
import ch.schmidtbit.shelfmark.data.model.progress
import ch.schmidtbit.shelfmark.data.model.withStatus
import ch.schmidtbit.shelfmark.data.model.withStatusOf
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.awayWords
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.ConfirmDelete
import ch.schmidtbit.shelfmark.ui.components.DayPickerDialog
import ch.schmidtbit.shelfmark.ui.components.RatingBar
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.components.SpiceBar
import ch.schmidtbit.shelfmark.ui.components.formatDuration
import ch.schmidtbit.shelfmark.ui.coverModel
import ch.schmidtbit.shelfmark.ui.formatRating
import ch.schmidtbit.shelfmark.ui.friends.LoanButtons
import ch.schmidtbit.shelfmark.ui.friends.LoanStatus
import ch.schmidtbit.shelfmark.ui.labelRes
import ch.schmidtbit.shelfmark.ui.lists.NameDialog
import ch.schmidtbit.shelfmark.ui.theme.QuoteStyle
import ch.schmidtbit.shelfmark.util.Dates
import ch.schmidtbit.shelfmark.util.finite
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun BookScreen(
    bookId: Long,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onAddQuote: () -> Unit,
    onEditQuote: (Long) -> Unit,
    onTimer: () -> Unit,
) {
    val container = LocalContainer.current
    val library = container.library
    val bookState by remember(bookId) { library.book(bookId) }.collectAsStateWithLifecycle(initialValue = null)
    val shelves by library.shelves.collectAsStateWithLifecycle(initialValue = emptyList())
    val shelfIds by remember(bookId) { library.shelfIdsOf(bookId) }.collectAsStateWithLifecycle(initialValue = emptyList())
    val quotes by remember(bookId) { library.quotesOf(bookId) }.collectAsStateWithLifecycle(initialValue = emptyList())
    val sessions by remember(bookId) { library.sessionsOf(bookId) }.collectAsStateWithLifecycle(initialValue = emptyList())
    val notes by remember(bookId) { library.notesOf(bookId) }.collectAsStateWithLifecycle(initialValue = emptyList())
    val purchases by remember(bookId) { library.purchasesOf(bookId) }.collectAsStateWithLifecycle(initialValue = emptyList())
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
    val loans by container.social.loans.collectAsStateWithLifecycle(initialValue = emptyList())

    val book = bookState
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var logging by remember { mutableStateOf(false) }

    // Edits are applied to the stored book, not to the copy on screen, which may lag a moment behind.
    fun change(edit: (Book) -> Book) { container.launch { library.modify(bookId, edit) } }

    // One tap on a list restarts a read or counts another one. For a few seconds it can be taken back.
    val snackbar = remember { SnackbarHostState() }
    val screen = rememberCoroutineScope()
    val context = LocalContext.current
    fun move(status: ReadingStatus) {
        container.launch {
            val before = library.getBook(bookId)?.takeIf { it.status != status } ?: return@launch
            library.modify(bookId) { it.withStatus(status, Dates.today()) }
            screen.launch {
                // A second move while the first can still be taken back: the offer is for the latest one.
                snackbar.currentSnackbarData?.dismiss()
                val answer = snackbar.showSnackbar(
                    message = context.getString(R.string.book_status_changed, context.getString(status.labelRes())),
                    actionLabel = context.getString(R.string.action_undo),
                    // Long enough to see what happened, short enough not to lie over the page for long.
                    duration = SnackbarDuration.Short,
                )
                if (answer == SnackbarResult.ActionPerformed) container.launch { library.modify(bookId) { it.withStatusOf(before) } }
            }
        }
    }

    // The offer belongs to this page. When a swipe from the edge starts to take the page away,
    // it is put away: it must not stay behind where the page was.
    val backEvents = LocalNavigationEventDispatcherOwner.current?.navigationEventDispatcher
    LaunchedEffect(backEvents) {
        backEvents?.transitionState?.collect { if (it is NavigationEventTransitionState.InProgress) snackbar.currentSnackbarData?.dismiss() }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar, Modifier.testTag("bookSnackbar")) },
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = { BackButton(onBack) },
                actions = {
                    if (book != null) {
                        IconButton(onClick = { change { it.copy(favorite = !it.favorite) } }) {
                            Icon(
                                if (book.favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                                contentDescription = stringResource(R.string.book_favorite),
                                tint = if (book.favorite) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurface,
                            )
                        }
                        IconButton(onClick = onEdit, modifier = Modifier.testTag("editBook")) {
                            Icon(Icons.Rounded.Edit, contentDescription = stringResource(R.string.action_edit))
                        }
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(Icons.Rounded.MoreVert, contentDescription = stringResource(R.string.action_more))
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.book_delete)) },
                                    onClick = { menu = false; confirmDelete = true },
                                    leadingIcon = { Icon(Icons.Rounded.Delete, contentDescription = null) },
                                )
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (book == null) return@Scaffold
        Column(Modifier.fillMaxSize().padding(padding)) {
            Header(book)
            PrimaryTabRow(selectedTabIndex = tab) {
                listOf(
                    stringResource(R.string.book_tab_overview),
                    stringResource(R.string.book_tab_reading),
                    stringResource(R.string.book_tab_quotes) + countSuffix(quotes.size),
                    stringResource(R.string.book_tab_notes) + countSuffix(notes.size),
                ).forEachIndexed { index, title ->
                    Tab(selected = tab == index, onClick = { tab = index }, text = { Text(title, maxLines = 1) })
                }
            }
            when (tab) {
                0 -> OverviewTab(
                    book = book,
                    shelves = shelves,
                    shelfIds = shelfIds,
                    sessions = sessions,
                    purchases = purchases,
                    minutesPerPage = settings?.minutesPerPage ?: 1.5f,
                    loans = loans,
                    onChange = ::change,
                    onMove = ::move,
                    onLogSession = { logging = true },
                )
                1 -> ReadingTab(book, sessions, settings?.minutesPerPage ?: 1.5f, onLog = { logging = true }, onTimer = onTimer)
                2 -> QuotesTab(quotes, onAddQuote, onEditQuote)
                else -> NotesTab(book.id, notes)
            }
        }
    }

    if (logging && book != null) {
        LogSessionDialog(
            book = book,
            presetMinutes = null,
            onDismiss = { logging = false },
            onSave = { session ->
                logging = false
                container.launch { library.logSession(session) }
            },
        )
    }
    if (confirmDelete && book != null) {
        // A book that a loan is still about stays: the borrower's copy would be back with the
        // next look at the server, and the lender's book is what the loan points at.
        val onLoan = loans.any { !it.over && if (it.lender) it.bookId == book.id else book.loanId.isNotBlank() && it.id == book.loanId }
        if (onLoan) {
            AlertDialog(
                onDismissRequest = { confirmDelete = false },
                title = { Text(stringResource(R.string.book_delete)) },
                text = { Text(stringResource(R.string.book_delete_loan)) },
                confirmButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.action_ok)) } },
                modifier = Modifier.testTag("deleteRefused"),
            )
        } else {
            AlertDialog(
                onDismissRequest = { confirmDelete = false },
                title = { Text(stringResource(R.string.book_delete_title)) },
                text = { Text(stringResource(R.string.book_delete_text, book.title)) },
                confirmButton = {
                    TextButton(onClick = {
                        confirmDelete = false
                        container.launch { library.deleteBook(book.id) }
                        onBack()
                    }) { Text(stringResource(R.string.action_delete)) }
                },
                dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.action_cancel)) } },
            )
        }
    }
}

private fun countSuffix(count: Int) = if (count > 0) " ($count)" else ""

@Composable
private fun Header(book: Book) {
    // On its own page a book that is away looks as it does on the shelf, and says why in words,
    // which is also what a screen reader hears.
    val away = awayWords(LocalResources.current, book)
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalAlignment = Alignment.Bottom) {
        BookCover(book.title, book.authors, book.coverModel(), Modifier.width(104.dp).testTag("bookCover"), elevation = 6.dp, away = away != null)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(book.title, style = MaterialTheme.typography.headlineSmall, maxLines = 4, overflow = TextOverflow.Ellipsis)
            if (book.subtitle.isNotBlank()) {
                Text(book.subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (book.authors.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(book.authors, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (book.series.isNotBlank()) {
                val position = if (book.seriesPosition.finite() > 0f) " #" + formatRating(book.seriesPosition) else ""
                Text(book.series + position, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (away != null) {
                Spacer(Modifier.height(4.dp))
                Text(away, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("bookAway"))
            }
        }
    }
}

@Composable
private fun OverviewTab(
    book: Book,
    shelves: List<Shelf>,
    shelfIds: List<Long>,
    sessions: List<ReadingSession>,
    purchases: List<Purchase>,
    minutesPerPage: Float,
    loans: List<Loan>,
    onChange: ((Book) -> Book) -> Unit,
    onMove: (ReadingStatus) -> Unit,
    onLogSession: () -> Unit,
) {
    val container = LocalContainer.current
    var pickStart by remember { mutableStateOf(false) }
    var pickEnd by remember { mutableStateOf(false) }
    var lendTo by remember { mutableStateOf(false) }
    var newList by remember { mutableStateOf(false) }

    LazyColumn(Modifier.fillMaxSize().testTag("bookOverview"), contentPadding = PaddingValues(top = 6.dp, bottom = 32.dp)) {
        item(key = "status") {
            SectionCard(stringResource(R.string.book_section_list)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(ReadingStatus.WISHLIST, ReadingStatus.NONE, ReadingStatus.READING, ReadingStatus.READ, ReadingStatus.ABANDONED).forEach { status ->
                        FilterChip(
                            selected = book.status == status,
                            onClick = { onMove(status) },
                            label = { Text(stringResource(status.labelRes())) },
                            modifier = Modifier.testTag("status_${status.name}"),
                        )
                    }
                }
                if (book.readCount > 1) {
                    Text(
                        pluralStringResource(R.plurals.times_read, book.readCount, book.readCount),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
        if (book.status == ReadingStatus.READING) {
            item(key = "progress") { ProgressCard(book, sessions, minutesPerPage, onLogSession) }
        }
        item(key = "rating") {
            SectionCard(stringResource(R.string.book_section_rating)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RatingBar(book.rating, starSize = 30.dp, onChange = { stars -> onChange { it.copy(rating = stars) } })
                    Spacer(Modifier.weight(1f))
                    Text(
                        if (book.rating > 0f) stringResource(R.string.rating_of_five, formatRating(book.rating)) else stringResource(R.string.rating_none),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SpiceBar(book.spice, size = 28.dp, onChange = { level -> onChange { it.copy(spice = level) } })
                    Spacer(Modifier.weight(1f))
                    Text(
                        stringResource(R.string.spice_label) + if (book.spice > 0) "  ${book.spice}/5" else "",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item(key = "review") {
            SectionCard(stringResource(R.string.book_section_review)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    DateField(stringResource(R.string.book_started), book.startedOn, Modifier.weight(1f)) { pickStart = true }
                    DateField(stringResource(R.string.book_finished), book.finishedOn, Modifier.weight(1f)) { pickEnd = true }
                }
                Spacer(Modifier.height(12.dp))
                AutoSaveField(
                    key = book.id,
                    value = book.review,
                    label = stringResource(R.string.book_review_hint),
                    minLines = 3,
                    tag = "review",
                ) { text -> container.library.modify(book.id) { it.copy(review = text) } }
            }
        }
        item(key = "ownership") {
            SectionCard(stringResource(R.string.book_section_ownership)) {
                // The loan between friends this book is out on, when this device knows of it:
                // for my own book the one it was lent through, for a borrowed copy the one it came with.
                // A book whose loan is not known (the other account is gone, or the loan was put
                // away) is a book lent or borrowed by hand, and is looked after by hand below.
                val loan = loans.firstOrNull { book.loanId.isNotBlank() && it.id == book.loanId }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Ownership.entries.forEach { ownership ->
                        FilterChip(
                            selected = book.ownership == ownership,
                            // Saying by hand that a book is mine, borrowed or neither ends what a loan that is gone left on it.
                            onClick = { onChange { it.copy(ownership = ownership, loanId = if (loan == null && ownership != it.ownership) "" else it.loanId) } },
                            label = { Text(stringResource(ownership.labelRes())) },
                            modifier = Modifier.testTag("own_${ownership.name}"),
                        )
                    }
                }
                if (loan != null) LoanOfBook(loan)
                // Who else asks for it, and whom it is promised to.
                loans.filter { it.lender && it.bookId == book.id && !it.over && it.id != loan?.id }.forEach { LoanOfBook(it) }
                when (book.ownership) {
                    Ownership.BORROWED -> if (loan == null || loan.lender) {
                        Spacer(Modifier.height(8.dp))
                        AutoSaveField(book.id, book.borrowedFrom, stringResource(R.string.book_borrowed_from), minLines = 1, tag = "borrowedFrom") { text ->
                            container.library.modify(book.id) { it.copy(borrowedFrom = text) }
                        }
                    }
                    Ownership.OWNED -> if (loan == null || !loan.lender) {
                        Spacer(Modifier.height(4.dp))
                        if (book.lentTo.isNotBlank()) {
                            Text(
                                stringResource(R.string.book_lent_to, book.lentTo, Dates.format(book.lentSince)),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                            TextButton(onClick = { onChange { it.copy(lentTo = "", lentSince = null, loanId = "") } }, modifier = Modifier.testTag("gotItBack")) {
                                Text(stringResource(R.string.book_returned))
                            }
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.book_lendable), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                                Switch(checked = book.lendable, onCheckedChange = { allowed -> onChange { it.copy(lendable = allowed) } }, modifier = Modifier.testTag("lendable"))
                            }
                            TextButton(onClick = { lendTo = true }) { Text(stringResource(R.string.book_mark_lent)) }
                        }
                    }
                    Ownership.NOT_OWNED -> Unit
                }
            }
        }
        item(key = "purchases") { PurchaseSection(book.id, purchases) }
        item(key = "lists") {
            SectionCard(stringResource(R.string.book_section_lists)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    shelves.forEach { shelf ->
                        val member = shelf.id in shelfIds
                        FilterChip(
                            selected = member,
                            onClick = { container.launch { container.library.setOnShelf(book.id, shelf.id, !member) } },
                            label = { Text(shelf.name) },
                        )
                    }
                    FilterChip(
                        selected = false,
                        onClick = { newList = true },
                        label = { Text(stringResource(R.string.lists_new)) },
                        leadingIcon = { Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    )
                }
            }
        }
        item(key = "details") {
            SectionCard(stringResource(R.string.book_section_details)) {
                DetailRow(stringResource(R.string.field_format), stringResource(book.format.labelRes()).takeIf { book.format != BookFormat.UNKNOWN })
                DetailRow(stringResource(if (book.isAudio) R.string.field_minutes else R.string.field_pages), book.pageCount.takeIf { it > 0 }?.toString())
                DetailRow(stringResource(R.string.field_publisher), book.publisher)
                DetailRow(stringResource(R.string.field_year), book.publishedYear)
                DetailRow(stringResource(R.string.field_isbn), book.isbn)
                DetailRow(stringResource(R.string.field_language), book.language)
                DetailRow(stringResource(R.string.field_genres), book.genres)
                DetailRow(stringResource(R.string.field_tags), book.tags)
            }
        }
        if (book.description.isNotBlank()) {
            item(key = "blurb") {
                var expanded by rememberSaveable { mutableStateOf(false) }
                SectionCard(stringResource(R.string.book_section_blurb)) {
                    Text(
                        book.description,
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = if (expanded) Int.MAX_VALUE else 6,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { expanded = !expanded },
                    )
                    if (!expanded && book.description.length > 300) {
                        TextButton(onClick = { expanded = true }) { Text(stringResource(R.string.action_show_more)) }
                    }
                }
            }
        }
    }

    if (pickStart) DayPickerDialog(book.startedOn, { pickStart = false }) { day -> pickStart = false; onChange { it.copy(startedOn = day) } }
    if (pickEnd) DayPickerDialog(book.finishedOn, { pickEnd = false }) { day -> pickEnd = false; onChange { it.copy(finishedOn = day) } }
    if (lendTo) {
        NameDialog(stringResource(R.string.book_mark_lent), "", { lendTo = false }) { name ->
            lendTo = false
            onChange { it.copy(lentTo = name, lentSince = Dates.today(), loanId = "") }
        }
    }
    if (newList) {
        NameDialog(stringResource(R.string.lists_new), "", { newList = false }) { name ->
            newList = false
            container.launch {
                val id = container.library.createShelf(name)
                container.library.setOnShelf(book.id, id, true)
            }
        }
    }
}

/** A loan on the page of the book it is about: how it stands, and the steps open to the reader. */
@Composable
private fun LoanOfBook(loan: Loan) {
    Column(Modifier.fillMaxWidth().padding(top = 10.dp).testTag("bookLoan")) {
        LoanStatus(loan)
        Spacer(Modifier.height(6.dp))
        LoanButtons(loan)
    }
}

@Composable
private fun ProgressCard(book: Book, sessions: List<ReadingSession>, minutesPerPage: Float, onLog: () -> Unit) {
    SectionCard(stringResource(R.string.book_section_progress)) {
        val unit = stringResource(if (book.isAudio) R.string.unit_minutes else R.string.unit_pages)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(book.currentPage.toString(), style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
            if (book.pageCount > 0) {
                Text(" / ${book.pageCount} $unit", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
            }
            Spacer(Modifier.weight(1f))
            book.progress?.let {
                Text("${(it * 100).toInt()} %", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 4.dp))
            }
        }
        book.progress?.let {
            Spacer(Modifier.height(8.dp))
            AnimatedProgress(it, Modifier.fillMaxWidth().height(8.dp))
        }
        ReadingMath.minutesLeft(book, sessions, minutesPerPage)?.let { left ->
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.book_time_left, formatDuration(left)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(12.dp))
        Button(onClick = onLog, modifier = Modifier.fillMaxWidth().testTag("logSession")) { Text(stringResource(R.string.session_log), maxLines = 1) }
    }
}

@Composable
private fun DateField(label: String, day: Long?, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.clickable(onClick = onClick).padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            day?.let { Dates.format(it) } ?: stringResource(R.string.date_not_set),
            style = MaterialTheme.typography.titleMedium,
            color = if (day != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
        )
    }
}

@Composable
private fun DetailRow(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(112.dp))
        Text(value, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
    }
}

/**
 * A text field that saves itself shortly after the user stops typing and once more
 * when the page is left, so nothing typed into a review gets lost.
 *
 * It shows what is stored until the reader types, also when that changes while the page
 * is open (a sync brought a review written on another device). Only what the reader typed
 * is ever saved: a field that was merely looked at writes nothing back.
 */
@Composable
private fun AutoSaveField(key: Long, value: String, label: String, minLines: Int, tag: String, onSave: suspend (String) -> Unit) {
    val container = LocalContainer.current
    // What the reader typed and the store does not hold yet. Null while the field just shows what is stored.
    var typed by remember(key) { mutableStateOf<String?>(null) }
    val pending by rememberUpdatedState(typed)
    val stored by rememberUpdatedState(value)
    LaunchedEffect(typed, value) {
        val mine = typed ?: return@LaunchedEffect
        // The store has caught up with the reader: from here on the field follows it again.
        if (mine == value) {
            typed = null
            return@LaunchedEffect
        }
        delay(700)
        onSave(mine)
    }
    DisposableEffect(key) {
        onDispose {
            val mine = pending
            if (mine != null && mine != stored) container.launch { onSave(mine) }
        }
    }
    OutlinedTextField(
        value = typed ?: value,
        onValueChange = { typed = it },
        label = { Text(label) },
        minLines = minLines,
        singleLine = minLines == 1,
        modifier = Modifier.fillMaxWidth().testTag(tag),
    )
}

@Composable
private fun ReadingTab(book: Book, sessions: List<ReadingSession>, minutesPerPage: Float, onLog: () -> Unit, onTimer: () -> Unit) {
    val container = LocalContainer.current
    var deleting by remember { mutableStateOf<ReadingSession?>(null) }
    deleting?.let { session ->
        ConfirmDelete(stringResource(R.string.delete_session_title), onDismiss = { deleting = null }) {
            deleting = null
            container.launch { container.library.deleteSession(session.id) }
        }
    }
    val unit = stringResource(if (book.isAudio) R.string.unit_minutes else R.string.unit_pages)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 6.dp, bottom = 32.dp)) {
        item(key = "summary") {
            SectionCard(stringResource(R.string.session_summary)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Figure(ReadingMath.totalPages(sessions).toString(), unit, Modifier.weight(1f))
                    Figure(formatDuration(ReadingMath.totalMinutes(sessions)), stringResource(R.string.session_time), Modifier.weight(1f))
                    Figure(
                        String.format(java.util.Locale.getDefault(), "%.1f", ReadingMath.pace(sessions, minutesPerPage)),
                        stringResource(R.string.session_pace),
                        Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = onLog, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.session_log), maxLines = 1) }
                    // The stopwatch is an extra for those who want it, not the main way to log reading.
                    IconButton(onClick = onTimer, modifier = Modifier.testTag("openTimer")) {
                        Icon(Icons.Rounded.Timer, contentDescription = stringResource(R.string.timer_title), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (sessions.isEmpty()) {
            item(key = "empty") { EmptyHint(stringResource(R.string.session_empty)) }
        }
        items(sessions, key = { it.id }) { session ->
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(session.startedAt)),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        stringResource(R.string.session_range, session.startPage, session.endPage, session.pages, unit),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    if (session.minutes > 0f) {
                        Text(formatDuration(session.minutes.toInt()), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                    }
                    if (session.note.isNotBlank()) Text(session.note, style = MaterialTheme.typography.bodyMedium)
                }
                IconButton(onClick = { deleting = session }, modifier = Modifier.testTag("deleteSession")) {
                    Icon(Icons.Rounded.Delete, contentDescription = stringResource(R.string.action_delete), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
private fun Figure(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(value, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary, maxLines = 1)
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

@Composable
fun EmptyHint(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp),
    )
}

@Composable
private fun QuotesTab(quotes: List<Quote>, onAdd: () -> Unit, onEdit: (Long) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 6.dp, bottom = 32.dp)) {
        item(key = "add") {
            Button(onClick = onAdd, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).testTag("addQuote")) {
                Icon(Icons.Rounded.Add, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.quote_add))
            }
        }
        if (quotes.isEmpty()) item(key = "empty") { EmptyHint(stringResource(R.string.quote_empty_book)) }
        items(quotes, key = { it.id }) { quote ->
            SectionCard(null, Modifier.clickable { onEdit(quote.id) }) {
                Text("„" + quote.text + "“", style = QuoteStyle)
                if (quote.page > 0) {
                    Text(
                        stringResource(R.string.quote_page, quote.page),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                if (quote.note.isNotBlank()) Text(quote.note, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun NotesTab(bookId: Long, notes: List<Note>) {
    val container = LocalContainer.current
    var editing by remember { mutableStateOf<Note?>(null) }
    var deleting by remember { mutableStateOf<Note?>(null) }
    deleting?.let { note ->
        ConfirmDelete(stringResource(R.string.delete_note_title), onDismiss = { deleting = null }) {
            deleting = null
            editing = null
            container.launch { container.library.deleteNote(note.id) }
        }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 6.dp, bottom = 32.dp)) {
        item(key = "add") {
            Button(onClick = { editing = Note(bookId = bookId, text = "") }, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).testTag("addNote")) {
                Icon(Icons.Rounded.Add, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.note_add))
            }
        }
        if (notes.isEmpty()) item(key = "empty") { EmptyHint(stringResource(R.string.note_empty)) }
        items(notes, key = { it.id }) { note ->
            SectionCard(null, Modifier.clickable { editing = note }) {
                if (note.title.isNotBlank()) Text(note.title, style = MaterialTheme.typography.titleMedium)
                Text(note.text, style = MaterialTheme.typography.bodyLarge)
                Text(
                    DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(note.createdAt)),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
    editing?.let { note ->
        NoteDialog(
            note = note,
            onClose = { editing = null },
            onSave = { saved ->
                editing = null
                container.launch { container.library.saveNote(saved) }
            },
            onDelete = { deleting = note },
        )
    }
}

/**
 * Writes or changes a note. A composable of its own, so that a letter typed here redraws
 * this dialog and not the list of notes behind it.
 */
@Composable
private fun NoteDialog(note: Note, onClose: () -> Unit, onSave: (Note) -> Unit, onDelete: () -> Unit) {
    var title by remember(note) { mutableStateOf(note.title) }
    var text by remember(note) { mutableStateOf(note.text) }
    AlertDialog(
        // A tap beside the dialog, or Back, closes it only while nothing was typed: a note
        // half written is not thrown away by a finger that missed. "Cancel" is the way out.
        onDismissRequest = { if (title == note.title && text == note.text) onClose() },
        title = { Text(stringResource(if (note.id == 0L) R.string.note_add else R.string.note_edit)) },
        text = {
            Column {
                OutlinedTextField(title, { title = it }, label = { Text(stringResource(R.string.note_title)) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("noteTitle"))
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(text, { text = it }, label = { Text(stringResource(R.string.note_text)) }, minLines = 4, modifier = Modifier.fillMaxWidth().testTag("noteText"))
            }
        },
        confirmButton = {
            TextButton(
                enabled = text.isNotBlank(),
                onClick = { onSave(note.copy(title = title.trim(), text = text.trim())) },
                modifier = Modifier.testTag("noteSave"),
            ) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = {
            Row {
                if (note.id != 0L) {
                    TextButton(onClick = onDelete, modifier = Modifier.testTag("deleteNote")) { Text(stringResource(R.string.action_delete)) }
                }
                TextButton(onClick = onClose, modifier = Modifier.testTag("noteCancel")) { Text(stringResource(R.string.action_cancel)) }
            }
        },
    )
}

/** Asks from which page to which the user read, and optionally for how long. */
@Composable
fun LogSessionDialog(book: Book, presetMinutes: Int?, onDismiss: () -> Unit, onSave: (ReadingSession) -> Unit) {
    val startDefault = if (book.status == ReadingStatus.READ) 0 else book.currentPage
    var from by rememberSaveable { mutableStateOf(startDefault.toString()) }
    var to by rememberSaveable { mutableStateOf("") }
    var minutes by rememberSaveable { mutableStateOf(presetMinutes?.toString().orEmpty()) }
    val fromPage = from.toIntOrNull()
    val toPage = to.toIntOrNull()
    val valid = fromPage != null && toPage != null && toPage > fromPage && (book.pageCount <= 0 || toPage <= book.pageCount)
    val unit = stringResource(if (book.isAudio) R.string.field_minute_position else R.string.field_page)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.session_log)) },
        text = {
            Column {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    NumberField(from, { from = it }, stringResource(R.string.session_from, unit), Modifier.weight(1f), "sessionFrom")
                    NumberField(to, { to = it }, stringResource(R.string.session_to, unit), Modifier.weight(1f), "sessionTo")
                }
                Spacer(Modifier.height(8.dp))
                NumberField(minutes, { minutes = it }, stringResource(R.string.session_minutes), Modifier.fillMaxWidth(), "sessionMinutes")
                if (book.pageCount > 0) {
                    Text(
                        stringResource(R.string.session_book_length, book.pageCount),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(enabled = valid, onClick = {
                val spent = minutes.toFloatOrNull() ?: 0f
                // The start time is worked back from now, so the session lands on the right day.
                val startedAt = System.currentTimeMillis() - (spent * 60_000).toLong()
                onSave(ReadingSession(bookId = book.id, startedAt = startedAt, startPage = fromPage ?: 0, endPage = toPage ?: 0, minutes = spent))
            }, modifier = Modifier.testTag("sessionSave")) { Text(stringResource(R.string.action_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
fun NumberField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, tag: String = "") {
    OutlinedTextField(
        value = value,
        onValueChange = { new -> onChange(new.filter(Char::isDigit).take(6)) },
        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = if (tag.isEmpty()) modifier else modifier.testTag(tag),
    )
}
