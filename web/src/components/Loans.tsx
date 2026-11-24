"use client";

// A loan between friends as the reader sees it: how it stands, the day the book is
// wanted back by, and exactly the steps that can be taken from there. The same piece is
// shown on the page of all loans, on the page of the book, and on a friend's shelf, so
// that a loan reads and works the same wherever one meets it.

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { BookCover } from "./BookCover";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";
import { Button, ConfirmDialog, Dialog, Field } from "./ui";
import { formatDay, fromIsoDate, localZone, dayOf, toIsoDate, today } from "@/lib/dates";
import type { Loan, LoanAction } from "@/lib/loans";
import { actionsFor, dueLine, givenReason, standingOf } from "@/lib/loans";
import { loanProblemKey } from "@/lib/supabase/errors";
import { reasonOf } from "@/lib/sync";

/** The name of the button for each step, where the step is taken at once. */
const BUTTON: Partial<Record<LoanAction, string>> = {
  agree: "loan_yes",
  decline: "loan_no",
  cancel: "loan_cancel",
  hand: "loan_hand",
  undo_hand: "loan_undo_hand",
  take_back: "loan_take_back",
  not_returned: "loan_not_returned",
  close: "loan_close",
  set_due: "loan_change_due",
  withdraw: "loan_withdraw",
  receive: "loan_receive",
  not_received: "loan_not_received",
  give_back: "loan_give_back",
  undo_give_back: "loan_undo_give_back",
  hide: "loan_put_away",
};

// The steps that move a loan forward are the ones a card asks for. The others are ways out, and drawn quieter.
const FORWARD: LoanAction[] = ["agree", "hand", "receive", "give_back", "take_back"];

// How long a book is lent for when the lender has no other wish: four weeks, as a library would.
const USUAL_DAYS = 28;

/**
 * The choice every yes comes with: back by a day, or no fixed date. [initial] is the day
 * that stands now, null for none, undefined for a loan that has no answer to this yet.
 */
function DueDialog({ title, text, initial, confirm, testId, onClose, onChosen }: { title: string; text?: string; initial: number | null | undefined; confirm: string; testId: string; onClose: () => void; onChosen: (due: number | null) => void }) {
  const { t } = useI18n();
  const first = today();
  const [fixed, setFixed] = useState(initial !== null);
  const [day, setDay] = useState(toIsoDate(typeof initial === "number" ? Math.max(initial, first) : first + USUAL_DAYS));
  const chosen = fromIsoDate(day);
  // A day that has passed is no day to ask a book back by.
  const valid = !fixed || (chosen !== null && chosen >= first);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onChosen(fixed ? chosen : null);
  };

  return (
    <Dialog
      title={title}
      onClose={onClose}
      testId={testId}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button type="submit" form={`${testId}-form`} disabled={!valid} data-testid="due-confirm">
            {confirm}
          </Button>
        </>
      }
    >
      <form id={`${testId}-form`} className="stack" onSubmit={submit}>
        {text ? <p>{text}</p> : null}
        <fieldset className="choice">
          <legend className="sr-only">{t("loan_due_title")}</legend>
          <label className="choice-row">
            <input type="radio" name="due" checked={fixed} onChange={() => setFixed(true)} data-testid="due-pick" />
            <span>{t("loan_due_pick")}</span>
          </label>
          {fixed ? <Field label={t("loan_due_date")} type="date" min={toIsoDate(first)} value={day} onChange={(event) => setDay(event.target.value)} required data-testid="due-date" /> : null}
          <label className="choice-row">
            <input type="radio" name="due" checked={!fixed} onChange={() => setFixed(false)} data-testid="due-open" />
            <span>{t("loan_due_open")}</span>
          </label>
        </fieldset>
      </form>
    </Dialog>
  );
}

