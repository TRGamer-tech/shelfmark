package ch.schmidtbit.shelfmark.data.model

/** A step in the life of a loan, as the server function shelfmark_loan_act names it (in lower case). */
enum class LoanAction {
    AGREE, DECLINE, CANCEL, HAND, UNDO_HAND, TAKE_BACK, NOT_RETURNED, CLOSE, SET_DUE,
    WITHDRAW, RECEIVE, NOT_RECEIVED, GIVE_BACK, UNDO_GIVE_BACK,
    HIDE;

    val word: String get() = name.lowercase()
}

/** What the other side did to a loan, in the words a notification needs. */
enum class LoanNewsKind {
    ASKED, AGREED, DECLINED, TAKEN, CANCELLED, HANDED, NOT_RECEIVED, ON_LOAN, GIVEN_BACK, NOT_RETURNED, RETURNED, WITHDRAWN, DUE_CHANGED;

    /** The reader has to answer or confirm before the loan goes on. */
    val asksForATap: Boolean get() = this == ASKED || this == HANDED || this == GIVEN_BACK
}

/**
 * A loan the other side changed since this device last looked. [kind] is null when the
 * change needs no words (a tap taken back, say): what was said about the loan before is
 * no longer true, and there is nothing new to say.
 */
data class LoanNews(val loan: Loan, val kind: LoanNewsKind?)

/** Who may do what to a loan and what a change means, as "Loans" in supabase/README.md has it. */
object LoanRules {
    /** The reason the server gives when the book went to somebody else. */
    const val TAKEN = "taken"

    /** The steps open to the reader from where the loan stands. The server allows these and no others. */
    fun actions(loan: Loan): List<LoanAction> = actions(loan.lender, loan.state)

    fun actions(lender: Boolean, state: LoanState): List<LoanAction> = when {
        state.over -> listOf(LoanAction.HIDE)
        lender -> when (state) {
            LoanState.ASKED -> listOf(LoanAction.AGREE, LoanAction.DECLINE)
            LoanState.AGREED -> listOf(LoanAction.HAND, LoanAction.SET_DUE, LoanAction.CANCEL)
            LoanState.HANDED -> listOf(LoanAction.UNDO_HAND, LoanAction.SET_DUE, LoanAction.CANCEL)
            LoanState.ON_LOAN -> listOf(LoanAction.CLOSE, LoanAction.SET_DUE)
            LoanState.GIVEN_BACK -> listOf(LoanAction.TAKE_BACK, LoanAction.NOT_RETURNED, LoanAction.SET_DUE)
            else -> emptyList()
        }
        else -> when (state) {
            LoanState.ASKED, LoanState.AGREED -> listOf(LoanAction.WITHDRAW)
            LoanState.HANDED -> listOf(LoanAction.RECEIVE, LoanAction.NOT_RECEIVED)
            LoanState.ON_LOAN -> listOf(LoanAction.GIVE_BACK)
            LoanState.GIVEN_BACK -> listOf(LoanAction.UNDO_GIVE_BACK)
            else -> emptyList()
        }
    }

    /**
     * What the other side did, read from where [loan] stands now and where this device last
     * saw it ([before], null when it never did). The server keeps no history, so a step is
     * told by the state it leads to. Where two steps lead to the same state, the state seen
     * before decides.
     *
     * A friendship that ended is told the same way: its open questions come back as taken
     * back or as answered with a no, and whoever did not end it hears of each like of any
     * other step of the other side.
     */
    fun news(loan: Loan, before: Loan?): LoanNewsKind? {
        val dueMoved = before != null && before.dueOn != loan.dueOn
        return if (loan.lender) {
            when (loan.state) {
                LoanState.ASKED -> LoanNewsKind.ASKED
                // A question this device never showed is not missed when it is gone.
                LoanState.WITHDRAWN -> if (before == null) null else LoanNewsKind.WITHDRAWN
                // The only way back to "reserved" that the borrower has.
                LoanState.AGREED -> LoanNewsKind.NOT_RECEIVED
                // Seen as out before: the borrower took "I gave it back" back, and nothing is new.
                LoanState.ON_LOAN -> if (before?.state?.out == true) null else LoanNewsKind.ON_LOAN
                LoanState.GIVEN_BACK -> LoanNewsKind.GIVEN_BACK
                else -> null
            }
        } else {
            when (loan.state) {
                LoanState.AGREED -> when {
                    before == null || before.state == LoanState.ASKED -> LoanNewsKind.AGREED
                    dueMoved -> LoanNewsKind.DUE_CHANGED
                    // "Handed over" was taken back.
                    else -> null
                }
                LoanState.HANDED -> if (before?.state == LoanState.HANDED && dueMoved) LoanNewsKind.DUE_CHANGED else LoanNewsKind.HANDED
                LoanState.ON_LOAN -> when {
                    // Another day, or "I did not get it back"? Without having seen the loan before there is no telling.
                    before == null -> null
                    before.state != LoanState.GIVEN_BACK && dueMoved -> LoanNewsKind.DUE_CHANGED
                    else -> LoanNewsKind.NOT_RETURNED
                }
                LoanState.GIVEN_BACK -> if (dueMoved) LoanNewsKind.DUE_CHANGED else null
                LoanState.RETURNED -> LoanNewsKind.RETURNED
                LoanState.DECLINED -> if (loan.taken) LoanNewsKind.TAKEN else LoanNewsKind.DECLINED
                LoanState.CANCELLED -> LoanNewsKind.CANCELLED
                // Asking and taking a question back are the borrower's own steps.
                else -> null
            }
        }
    }
}
