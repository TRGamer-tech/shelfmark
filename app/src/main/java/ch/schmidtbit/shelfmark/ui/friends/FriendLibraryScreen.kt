@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.friends

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.Friend
import ch.schmidtbit.shelfmark.data.model.FriendBook
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.data.model.Ownership
import ch.schmidtbit.shelfmark.data.model.ReadingStatus
import ch.schmidtbit.shelfmark.data.model.withDefaultsFor
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.CoverShelf
import ch.schmidtbit.shelfmark.ui.components.RatingBar
import ch.schmidtbit.shelfmark.ui.components.ShelfItem
import ch.schmidtbit.shelfmark.ui.components.ShelfSection
import ch.schmidtbit.shelfmark.ui.components.SpiceBar
import ch.schmidtbit.shelfmark.ui.detail.EmptyHint
import ch.schmidtbit.shelfmark.ui.labelRes
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import ch.schmidtbit.shelfmark.util.Dates

/** What a friend chose to show of their library. The key identifies the active filter chip. */
private sealed interface FriendFilter {
    data object All : FriendFilter
    data object Owned : FriendFilter
    data object Available : FriendFilter
    data class Status(val status: ReadingStatus) : FriendFilter
    data class OnList(val name: String) : FriendFilter
}

private fun FriendBook.listNames(): List<String> = shelves.split('\n').filter { it.isNotBlank() }

/** A friend's shelf: what they own, what they have read, and what can be borrowed. */
@Composable
fun FriendLibraryScreen(friendId: String, onBack: () -> Unit) {
    val container = LocalContainer.current
    val friend by remember(friendId) { container.social.friend(friendId) }.collectAsStateWithLifecycle(initialValue = null)
    val books by remember(friendId) { container.social.friendBooks(friendId) }.collectAsStateWithLifecycle(initialValue = emptyList())
    val loans by container.social.loans.collectAsStateWithLifecycle(initialValue = emptyList())
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
    var filter by remember { mutableStateOf<FriendFilter>(FriendFilter.All) }
    // The book whose sheet is open, by the id it has in the friend's library. The rows here are
    // written anew, with new numbers, whenever the friend's shelf arrives again, and a loan
    // makes that happen while the sheet is open.
    var openId by rememberSaveable { mutableStateOf<Long?>(null) }
    val available = LocalShelfColors.current.good

    val visible = remember(books, filter) {
        books.filter { book ->
            when (val f = filter) {
                FriendFilter.All -> true
                FriendFilter.Owned -> book.ownership == Ownership.OWNED
                FriendFilter.Available -> book.available
                is FriendFilter.Status -> book.status == f.status
                is FriendFilter.OnList -> f.name in book.listNames()
            }
        }
    }
    val sections = remember(visible, available) {
        listOf(
            ShelfSection(
                key = "friend",
                items = visible.map { ShelfItem(it.localId, it.title, it.authors, it.coverUrl.ifBlank { null }, it.pageCount, it.format, ribbon = if (it.available) available else null) },
            ),
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(friend?.name.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            pluralStringResource(R.plurals.book_count, books.size, books.size),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = { BackButton(onBack) },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                @Composable
                fun chip(target: FriendFilter, label: String, count: Int) {
                    FilterChip(selected = filter == target, onClick = { filter = target }, label = { Text("$label  $count", maxLines = 1) })
                }
                chip(FriendFilter.All, stringResource(R.string.filter_all), books.size)
                chip(FriendFilter.Owned, stringResource(R.string.friend_filter_owned), books.count { it.ownership == Ownership.OWNED })
                chip(FriendFilter.Available, stringResource(R.string.friend_filter_available), books.count { it.available })
                if (friend?.includesStatus == true) {
                    listOf(ReadingStatus.READ, ReadingStatus.READING, ReadingStatus.WISHLIST).forEach { status ->
                        chip(FriendFilter.Status(status), stringResource(status.labelRes()), books.count { it.status == status })
                    }
                    books.flatMap { it.listNames() }.distinct().sorted().forEach { name ->
                        chip(FriendFilter.OnList(name), name, books.count { name in it.listNames() })
                    }
                }
            }
            if (visible.isEmpty()) {
                EmptyHint(stringResource(R.string.library_nothing_matches))
            } else {
                CoverShelf(sections, { item -> openId = books.firstOrNull { it.localId == item.key }?.remoteId }, contentPadding = PaddingValues(top = 4.dp, bottom = 32.dp))
            }
        }
    }

    val open = books.firstOrNull { it.remoteId == openId }
    if (open != null && friend != null) {
        // My loans of this very book, the newest first. An open one is where things stand,
        // one that is over is what came of asking the last time.
        val mine = loans.filter { !it.lender && it.peerId == friendId && it.bookId == open.remoteId }
        FriendBookSheet(
            friend = friend!!,
            book = open,
            loan = mine.firstOrNull { !it.over } ?: mine.firstOrNull(),
            // Borrowing goes from account to account: both have to be on the server.
            cannotAsk = when {
                container.server.available && settings?.signedIn == false -> R.string.friend_borrow_sign_in
                settings?.signedIn != true || friend?.online != true -> R.string.friend_borrow_needs_account
                else -> null
            },
            onDismiss = { openId = null },
        )
    }
}

