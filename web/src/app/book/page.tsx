"use client";

// One book: everything the app shows and edits on its detail page.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AutoSaveField } from "@/components/AutoSave";
import { BookCover } from "@/components/BookCover";
import { LogSessionDialog, NoteDialog, PurchaseDialog, QuoteDialog } from "@/components/BookDialogs";
import { useDuration, useI18n } from "@/components/i18n";
import { formatKey, ownershipKey, statusKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { LoanView } from "@/components/Loans";
import { RatingBar, SpiceBar } from "@/components/Ratings";
import { Button, Card, Chip, ConfirmDialog, Dialog, EmptyHint, Field, IconButton, IconLink, NameDialog, ProgressBar, Stat, Switch, Tabs, digits } from "@/components/ui";
import { formatDay, formatMoment, fromIsoDate, toIsoDate, today } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { formatPrice, formatRating } from "@/lib/libraryLogic";
import { awayOf, awayWords } from "@/lib/away";
import { backByHand, isOut, lentByHand, loanOf, loansAbout, ownedByHand, tyingLoan } from "@/lib/loans";
import type { Book, Note, Purchase, Quote, ReadingSession, ReadingStatus } from "@/lib/model";
import { OWNERSHIPS } from "@/lib/model";
import { createShelf, deleteBook, deleteSession, modifyBook, setOnShelf, setStatus } from "@/lib/mutations";
import { minutesLeft, pace, sessionPages, totalMinutes, totalPages } from "@/lib/readingMath";
import { isAudio, progressOf } from "@/lib/rules";
import { coverAddressOf } from "@/lib/shelf";

const STATUS_CHIPS: ReadingStatus[] = ["WISHLIST", "NONE", "READING", "READ", "ABANDONED"];

function DetailRow({ label, value }: { label: string; value: string }) {
  if (value.trim() === "") return null;
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="grow">{value}</span>
    </div>
  );
}

