@file:OptIn(ExperimentalMaterial3Api::class)

package ch.schmidtbit.shelfmark.ui.friends

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Book
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BackButton
import ch.schmidtbit.shelfmark.ui.components.SectionTitle
import ch.schmidtbit.shelfmark.ui.detail.EmptyHint

/** The book of the reader's own library that a loan is about, if it is there: the book lent, or the copy borrowed. */
fun bookOfLoan(loan: Loan, library: List<Book>): Book? =
    if (loan.lender) library.firstOrNull { it.id == loan.bookId } else library.firstOrNull { it.loanId == loan.id }

/**
 * Every loan the reader is part of, lending and borrowing alike, sorted by what there is
 * to do about it: first what waits for the reader's own tap.
 */
@Composable
fun LoansScreen(onBack: () -> Unit, onOpenBook: (Long) -> Unit) {
    val container = LocalContainer.current
    val loans by container.social.loans.collectAsStateWithLifecycle(initialValue = emptyList())
    val library by container.library.books.collectAsStateWithLifecycle(initialValue = emptyList())

    val todo = loans.filter { it.waitsForMe }
    val past = loans.filter { it.over }
    val rest = loans.filter { !it.waitsForMe && !it.over }
    // "Lent" and "borrowed" are books that changed hands. Before that a loan is on its way.
    val lent = rest.filter { it.lender && it.state.out }
    val borrowed = rest.filter { !it.lender && it.state.out }
    val open = rest.filter { !it.state.out }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.loans_title)) }, navigationIcon = { BackButton(onBack) }) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // Whoever waits for an answer here should know when it cannot reach them as a notification.
            // Above the list and not in it: it turns up a moment after the list does, and a list
            // holds on to what it shows, so a first entry that comes late would be out of sight.
            NotificationsCard()
            LazyColumn(Modifier.fillMaxSize().testTag("loans"), contentPadding = PaddingValues(bottom = 32.dp)) {
                if (loans.isEmpty()) item(key = "empty") { EmptyHint(stringResource(R.string.loans_empty)) }
                listOf(
                    R.string.loans_section_todo to todo,
                    R.string.loans_section_open to open,
                    R.string.loans_section_lent to lent,
                    R.string.loans_section_borrowed to borrowed,
                    R.string.loans_section_past to past,
                ).forEach { (title, section) ->
                    if (section.isNotEmpty()) item(key = "title$title") { SectionTitle(stringResource(title)) }
                    items(section, key = { it.id }) { loan ->
                        val book = bookOfLoan(loan, library)
                        LoanCard(loan, onOpenBook = book?.let { { onOpenBook(it.id) } })
                    }
                }
            }
        }
    }
}
