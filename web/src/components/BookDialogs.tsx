"use client";

// The small forms around a book: a reading session, a quote, a note, a purchase.

import { useState } from "react";
import { fromIsoDate, toIsoDate, today } from "@/lib/dates";
import { newId } from "@/lib/ids";
import type { Book, Note, Purchase, Quote } from "@/lib/model";
import { noteCodec, purchaseCodec, quoteCodec, sessionCodec } from "@/lib/model";
import { deleteNote, deletePurchase, deleteQuote, logSession, saveNote, savePurchase, saveQuote } from "@/lib/mutations";
import { isAudio } from "@/lib/rules";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";
import { Button, Dialog, Field, TextArea, digits } from "./ui";

interface LogSessionProps {
  book: Book;
  onClose: () => void;
  /** What the reading timer measured. The reader can still correct it. */
  presetMinutes?: number;
  /** When the timer was started. Without a timer the start is worked back from the minutes. */
  startedAt?: number;
  /** Called after the session went into the library, not when the form is only closed. */
  onSaved?: () => void;
}

/** Asks from which page to which the reader read, and optionally for how long. */
export function LogSessionDialog({ book, onClose, presetMinutes, startedAt, onSaved }: LogSessionProps) {
  const { t } = useI18n();
  const { mutate } = useLibrary();
  const [from, setFrom] = useState(String(book.status === "READ" ? 0 : book.currentPage));
  const [to, setTo] = useState("");
  const [minutes, setMinutes] = useState(presetMinutes === undefined ? "" : String(presetMinutes));
  const [note, setNote] = useState("");
  const fromPage = from === "" ? null : Number(from);
  const toPage = to === "" ? null : Number(to);
  const valid = fromPage !== null && toPage !== null && toPage > fromPage && (book.pageCount <= 0 || toPage <= book.pageCount);
  const unit = t(isAudio(book) ? "field_minute_position" : "field_page");

  const save = () => {
    if (!valid || fromPage === null || toPage === null) return;
    const spent = minutes === "" ? 0 : Number(minutes);
    const now = Date.now();
    // The start time is worked back from now, so the session lands on the right day.
    const session = { ...sessionCodec.read({}), id: newId(now), bookId: book.id, startedAt: startedAt ?? now - Math.round(spent * 60_000), startPage: fromPage, endPage: toPage, minutes: spent, note: note.trim() };
    void mutate(logSession(session, today(), now));
    onClose();
    onSaved?.();
  };

  return (
    <Dialog
      title={t("session_log")}
      onClose={onClose}
      testId="session-dialog"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button type="submit" form="session-form" disabled={!valid} data-testid="session-save">
            {t("action_save")}
          </Button>
        </>
      }
    >
      <form
        id="session-form"
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="field-row">
          <Field label={t("session_from", unit)} inputMode="numeric" value={from} onChange={(event) => setFrom(digits(event.target.value))} data-testid="session-from" />
          <Field label={t("session_to", unit)} inputMode="numeric" value={to} onChange={(event) => setTo(digits(event.target.value))} autoFocus data-testid="session-to" />
        </div>
        <Field label={t("session_minutes")} inputMode="numeric" value={minutes} onChange={(event) => setMinutes(digits(event.target.value, 4))} data-testid="session-minutes" />
        <Field label={t("web_session_note")} value={note} onChange={(event) => setNote(event.target.value.slice(0, 200))} />
        {book.pageCount > 0 ? <p className="small muted">{t("session_book_length", book.pageCount)}</p> : null}
      </form>
    </Dialog>
  );
}

