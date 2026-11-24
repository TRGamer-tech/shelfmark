package ch.schmidtbit.shelfmark.ui.friends

import android.content.res.Resources
import androidx.annotation.StringRes
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.data.model.Loan
import ch.schmidtbit.shelfmark.data.model.LoanAction
import ch.schmidtbit.shelfmark.data.model.LoanNewsKind
import ch.schmidtbit.shelfmark.data.model.LoanState
import ch.schmidtbit.shelfmark.util.Dates

// What a loan is called in words. The screens and the notifications say the same things,
// so the sentences are put together here, from plain resources, where both can reach them.

/** The other person of a loan, by the name they gave themselves. */
fun loanPeer(resources: Resources, loan: Loan): String = loan.peerName.ifBlank { resources.getString(R.string.friends_someone) }

/** How a loan stands, in a sentence for the side the reader is on. */
fun loanLine(resources: Resources, loan: Loan): String {
    fun day(moment: Long?): String = Dates.format(Dates.dayOf(moment ?: loan.updatedAt))
    val text = if (loan.lender) {
        when (loan.state) {
            LoanState.ASKED -> R.string.loan_l_asked
            LoanState.AGREED -> R.string.loan_l_agreed
            LoanState.HANDED -> R.string.loan_l_handed
            LoanState.ON_LOAN -> R.string.loan_l_on_loan
            LoanState.GIVEN_BACK -> R.string.loan_l_given_back
            LoanState.RETURNED -> R.string.loan_l_returned
            LoanState.DECLINED -> if (loan.taken) R.string.loan_l_taken else R.string.loan_l_declined
            LoanState.WITHDRAWN -> R.string.loan_l_withdrawn
            LoanState.CANCELLED -> R.string.loan_l_cancelled
        }
    } else {
        when (loan.state) {
            LoanState.ASKED -> R.string.loan_b_asked
            LoanState.AGREED -> R.string.loan_b_agreed
            LoanState.HANDED -> R.string.loan_b_handed
            LoanState.ON_LOAN -> R.string.loan_b_on_loan
            LoanState.GIVEN_BACK -> R.string.loan_b_given_back
            LoanState.RETURNED -> R.string.loan_b_returned
            LoanState.DECLINED -> if (loan.taken) R.string.loan_b_taken else R.string.loan_b_declined
            LoanState.WITHDRAWN -> R.string.loan_b_withdrawn
            LoanState.CANCELLED -> R.string.loan_b_cancelled
        }
    }
    // The day a sentence names is the day of the step it speaks of. Sentences without a day ignore it.
    val since = when (loan.state) {
        LoanState.ASKED -> day(loan.askedAt)
        LoanState.ON_LOAN -> day(loan.receivedAt)
        // The lender has it back since they said so, the borrower gave it back when they said so.
        LoanState.RETURNED -> day(if (loan.lender) loan.closedAt else loan.givenBackAt ?: loan.closedAt)
        else -> ""
    }
    return resources.getString(text, loanPeer(resources, loan), since)
}

/** The lender's own words for a no, or for a yes taken back. Null when there are none. */
fun loanReason(resources: Resources, loan: Loan): String? =
    loan.reason.takeIf { it.isNotBlank() && !loan.taken && (loan.state == LoanState.DECLINED || loan.state == LoanState.CANCELLED) }
        ?.let { resources.getString(R.string.loan_reason, it) }

/** What is said about the day a book is wanted back by. [late] is true once that day is past. */
data class LoanDue(val text: String, val late: Boolean)

/** Null for a loan that is over or not agreed yet: no day counts for those. */
fun loanDue(resources: Resources, loan: Loan, today: Long): LoanDue? {
    if (!loan.state.holdsBook) return null
    val day = loan.dueOn ?: return LoanDue(resources.getString(R.string.loan_due_open), late = false)
    return when {
        // A book that was not handed over yet is not late, whatever the day.
        !loan.state.out || day > today -> LoanDue(resources.getString(R.string.loan_due_by, Dates.format(day)), late = false)
        day == today -> LoanDue(resources.getString(R.string.loan_due_today), late = false)
        else -> LoanDue(resources.getString(R.string.loan_due_over, Dates.format(day)), late = true)
    }
}

@StringRes
fun LoanAction.labelRes(): Int = when (this) {
    LoanAction.AGREE -> R.string.loan_yes
    LoanAction.DECLINE -> R.string.loan_no
    LoanAction.CANCEL -> R.string.loan_cancel
    LoanAction.HAND -> R.string.loan_hand
    LoanAction.UNDO_HAND -> R.string.loan_undo_hand
    LoanAction.TAKE_BACK -> R.string.loan_take_back
    LoanAction.NOT_RETURNED -> R.string.loan_not_returned
    LoanAction.CLOSE -> R.string.loan_close
    LoanAction.SET_DUE -> R.string.loan_change_due
    LoanAction.WITHDRAW -> R.string.loan_withdraw
    LoanAction.RECEIVE -> R.string.loan_receive
    LoanAction.NOT_RECEIVED -> R.string.loan_not_received
    LoanAction.GIVE_BACK -> R.string.loan_give_back
    LoanAction.UNDO_GIVE_BACK -> R.string.loan_undo_give_back
    LoanAction.HIDE -> R.string.loan_put_away
}

/** What a notification says about a step the other side took. Takes the friend's name and the title of the book. */
@StringRes
fun LoanNewsKind.textRes(): Int = when (this) {
    LoanNewsKind.ASKED -> R.string.notify_loan_asked
    LoanNewsKind.AGREED -> R.string.notify_loan_agreed
    LoanNewsKind.DECLINED -> R.string.notify_loan_declined
    LoanNewsKind.TAKEN -> R.string.notify_loan_taken
    LoanNewsKind.CANCELLED -> R.string.notify_loan_cancelled
    LoanNewsKind.HANDED -> R.string.notify_loan_handed
    LoanNewsKind.NOT_RECEIVED -> R.string.notify_loan_not_received
    LoanNewsKind.ON_LOAN -> R.string.notify_loan_on_loan
    LoanNewsKind.GIVEN_BACK -> R.string.notify_loan_given_back
    LoanNewsKind.NOT_RETURNED -> R.string.notify_loan_not_returned
    LoanNewsKind.RETURNED -> R.string.notify_loan_returned
    LoanNewsKind.WITHDRAWN -> R.string.notify_loan_withdrawn
    LoanNewsKind.DUE_CHANGED -> R.string.notify_loan_due_changed
}

/**
 * Why a step of a loan did not happen, in the reader's words. The words the server has
 * for loans come first, everything else is what [serverProblemRes] says about it.
 */
@StringRes
fun loanProblemRes(reason: String): Int = when (reason) {
    "taken" -> R.string.loan_error_taken
    "not_allowed" -> R.string.loan_error_not_allowed
    "unknown_loan" -> R.string.loan_error_gone
    "not_friends" -> R.string.loan_error_not_friends
    // For a question, "full" is about the asker: too many of them are open.
    "full" -> R.string.loan_error_full
    else -> serverProblemRes(reason)
}