function Overview({ book, sessions, purchases, onLog }: { book: Book; sessions: ReadingSession[]; purchases: Purchase[]; onLog: () => void }) {
  const { t, plural, locale } = useI18n();
  const duration = useDuration();
  const { vault, prefs, mutate, loans } = useLibrary();
  const [page, setPage] = useState("");
  const [lending, setLending] = useState(false);
  // The loans between friends this book is part of. The one it carries decides who has
  // it: while the server tells of that loan, lending and borrowing by hand step aside.
  const about = loansAbout(book, loans);
  const carried = loanOf(book, loans);
  const lentByLoan = carried?.role === "lender";
  const borrowedByLoan = carried?.role === "borrower";
  const [newList, setNewList] = useState(false);
  const [purchase, setPurchase] = useState<Purchase | "new" | null>(null);
  const [expanded, setExpanded] = useState(false);

  const change = (edit: (b: Book) => Book) => void mutate(modifyBook(book.id, edit, Date.now()));
  const memberOf = new Set(vault.links.filter((l) => l.bookId === book.id).map((l) => l.shelfId));
  const progress = progressOf(book);
  const left = minutesLeft(book, sessions, prefs.minutesPerPage);
  const unit = t(isAudio(book) ? "unit_minutes" : "unit_pages");

  return (
    <div data-testid="book-overview">
      <Card title={t("book_section_list")}>
        <div className="chips">
          {STATUS_CHIPS.map((status) => (
            <Chip key={status} selected={book.status === status} onClick={() => void mutate(setStatus(book.id, status, today(), Date.now()))} data-testid={`status-${status}`}>
              {t(statusKey(status))}
            </Chip>
          ))}
        </div>
        {book.readCount > 1 ? <p className="small muted" style={{ marginTop: 6 }}>{plural("times_read", book.readCount)}</p> : null}
      </Card>

      {book.status === "READING" ? (
        <Card title={t("book_section_progress")} testId="progress-card">
          <div className="row-between" style={{ alignItems: "flex-end" }}>
            <p>
              <span className="big-number" data-testid="current-page">
                {book.currentPage}
              </span>
              {book.pageCount > 0 ? <span className="muted">{` / ${book.pageCount} ${unit}`}</span> : null}
            </p>
            {progress !== null ? <p className="strong">{Math.floor(progress * 100)} %</p> : null}
          </div>
          {progress !== null ? (
            <div style={{ marginTop: 8 }}>
              <ProgressBar value={progress} label={t("book_section_progress")} />
            </div>
          ) : null}
          {left !== null ? <p className="small muted" style={{ marginTop: 8 }}>{t("book_time_left", duration(left))}</p> : null}
          <form
            className="row"
            style={{ marginTop: 12, alignItems: "flex-end" }}
            onSubmit={(event) => {
              event.preventDefault();
              if (page === "") return;
              const wanted = Number(page);
              change((b) => ({ ...b, currentPage: b.pageCount > 0 ? Math.min(wanted, b.pageCount) : wanted }));
              setPage("");
            }}
          >
            <Field className="grow" label={t(isAudio(book) ? "field_minute_position" : "field_page")} inputMode="numeric" value={page} onChange={(event) => setPage(digits(event.target.value))} data-testid="page-field" />
            <Button type="submit" variant="outline" disabled={page === ""} data-testid="page-set">
              {t("web_page_set")}
            </Button>
          </form>
          <div style={{ marginTop: 12 }}>
            <Button wide onClick={onLog} data-testid="log-session">
              {t("session_log")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card title={t("book_section_rating")}>
        <div className="row-between">
          <RatingBar rating={book.rating} size={30} onChange={(stars) => change((b) => ({ ...b, rating: stars }))} />
          <span className="strong muted" data-testid="rating-text">
            {book.rating > 0 ? t("rating_of_five", formatRating(book.rating, locale)) : t("rating_none")}
          </span>
        </div>
        <div className="row-between" style={{ marginTop: 8 }}>
          <SpiceBar level={book.spice} size={28} onChange={(level) => change((b) => ({ ...b, spice: level }))} />
          <span className="strong muted" data-testid="spice-text">
            {t("spice_label") + (book.spice > 0 ? `  ${book.spice}/5` : "")}
          </span>
        </div>
      </Card>

      <Card title={t("book_section_review")}>
        <div className="date-fields">
          <Field label={t("book_started")} type="date" value={toIsoDate(book.startedOn)} onChange={(event) => change((b) => ({ ...b, startedOn: fromIsoDate(event.target.value) }))} data-testid="started-on" />
          <Field label={t("book_finished")} type="date" value={toIsoDate(book.finishedOn)} onChange={(event) => change((b) => ({ ...b, finishedOn: fromIsoDate(event.target.value) }))} data-testid="finished-on" />
        </div>
        <div style={{ marginTop: 12 }}>
          <AutoSaveField key={book.id} value={book.review} label={t("book_review_hint")} rows={4} onSave={(text) => change((b) => ({ ...b, review: text }))} testId="review" />
        </div>
      </Card>

      <Card title={t("book_section_ownership")}>
        <div className="chips">
          {OWNERSHIPS.map((ownership) => (
            // While the book is with me on a loan, the loan says whose it is: the next look at the server would put it back.
            <Chip key={ownership} selected={book.ownership === ownership} disabled={borrowedByLoan && carried !== undefined && isOut(carried)} onClick={() => change((b) => ownedByHand(b, ownership, carried !== undefined))} data-testid={`own-${ownership}`}>
              {t(ownershipKey(ownership))}
            </Chip>
          ))}
        </div>
        {about.length > 0 ? (
          <div data-testid="book-loans">
            {about.map((loan) => (
              <div key={loan.id} className="loan-box">
                <LoanView loan={loan} />
              </div>
            ))}
          </div>
        ) : null}
        {book.ownership === "BORROWED" && !borrowedByLoan ? (
          <div style={{ marginTop: 10 }}>
            <AutoSaveField key={book.id} value={book.borrowedFrom} label={t("book_borrowed_from")} onSave={(text) => change((b) => ({ ...b, borrowedFrom: text }))} testId="borrowed-from" />
          </div>
        ) : null}
        {book.ownership === "OWNED" && !lentByLoan ? (
          book.lentTo.trim() !== "" ? (
            <div style={{ marginTop: 8 }}>
              <p data-testid="lent-to">{t("book_lent_to", book.lentTo, formatDay(book.lentSince, locale))}</p>
              <Button variant="text" onClick={() => change(backByHand)} data-testid="returned">
                {t("book_returned")}
              </Button>
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              <Switch label={t("book_lendable")} checked={book.lendable} onChange={(allowed) => change((b) => ({ ...b, lendable: allowed }))} testId="lendable" />
              <Button variant="text" onClick={() => setLending(true)} data-testid="mark-lent">
                {t("book_mark_lent")}
              </Button>
            </div>
          )
        ) : null}
      </Card>

      <Card title={t("purchase_title")}>
        {purchases.map((entry) => {
          const head = [entry.price > 0 ? formatPrice(entry.price, entry.currency, locale) : null, entry.store.trim() !== "" ? entry.store : null].filter(Boolean).join(" · ");
          return (
            <div key={entry.id} className="entry">
              <button type="button" className="entry-button" onClick={() => setPurchase(entry)} data-testid="purchase-row">
                <span className="strong" style={{ display: "block" }}>
                  {head !== "" ? head : t("purchase_title")}
                </span>
                <span className="small muted">{[formatDay(entry.day, locale), entry.note.trim() !== "" ? entry.note : null].filter(Boolean).join(" · ")}</span>
              </button>
            </div>
          );
        })}
        <Button variant="text" onClick={() => setPurchase("new")} data-testid="add-purchase">
          {t("purchase_add")}
        </Button>
      </Card>

      <Card title={t("book_section_lists")}>
        <div className="chips">
          {vault.shelves.map((shelf) => {
            const member = memberOf.has(shelf.id);
            return (
              <Chip key={shelf.id} selected={member} onClick={() => void mutate(setOnShelf(book.id, shelf.id, !member))} data-testid={`list-chip-${shelf.id}`}>
                {shelf.name}
              </Chip>
            );
          })}
          <Chip icon="add" onClick={() => setNewList(true)} data-testid="new-list-chip">
            {t("lists_new")}
          </Chip>
        </div>
      </Card>

      <Card title={t("book_section_details")}>
        <DetailRow label={t("field_format")} value={book.format !== "UNKNOWN" ? t(formatKey(book.format)) : ""} />
        <DetailRow label={t(isAudio(book) ? "field_minutes" : "field_pages")} value={book.pageCount > 0 ? String(book.pageCount) : ""} />
        <DetailRow label={t("field_publisher")} value={book.publisher} />
        <DetailRow label={t("field_year")} value={book.publishedYear} />
        <DetailRow label={t("field_isbn")} value={book.isbn} />
        <DetailRow label={t("field_language")} value={book.language} />
        <DetailRow label={t("field_genres")} value={book.genres} />
        <DetailRow label={t("field_tags")} value={book.tags} />
      </Card>

      {book.description.trim() !== "" ? (
        <Card title={t("book_section_blurb")}>
          <p className={`blurb ${expanded ? "" : "blurb-clamped"}`}>{book.description}</p>
          {!expanded && book.description.length > 300 ? (
            <Button variant="text" onClick={() => setExpanded(true)}>
              {t("action_show_more")}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {lending ? (
        <NameDialog
          title={t("book_mark_lent")}
          label={t("web_lent_name")}
          initial=""
          onClose={() => setLending(false)}
          onSave={(name) => {
            setLending(false);
            const day = today();
            change((b) => lentByHand(b, name, day));
          }}
        />
      ) : null}
      {newList ? (
        <NameDialog
          title={t("lists_new")}
          label={t("lists_name")}
          initial=""
          onClose={() => setNewList(false)}
          onSave={(name) => {
            setNewList(false);
            const id = newId();
            void mutate(createShelf(id, name, Date.now()));
            void mutate(setOnShelf(book.id, id, true));
          }}
        />
      ) : null}
      {purchase ? <PurchaseDialog purchase={purchase === "new" ? null : purchase} bookId={book.id} onClose={() => setPurchase(null)} /> : null}
    </div>
  );
}

function Reading({ book, sessions, onLog }: { book: Book; sessions: ReadingSession[]; onLog: () => void }) {
  const { t, locale } = useI18n();
  const duration = useDuration();
  const { prefs, mutate } = useLibrary();
  const [deleting, setDeleting] = useState<ReadingSession | null>(null);
  const unit = t(isAudio(book) ? "unit_minutes" : "unit_pages");
  const newestFirst = sessions.slice().sort((a, b) => b.startedAt - a.startedAt);
  const speed = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pace(sessions, prefs.minutesPerPage));
  return (
    <div data-testid="book-reading">
      <Card title={t("session_summary")}>
        <div className="tile-grid tile-grid-3">
          <Stat value={String(totalPages(sessions))} label={unit} />
          <Stat value={duration(totalMinutes(sessions))} label={t("session_time")} />
          <Stat value={speed} label={t("session_pace")} />
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: "nowrap" }}>
          <Button className="grow" onClick={onLog} data-testid="log-session-reading">
            {t("session_log")}
          </Button>
          {/* The stopwatch is an extra for those who want it, not the main way to log reading. */}
          <IconLink href={`/book/timer?id=${book.id}`} icon="timer" label={t("timer_title")} testId="open-timer" />
        </div>
      </Card>
      {sessions.length === 0 ? <EmptyHint>{t("session_empty")}</EmptyHint> : null}
      {newestFirst.length > 0 ? (
        <Card>
          {newestFirst.map((session) => (
            <div key={session.id} className="entry" data-testid="session-row">
              <div className="entry-main">
                <div className="label-small">{formatMoment(session.startedAt, locale, true)}</div>
                <div className="strong">{t("session_range", session.startPage, session.endPage, sessionPages(session), unit)}</div>
                {session.minutes > 0 ? <div className="accent">{duration(Math.floor(session.minutes))}</div> : null}
                {session.note.trim() !== "" ? <div>{session.note}</div> : null}
              </div>
              <IconButton icon="delete" label={t("action_delete")} className="muted" onClick={() => setDeleting(session)} />
            </div>
          ))}
        </Card>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={t("web_delete_session_title")}
          confirm={t("action_delete")}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            void mutate(deleteSession(deleting.id));
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Quotes({ book, quotes }: { book: Book; quotes: Quote[] }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Quote | "new" | null>(null);
  return (
    <div data-testid="book-quotes">
      <div style={{ margin: "12px 0" }}>
        <Button icon="add" onClick={() => setEditing("new")} data-testid="add-quote">
          {t("quote_add")}
        </Button>
      </div>
      {quotes.length === 0 ? <EmptyHint>{t("quote_empty_book")}</EmptyHint> : null}
      {quotes.map((quote) => (
        <Card key={quote.id}>
          <button type="button" className="entry-button" onClick={() => setEditing(quote)} data-testid="quote-row">
            <span className="quote-text" style={{ display: "block" }}>
              {"„" + quote.text + "“"}
            </span>
            {quote.page > 0 ? <span className="label-small" style={{ display: "block", marginTop: 6 }}>{t("quote_page", quote.page)}</span> : null}
            {quote.note.trim() !== "" ? <span style={{ display: "block", marginTop: 4 }}>{quote.note}</span> : null}
          </button>
        </Card>
      ))}
      {editing ? <QuoteDialog quote={editing === "new" ? null : editing} bookId={book.id} books={[book]} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function Notes({ book, notes }: { book: Book; notes: Note[] }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  return (
    <div data-testid="book-notes">
      <div style={{ margin: "12px 0" }}>
        <Button icon="add" onClick={() => setEditing("new")} data-testid="add-note">
          {t("note_add")}
        </Button>
      </div>
      {notes.length === 0 ? <EmptyHint>{t("note_empty")}</EmptyHint> : null}
      {notes.map((note) => (
        <Card key={note.id}>
          <button type="button" className="entry-button" onClick={() => setEditing(note)} data-testid="note-row">
            {note.title.trim() !== "" ? <span className="strong" style={{ display: "block" }}>{note.title}</span> : null}
            <span style={{ display: "block", whiteSpace: "pre-line" }}>{note.text}</span>
            <span className="label-small" style={{ display: "block", marginTop: 6 }}>
              {[note.page > 0 ? t("quote_page", note.page) : null, note.createdAt > 0 ? formatMoment(note.createdAt, locale) : null].filter(Boolean).join(" · ")}
            </span>
          </button>
        </Card>
      ))}
      {editing ? <NoteDialog note={editing === "new" ? null : editing} bookId={book.id} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

export default function BookPage() {
  const { t, locale } = useI18n();
  const { vault, mutate, loans } = useLibrary();
  const router = useRouter();
  const params = useSearchParams();
  const id = Number(params.get("id"));
  const [tab, setTab] = useState("overview");
  const [logging, setLogging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const book = vault.books.find((b) => b.id === id);
  if (!book) {
    return (
      <div className="page">
        <header className="page-head">
          <IconLink href="/" icon="back" label={t("action_back")} />
        </header>
        <EmptyHint>{t("web_book_missing")}</EmptyHint>
        <Link href="/" className="btn btn-text">
          {t("web_to_shelf")}
        </Link>
      </div>
    );
  }
  const quotes = vault.quotes.filter((q) => q.bookId === book.id);
  const notes = vault.notes.filter((n) => n.bookId === book.id);
  const sessions = vault.sessions.filter((s) => s.bookId === book.id);
  const purchases = vault.purchases.filter((p) => p.bookId === book.id);
  const count = (n: number) => (n > 0 ? ` (${n})` : "");
  const favourite = book.favorite;
  // The loan that ties this book down, if there is one. It has to end before the book can go.
  const tied = tyingLoan(book, loans);
  const gone = awayOf(book);
  const awaySaid = gone ? awayWords(gone, t("friends_someone")) : null;
  const away = awaySaid ? t(awaySaid.key, awaySaid.who) : null;

  return (
    <div className="page" data-testid="book-page">
      <header className="page-head">
        <IconLink href="/" icon="back" label={t("action_back")} />
        <span className="grow" />
        <IconButton
          icon={favourite ? "heart" : "heartOutline"}
          label={t("book_favorite")}
          aria-pressed={favourite}
          style={favourite ? { color: "var(--danger-text)" } : undefined}
          onClick={() => void mutate(modifyBook(book.id, (b) => ({ ...b, favorite: !favourite }), Date.now()))}
          data-testid="favourite"
        />
        <IconLink href={`/book/edit?id=${book.id}`} icon="edit" label={t("action_edit")} />
        <IconButton icon="delete" label={t("book_delete")} onClick={() => setConfirmDelete(true)} data-testid="delete-book" />
      </header>

      <div className="book-head">
        {/* A book that is away is see-through here as on the shelf, and the page says why. */}
        <span className={away ? "cover-frame away" : "cover-frame"} data-testid="book-cover" data-away={away ?? undefined}>
          <BookCover title={book.title} authors={book.authors} url={coverAddressOf(book)} />
        </span>
        <div className="grow">
          <h1 data-testid="book-title">{book.title}</h1>
          {book.subtitle.trim() !== "" ? <p className="muted">{book.subtitle}</p> : null}
          {book.authors.trim() !== "" ? <p className="book-author">{book.authors}</p> : null}
          {away ? (
            <p className="away-words" data-testid="away-words">
              {away}
            </p>
          ) : null}
          {book.series.trim() !== "" ? <p className="small muted">{book.series + (book.seriesPosition > 0 ? ` #${formatRating(book.seriesPosition, locale)}` : "")}</p> : null}
        </div>
      </div>

      <Tabs
        label={book.title}
        current={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: t("book_tab_overview") },
          { key: "reading", label: t("book_tab_reading") },
          { key: "quotes", label: t("book_tab_quotes") + count(quotes.length) },
          { key: "notes", label: t("book_tab_notes") + count(notes.length) },
        ]}
      />
      <div role="tabpanel">
        {tab === "overview" ? <Overview book={book} sessions={sessions} purchases={purchases} onLog={() => setLogging(true)} /> : null}
        {tab === "reading" ? <Reading book={book} sessions={sessions} onLog={() => setLogging(true)} /> : null}
        {tab === "quotes" ? <Quotes book={book} quotes={quotes} /> : null}
        {tab === "notes" ? <Notes book={book} notes={notes} /> : null}
      </div>

      {logging ? <LogSessionDialog book={book} onClose={() => setLogging(false)} /> : null}
      {confirmDelete && tied ? (
        // A book that is part of a loan stays: as the borrower's copy the next look at the
        // server would bring it back, and as the lender's book the loan would point at nothing.
        <Dialog
          title={t("book_delete_title")}
          onClose={() => setConfirmDelete(false)}
          testId="book-in-loan"
          actions={
            <>
              <Link href="/friends/loans" className="btn btn-text" data-testid="to-loans">
                {t("loans_title")}
              </Link>
              <Button onClick={() => setConfirmDelete(false)}>{t("action_ok")}</Button>
            </>
          }
        >
          <p>{t("book_delete_loan")}</p>
        </Dialog>
      ) : null}
      {confirmDelete && !tied ? (
        <ConfirmDialog
          title={t("book_delete_title")}
          text={t("book_delete_text", book.title)}
          confirm={t("action_delete")}
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void mutate(deleteBook(book.id));
            router.push("/");
          }}
        />
      ) : null}
    </div>
  );
}