/** A new quote or an existing one. Without [bookId] the reader chooses the book. */
export function QuoteDialog({ quote, bookId, books, onClose }: { quote: Quote | null; bookId?: number; books: Book[]; onClose: () => void }) {
  const { t } = useI18n();
  const { mutate } = useLibrary();
  const [chosen, setChosen] = useState<number | null>(quote?.bookId ?? bookId ?? null);
  const [text, setText] = useState(quote?.text ?? "");
  const [page, setPage] = useState(quote && quote.page > 0 ? String(quote.page) : "");
  const [note, setNote] = useState(quote?.note ?? "");
  const [confirming, setConfirming] = useState(false);
  const valid = chosen !== null && text.trim() !== "";

  const save = () => {
    if (!valid || chosen === null) return;
    const base = quote ?? { ...quoteCodec.read({}), id: newId(), createdAt: Date.now() };
    void mutate(saveQuote({ ...base, bookId: chosen, text: text.trim(), page: page === "" ? 0 : Number(page), note: note.trim() }));
    onClose();
  };

  const paste = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (clip !== "") setText((current) => (current.trim() === "" ? clip : `${current.trimEnd()} ${clip}`));
    } catch {
      // The browser did not allow it. Pasting with the keyboard still works.
    }
  };

  return (
    <Dialog
      title={t(quote ? "quote_edit" : "quote_add")}
      onClose={onClose}
      testId="quote-dialog"
      actions={
        <>
          {quote ? (
            <Button variant="text" onClick={() => setConfirming(true)} data-testid="quote-delete">
              {t("action_delete")}
            </Button>
          ) : null}
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button onClick={save} disabled={!valid} data-testid="quote-save">
            {t("action_save")}
          </Button>
        </>
      }
    >
      {bookId === undefined ? (
        <div className="field">
          <label htmlFor="quote-book">{t("quote_book")}</label>
          <select id="quote-book" value={chosen ?? ""} onChange={(event) => setChosen(event.target.value === "" ? null : Number(event.target.value))} data-testid="quote-book">
            <option value="">{t("quote_choose_book")}</option>
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <TextArea label={t("quote_text")} value={text} onChange={(event) => setText(event.target.value)} rows={5} autoFocus data-testid="quote-text" />
      <div>
        <Button variant="outline" icon="paste" onClick={() => void paste()}>
          {t("quote_paste")}
        </Button>
      </div>
      <div className="field-row field-row-3">
        <Field label={t("quote_note")} value={note} onChange={(event) => setNote(event.target.value)} />
        <Field label={t("field_page")} inputMode="numeric" value={page} onChange={(event) => setPage(digits(event.target.value, 5))} data-testid="quote-page" />
      </div>
      {confirming && quote ? (
        <p className="row" role="alert">
          <span className="grow">{t("web_delete_quote_title")}</span>
          <Button
            variant="danger"
            onClick={() => {
              void mutate(deleteQuote(quote.id));
              onClose();
            }}
            data-testid="confirm"
          >
            {t("action_delete")}
          </Button>
        </p>
      ) : null}
    </Dialog>
  );
}

export function NoteDialog({ note, bookId, onClose }: { note: Note | null; bookId: number; onClose: () => void }) {
  const { t } = useI18n();
  const { mutate } = useLibrary();
  const [title, setTitle] = useState(note?.title ?? "");
  const [text, setText] = useState(note?.text ?? "");
  const [page, setPage] = useState(note && note.page > 0 ? String(note.page) : "");
  const [confirming, setConfirming] = useState(false);
  const valid = text.trim() !== "";

  const save = () => {
    if (!valid) return;
    const base = note ?? { ...noteCodec.read({}), id: newId(), bookId, createdAt: Date.now() };
    void mutate(saveNote({ ...base, title: title.trim(), text: text.trim(), page: page === "" ? 0 : Number(page) }));
    onClose();
  };

  return (
    <Dialog
      title={t(note ? "note_edit" : "note_add")}
      onClose={onClose}
      testId="note-dialog"
      actions={
        <>
          {note ? (
            <Button variant="text" onClick={() => setConfirming(true)}>
              {t("action_delete")}
            </Button>
          ) : null}
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button onClick={save} disabled={!valid} data-testid="note-save">
            {t("action_save")}
          </Button>
        </>
      }
    >
      <Field label={t("note_title")} value={title} onChange={(event) => setTitle(event.target.value)} data-testid="note-title" />
      <TextArea label={t("note_text")} value={text} onChange={(event) => setText(event.target.value)} rows={5} autoFocus data-testid="note-text" />
      <Field label={t("web_note_page")} inputMode="numeric" value={page} onChange={(event) => setPage(digits(event.target.value, 5))} />
      {confirming && note ? (
        <p className="row" role="alert">
          <span className="grow">{t("web_delete_note_title")}</span>
          <Button
            variant="danger"
            onClick={() => {
              void mutate(deleteNote(note.id));
              onClose();
            }}
            data-testid="confirm"
          >
            {t("action_delete")}
          </Button>
        </p>
      ) : null}
    </Dialog>
  );
}

/** The currency of the reader's region, as a sensible first guess. */
function localCurrency(locale: string): string {
  const region = /-([A-Z]{2})\b/.exec(locale)?.[1] ?? "";
  if (region === "CH" || region === "LI") return "CHF";
  if (region === "GB") return "GBP";
  if (region === "US") return "USD";
  if (["DE", "AT", "FR", "IT", "ES", "NL", "BE", "IE", "PT", "FI", "LU"].includes(region)) return "EUR";
  return "";
}

/** What was paid for the book, where and when. A book can have several entries, e.g. a second copy. */
export function PurchaseDialog({ purchase, bookId, onClose }: { purchase: Purchase | null; bookId: number; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { mutate } = useLibrary();
  const [price, setPrice] = useState(purchase && purchase.price > 0 ? purchase.price.toFixed(2) : "");
  const [currency, setCurrency] = useState(purchase ? purchase.currency : localCurrency(locale));
  const [store, setStore] = useState(purchase?.store ?? "");
  const [note, setNote] = useState(purchase?.note ?? "");
  const [day, setDay] = useState(toIsoDate(purchase?.day ?? today()));
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    const base = purchase ?? { ...purchaseCodec.read({}), id: newId(), bookId };
    const amount = Number(price.replace(",", "."));
    void mutate(
      savePurchase({
        ...base,
        price: Number.isFinite(amount) && amount > 0 ? amount : 0,
        currency: currency.trim(),
        store: store.trim(),
        note: note.trim(),
        day: fromIsoDate(day) ?? base.day ?? today(),
      }),
    );
    onClose();
  };

  return (
    <Dialog
      title={t(purchase ? "purchase_edit" : "purchase_add")}
      onClose={onClose}
      testId="purchase-dialog"
      actions={
        <>
          {purchase ? (
            <Button variant="text" onClick={() => setConfirming(true)}>
              {t("action_delete")}
            </Button>
          ) : null}
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button onClick={save} data-testid="purchase-save">
            {t("action_save")}
          </Button>
        </>
      }
    >
      <div className="field-row field-row-3">
        <Field label={t("purchase_price")} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value.replace(/[^\d.,]/g, "").slice(0, 9))} autoFocus data-testid="purchase-price" />
        <Field label={t("purchase_currency")} value={currency} onChange={(event) => setCurrency(event.target.value.slice(0, 4).toUpperCase())} data-testid="purchase-currency" />
      </div>
      <Field label={t("purchase_store")} value={store} onChange={(event) => setStore(event.target.value.slice(0, 60))} data-testid="purchase-store" />
      <Field label={t("quote_note")} value={note} onChange={(event) => setNote(event.target.value.slice(0, 120))} />
      <Field label={t("purchase_date", "").trim()} type="date" value={day} onChange={(event) => setDay(event.target.value)} />
      {confirming && purchase ? (
        <p className="row" role="alert">
          <span className="grow">{t("web_delete_entry_title")}</span>
          <Button
            variant="danger"
            onClick={() => {
              void mutate(deletePurchase(purchase.id));
              onClose();
            }}
            data-testid="confirm"
          >
            {t("action_delete")}
          </Button>
        </p>
      ) : null}
    </Dialog>
  );
}