/** Asks for a reason that may be left out, before a no or before a yes is taken back. */
function ReasonDialog({ title, confirm, testId, onClose, onChosen }: { title: string; confirm: string; testId: string; onClose: () => void; onChosen: (reason: string) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      title={title}
      onClose={onClose}
      testId={testId}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button type="submit" form={`${testId}-form`} data-testid="reason-confirm">
            {confirm}
          </Button>
        </>
      }
    >
      <form
        id={`${testId}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          onChosen(reason.trim());
        }}
      >
        <Field label={t("loan_no_reason")} value={reason} onChange={(event) => setReason(event.target.value.slice(0, 200))} autoFocus data-testid="reason-field" />
      </form>
    </Dialog>
  );
}

interface LoanViewProps {
  loan: Loan;
  /** Where "Open the book" leads, for the places that are not the page of the book itself. */
  bookHref?: string;
  /** With the cover and the line that says which book and who: for a list of loans. */
  headline?: boolean;
}

export function LoanView({ loan, bookHref, headline = false }: LoanViewProps) {
  const { t, locale } = useI18n();
  const { actLoan, notify } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<"agree" | "set_due" | "decline" | "cancel" | "close" | null>(null);

  const who = loan.peerName.trim() !== "" ? loan.peerName : t("friends_someone");
  const standing = standingOf(loan);
  const due = dueLine(loan, today());
  const reason = givenReason(loan);
  const actions = actionsFor(loan);
  // What the borrower needs to know about the two moments both sides confirm.
  const hint = loan.role === "borrower" ? (loan.state === "agreed" ? "loan_handover_hint" : loan.state === "on_loan" ? "loan_return_hint" : null) : null;

  const act = async (action: LoanAction, detail?: { due?: number | null; reason?: string }) => {
    if (busy) return;
    setAsking(null);
    setBusy(true);
    try {
      await actLoan(loan, action, detail);
    } catch (error) {
      // Said in a line that passes, not on the card: a loan that has moved on is shown
      // where it stands now, which may be in another place of the page than this card was.
      const why = reasonOf(error);
      notify(t(loanProblemKey(why), why));
    } finally {
      setBusy(false);
    }
  };

  // Some steps ask first: a yes needs its day, a no may give its reason, and what cannot be taken back is confirmed.
  const press = (action: LoanAction) => {
    if (action === "agree" || action === "set_due" || action === "decline" || action === "cancel" || action === "close") setAsking(action);
    else void act(action);
  };

  return (
    <div className="loan" data-testid="loan" data-loan={loan.id} data-state={loan.state} data-role={loan.role}>
      {headline ? (
        <div className="loan-head">
          <BookCover title={loan.book.title} authors={loan.book.authors} url={loan.book.coverUrl.trim() !== "" ? loan.book.coverUrl : null} tiny />
          <p className="strong" data-testid="loan-line">
            {t(loan.role === "lender" ? "loan_line_lender" : "loan_line_borrower", loan.book.title, who)}
          </p>
        </div>
      ) : null}
      <p data-testid="loan-standing">{t(standing.key, who, standing.moment === null ? "" : formatDay(dayOf(standing.moment, localZone), locale))}</p>
      {reason !== "" ? (
        <p className="muted" data-testid="loan-reason">
          {t("loan_reason", reason)}
        </p>
      ) : null}
      {due ? (
        <p className={due.late ? "loan-late" : "muted"} data-testid="loan-due" data-late={due.late}>
          {due.day === null ? t(due.key) : t(due.key, formatDay(due.day, locale))}
        </p>
      ) : null}
      {loan.note.trim() !== "" ? (
        <p className="loan-note" data-testid="loan-note">
          {t("loan_note", loan.note)}
        </p>
      ) : null}
      {hint ? (
        <p className="small muted" data-testid="loan-hint">
          {t(hint, who)}
        </p>
      ) : null}
      {actions.length > 0 || bookHref ? (
        <div className="loan-actions">
          {actions.map((action) => (
            <Button key={action} variant={FORWARD.includes(action) ? "filled" : action === "decline" ? "outline" : "text"} disabled={busy} onClick={() => press(action)} data-testid={`loan-${action}`}>
              {t(BUTTON[action] ?? action)}
            </Button>
          ))}
          {bookHref ? (
            <Link href={bookHref} className="btn btn-text" data-testid="loan-open-book">
              {t("loan_open_book")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {asking === "agree" ? (
        <DueDialog title={t("loan_yes_title", loan.book.title, who)} text={t("loan_yes_text", who)} initial={undefined} confirm={t("loan_yes")} testId="loan-yes-dialog" onClose={() => setAsking(null)} onChosen={(day) => void act("agree", { due: day })} />
      ) : null}
      {asking === "set_due" ? (
        <DueDialog title={t("loan_due_title")} initial={loan.dueOn} confirm={t("action_save")} testId="loan-due-dialog" onClose={() => setAsking(null)} onChosen={(day) => void act("set_due", { due: day })} />
      ) : null}
      {asking === "decline" ? (
        <ReasonDialog title={t("loan_no_title", who)} confirm={t("loan_no")} testId="loan-no-dialog" onClose={() => setAsking(null)} onChosen={(text) => void act("decline", { reason: text })} />
      ) : null}
      {asking === "cancel" ? (
        <ReasonDialog title={t("loan_cancel_title")} confirm={t("loan_cancel")} testId="loan-cancel-dialog" onClose={() => setAsking(null)} onChosen={(text) => void act("cancel", { reason: text })} />
      ) : null}
      {asking === "close" ? <ConfirmDialog title={t("loan_close")} text={t("loan_close_text", who)} confirm={t("loan_close")} testId="loan-close-dialog" onClose={() => setAsking(null)} onConfirm={() => void act("close")} /> : null}
    </div>
  );
}
