@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ch.schmidtbit.shelfmark.ui.friends

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanAction
import ch.schmidtbit.shelfmark.data.model.LoanRules
import ch.schmidtbit.shelfmark.ui.LocalContainer
import ch.schmidtbit.shelfmark.ui.components.BookCover
import ch.schmidtbit.shelfmark.ui.components.SectionCard
import ch.schmidtbit.shelfmark.ui.theme.LocalShelfColors
import ch.schmidtbit.shelfmark.util.Dates

// A loan shows up in three places: the list of loans, the page of the book it is about, and
// the friend's shelf it was asked from. It says the same and offers the same steps in all three.

/** How long a book is lent for when the lender picks a day and has no other in mind: four weeks. */
private const val USUAL_LOAN_DAYS = 28L

/** The steps that open a dialog before anything is sent: they need a day or a word, or cannot be taken back. */
private val ASKS_FIRST = setOf(LoanAction.AGREE, LoanAction.SET_DUE, LoanAction.DECLINE, LoanAction.CANCEL, LoanAction.CLOSE)

/** How a loan stands: the sentence, the lender's reason, the day, and what the borrower wrote. */
@Composable
fun LoanStatus(loan: Loan, modifier: Modifier = Modifier) {
    val resources = LocalResources.current
    Column(modifier) {
        Text(loanLine(resources, loan), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.testTag("loanLine"))
        loanReason(resources, loan)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp)) }
        loanDue(resources, loan, Dates.today())?.let { due ->
            Text(
                due.text,
                style = MaterialTheme.typography.labelLarge,
                color = if (due.late) LocalShelfColors.current.spice else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp).testTag("loanDue"),
            )
        }
        if (loan.note.isNotBlank()) {
            Text(stringResource(R.string.loan_note, loan.note), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/**
 * The steps the reader can take from where the loan stands, as buttons. A step that is
 * not to be taken lightly, or that needs a word or a day, asks first.
 */
@Composable
fun LoanButtons(loan: Loan, modifier: Modifier = Modifier) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val resources = LocalResources.current
    var busy by remember { mutableStateOf(false) }
    // The step that waits for an answer in a dialog.
    var asking by remember { mutableStateOf<LoanAction?>(null) }

    fun take(action: LoanAction, due: Long? = null, reason: String = "") {
        asking = null
        busy = true
        container.launch {
            val failed = container.server.loanAct(loan.id, action, due, reason)
            busy = false
            if (failed != null) Toast.makeText(context, context.getString(loanProblemRes(failed), failed), Toast.LENGTH_LONG).show()
        }
    }

    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LoanRules.actions(loan).forEach { action ->
            val tag = Modifier.testTag("loan_" + action.word)
            val onClick: () -> Unit = {
                if (action in ASKS_FIRST) {
                    asking = action
                } else {
                    take(action)
                }
            }
            val label = stringResource(action.labelRes())
            when (action) {
                // What moves the loan on.
                LoanAction.AGREE, LoanAction.HAND, LoanAction.RECEIVE, LoanAction.GIVE_BACK, LoanAction.TAKE_BACK ->
                    Button(onClick = onClick, enabled = !busy, modifier = tag) { Text(label) }
                // What changes it without moving it.
                LoanAction.SET_DUE, LoanAction.CANCEL -> TextButton(onClick = onClick, enabled = !busy, modifier = tag) { Text(label) }
                else -> OutlinedButton(onClick = onClick, enabled = !busy, modifier = tag) { Text(label) }
            }
        }
    }

    val who = loanPeer(resources, loan)
    when (asking) {
        LoanAction.AGREE -> DueDialog(
            title = stringResource(R.string.loan_yes_title, loan.title, who),
            text = stringResource(R.string.loan_yes_text, who),
            initial = null,
            onDismiss = { asking = null },
            onChosen = { day -> take(LoanAction.AGREE, due = day) },
        )
        LoanAction.SET_DUE -> DueDialog(
            title = stringResource(R.string.loan_due_title),
            text = null,
            initial = loan.dueOn,
            onDismiss = { asking = null },
            onChosen = { day -> take(LoanAction.SET_DUE, due = day) },
        )
        LoanAction.DECLINE -> ReasonDialog(
            title = stringResource(R.string.loan_no_title, who),
            confirm = stringResource(R.string.loan_no),
            onDismiss = { asking = null },
            onConfirm = { reason -> take(LoanAction.DECLINE, reason = reason) },
        )
        LoanAction.CANCEL -> ReasonDialog(
            title = stringResource(R.string.loan_cancel_title),
            confirm = stringResource(R.string.loan_cancel),
            onDismiss = { asking = null },
            onConfirm = { reason -> take(LoanAction.CANCEL, reason = reason) },
        )
        LoanAction.CLOSE -> AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text(stringResource(R.string.loan_close)) },
            text = { Text(stringResource(R.string.loan_close_text, who)) },
            confirmButton = { TextButton(onClick = { take(LoanAction.CLOSE) }, modifier = Modifier.testTag("loanConfirm")) { Text(stringResource(R.string.action_yes)) } },
            dismissButton = { TextButton(onClick = { asking = null }) { Text(stringResource(R.string.action_cancel)) } },
        )
        else -> Unit
    }
}