/** [loan] is my newest loan of this book, [cannotAsk] the text that says why borrowing is not on offer here. */
@Composable
private fun FriendBookSheet(friend: Friend, book: FriendBook, loan: Loan?, cannotAsk: Int?, onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val resources = LocalResources.current
    var note by rememberSaveable { mutableStateOf("") }
    var asking by remember { mutableStateOf(false) }
    var wished by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 20.dp).testTag("friendBookSheet"),
        ) {
            Row {
                BookCover(book.title, book.authors, book.coverUrl.ifBlank { null }, Modifier.width(96.dp))
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(book.title, style = MaterialTheme.typography.titleLarge, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    if (book.authors.isNotBlank()) Text(book.authors, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        stringResource(
                            when (book.ownership) {
                                Ownership.OWNED -> R.string.friend_owns
                                Ownership.BORROWED -> R.string.friend_borrowed
                                Ownership.NOT_OWNED -> R.string.friend_not_owned
                            },
                            friend.name,
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    book.status?.let { Text(stringResource(it.labelRes()), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.secondary) }
                }
            }
            if (friend.includesRatings && (book.rating > 0f || book.spice > 0 || book.review.isNotBlank())) {
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.friend_opinion, friend.name).uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (book.rating > 0f) RatingBar(book.rating, starSize = 22.dp)
                    if (book.spice > 0) SpiceBar(book.spice, size = 20.dp)
                }
                if (book.startedOn != null || book.finishedOn != null) {
                    Text(
                        listOfNotNull(book.startedOn, book.finishedOn).joinToString("  -  ") { Dates.format(it) },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                if (book.review.isNotBlank()) Text(book.review, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
            }
            if (book.description.isNotBlank()) {
                Text(book.description, style = MaterialTheme.typography.bodyMedium, maxLines = 6, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 16.dp))
            }
            Spacer(Modifier.height(20.dp))
            if (loan != null) {
                LoanStatus(loan, Modifier.testTag("loanState"))
                // Who taps first is not obvious, so it is said where the next step is the other's or a joint one.
                val hint = when (loan.state) {
                    LoanState.AGREED -> R.string.loan_handover_hint
                    LoanState.ON_LOAN -> R.string.loan_return_hint
                    else -> null
                }
                if (hint != null) {
                    Text(
                        stringResource(hint, loanPeer(resources, loan)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
            }
            when {
                loan != null && !loan.over -> LoanButtons(loan)
                !book.available -> Text(
                    stringResource(R.string.friend_not_available),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                cannotAsk != null -> Text(
                    stringResource(cannotAsk),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.testTag("cannotAsk"),
                )
                else -> {
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it.take(200) },
                        label = { Text(stringResource(R.string.friend_borrow_note)) },
                        modifier = Modifier.fillMaxWidth().testTag("borrowNote"),
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        enabled = !asking,
                        onClick = {
                            asking = true
                            container.launch {
                                val failed = container.server.loanAsk(book, note)
                                asking = false
                                if (failed == null) note = ""
                                else Toast.makeText(context, context.getString(loanProblemRes(failed), failed), Toast.LENGTH_LONG).show()
                            }
                        },
                        modifier = Modifier.fillMaxWidth().testTag("askToBorrow"),
                    ) { Text(stringResource(R.string.friend_ask_to_borrow)) }
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                enabled = !wished,
                onClick = {
                    wished = true
                    container.launch {
                        val wish = Book(
                            title = book.title, authors = book.authors, isbn = book.isbn, coverUrl = book.coverUrl,
                            pageCount = book.pageCount, format = book.format, description = book.description,
                        ).withDefaultsFor(ReadingStatus.WISHLIST, Dates.today())
                        if (container.library.findByIsbn(book.isbn) == null) container.library.addBook(wish)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(if (wished) R.string.friend_wishlisted else R.string.friend_add_to_wishlist)) }
        }
    }
}