/**
 * Asks when the book is wanted back: by a day, or whenever. Both are an answer, so neither
 * is the default, and the reader picks one.
 */
@Composable
private fun DueDialog(title: String, text: String?, initial: Long?, onDismiss: () -> Unit, onChosen: (Long?) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    if (!picking) {
        val words: (@Composable () -> Unit)? = if (text == null) null else { -> Text(text) }
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(title) },
            text = words,
            confirmButton = {
                Column(horizontalAlignment = Alignment.End) {
                    TextButton(onClick = { picking = true }, modifier = Modifier.testTag("dueByDate")) { Text(stringResource(R.string.loan_due_pick)) }
                    TextButton(onClick = { onChosen(null) }, modifier = Modifier.testTag("dueOpen")) { Text(stringResource(R.string.loan_due_open)) }
                    TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
                }
            },
            modifier = Modifier.testTag("dueDialog"),
        )
        return
    }
    val today = Dates.today()
    val state = rememberDatePickerState(
        initialSelectedDateMillis = Dates.toUtcMillis(maxOf(initial ?: (today + USUAL_LOAN_DAYS), today)),
        // A book cannot be wanted back before it is lent.
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = Dates.fromUtcMillis(utcTimeMillis) >= today
            override fun isSelectableYear(year: Int): Boolean = year >= Dates.yearOf(today)
        },
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                enabled = state.selectedDateMillis != null,
                onClick = { state.selectedDateMillis?.let { onChosen(Dates.fromUtcMillis(it)) } },
                modifier = Modifier.testTag("dueDayOk"),
            ) { Text(stringResource(R.string.action_ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    ) {
        DatePicker(
            state = state,
            title = { Text(stringResource(R.string.loan_due_date), modifier = Modifier.padding(start = 24.dp, end = 12.dp, top = 16.dp)) },
        )
    }
}

/** Asks before a no or a yes taken back, and lets the lender say why. Nobody has to. */
@Composable
private fun ReasonDialog(title: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it.take(200) },
                label = { Text(stringResource(R.string.loan_no_reason)) },
                modifier = Modifier.fillMaxWidth().testTag("loanReason"),
            )
        },
        confirmButton = { TextButton(onClick = { onConfirm(reason.trim()) }, modifier = Modifier.testTag("loanConfirm")) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/**
 * A loan in a list: which book, with whom, how it stands, and the steps open to the
 * reader. [onOpenBook] is there when the book stands in the reader's own library, which
 * is the lent book for the lender and the borrowed copy for the borrower.
 */
@Composable
fun LoanCard(loan: Loan, onOpenBook: (() -> Unit)?, modifier: Modifier = Modifier) {
    val resources = LocalResources.current
    SectionCard(null, modifier.testTag("loanCard")) {
        Row(
            (if (onOpenBook != null) Modifier.clickable(onClickLabel = stringResource(R.string.loan_open_book), onClick = onOpenBook) else Modifier)
                .fillMaxWidth().testTag("loanBook"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BookCover(loan.title, loan.authors, loan.coverUrl.ifBlank { null }, Modifier.width(44.dp), elevation = 2.dp, tiny = true)
            Spacer(Modifier.width(12.dp))
            Text(
                stringResource(if (loan.lender) R.string.loan_line_lender else R.string.loan_line_borrower, loan.title, loanPeer(resources, loan)),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.height(8.dp))
        LoanStatus(loan)
        Spacer(Modifier.height(8.dp))
        LoanButtons(loan)
    }
}
