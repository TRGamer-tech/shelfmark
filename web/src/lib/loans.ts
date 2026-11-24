// Loans between friends, as supabase/README.md has them under "Loans".
//
// A loan is one record on the server that lender and borrower both read. Neither keeps
// a copy: what the website shows is what the last look at the server said. Only the
// books follow: a book that is out carries the name of whoever has it, and a book that
// came in stands on the borrower's own shelf. That part is kept in the library, and
// the Android app does exactly the same, so that both arrive at the same library.

import { normalise } from "./catalogue/remoteBook.ts";
import type { Zone } from "./dates.ts";
import { dayOf } from "./dates.ts";
import type { Book, BookFormat, Ownership, SharedBook, Vault } from "./model.ts";
import { newBook } from "./model.ts";

/**
 * - asked: the borrower asked.
 * - agreed: the lender said yes. The book is reserved.
 * - handed: the lender says the book was handed over.
 * - on_loan: the borrower confirmed having it.
 * - given_back: the borrower says the book was given back.
 * - returned: the lender confirmed having it back. The end.
 * - declined, withdrawn, cancelled: the lender said no, the borrower took the question
 *   back, the lender took the yes back. The end as well.
 */
export const LOAN_STATES = ["asked", "agreed", "handed", "on_loan", "given_back", "returned", "declined", "withdrawn", "cancelled"] as const;
export type LoanState = (typeof LOAN_STATES)[number];
export type LoanRole = "lender" | "borrower";

/** The steps of shelfmark_loan_act. Who may take which, and from where, is in [actionsFor]. */
export type LoanAction =
  | "agree"
  | "decline"
  | "cancel"
  | "hand"
  | "undo_hand"
  | "take_back"
  | "not_returned"
  | "close"
  | "set_due"
  | "withdraw"
  | "receive"
  | "not_received"
  | "give_back"
  | "undo_give_back"
  | "hide";

/** What the borrower saw of the book when asking. */
export interface LoanBook {
  title: string;
  authors: string;
  isbn: string;
  coverUrl: string;
  pageCount: number;
  format: BookFormat;
}

export interface Loan {
  id: string;
  /** Which side the reader is on. */
  role: LoanRole;
  /** The other person: their user id and the name they gave themselves. */
  peer: string;
  peerName: string;
  /** The id of the book in the lender's library. */
  bookId: number;
  book: LoanBook;
  note: string;
  state: LoanState;
  /** Why it was declined or cancelled. "taken" when somebody else got the book. */
  reason: string;
  /** Wanted back by this day (days since 1970), or null for no fixed date. */
  dueOn: number | null;
  askedAt: number;
  agreedAt: number | null;
  handedAt: number | null;
  receivedAt: number | null;
  givenBackAt: number | null;
  closedAt: number | null;
  updatedAt: number;
  /** Whether the last step was the reader's own. */
  byMe: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const moment = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Reads one loan as the server hands it out. Null for something that is not one, or is in a state this website does not know. */
export function readLoan(raw: unknown): Loan | null {
  if (!isObject(raw)) return null;
  const id = text(raw.id);
  const role = raw.role;
  const state = raw.state as LoanState;
  if (id === "" || (role !== "lender" && role !== "borrower") || !LOAN_STATES.includes(state)) return null;
  const book = isObject(raw.book) ? raw.book : {};
  return {
    id,
    role,
    peer: text(raw.peer),
    peerName: text(raw.peerName),
    bookId: number(raw.bookId),
    book: {
      title: text(book.title),
      authors: text(book.authors),
      isbn: text(book.isbn),
      coverUrl: text(book.coverUrl),
      pageCount: number(book.pageCount),
      format: (text(book.format) || "UNKNOWN") as BookFormat,
    },
    note: text(raw.note),
    state,
    reason: text(raw.reason),
    dueOn: moment(raw.dueOn),
    askedAt: number(raw.askedAt),
    agreedAt: moment(raw.agreedAt),
    handedAt: moment(raw.handedAt),
    receivedAt: moment(raw.receivedAt),
    givenBackAt: moment(raw.givenBackAt),
    closedAt: moment(raw.closedAt),
    updatedAt: number(raw.updatedAt),
    byMe: raw.byMe === true,
  };
}

/** The loans of an answer of shelfmark_sync. A server from before the loans has none. */
export function readLoans(raw: unknown): Loan[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readLoan).filter((loan): loan is Loan => loan !== null);
}

// ---- where a loan stands ----

/** The book is in the borrower's hands. */
export function isOut(loan: Loan): boolean {
  return loan.state === "on_loan" || loan.state === "given_back";
}

/** The book is reserved for the borrower or in their hands: nobody else can have it now. */
export function holdsBook(loan: Loan): boolean {
  return loan.state === "agreed" || loan.state === "handed" || isOut(loan);
}

/** The loan has come to its end, one way or another. */
export function isOver(loan: Loan): boolean {
  return loan.state === "returned" || loan.state === "declined" || loan.state === "withdrawn" || loan.state === "cancelled";
}

/**
 * The steps the reader may take from where the loan stands, in the order of the buttons,
 * which is the order the Android app has them in (LoanRules.actions). Handing over takes
 * the lender first and then the borrower, giving back the borrower first and then the
 * lender. A loan that is over can only be put away.
 */
export function actionsFor(loan: Loan): LoanAction[] {
  if (isOver(loan)) return ["hide"];
  if (loan.role === "lender") {
    switch (loan.state) {
      case "asked":
        return ["agree", "decline"];
      case "agreed":
        return ["hand", "set_due", "cancel"];
      case "handed":
        return ["undo_hand", "set_due", "cancel"];
      case "on_loan":
        return ["close", "set_due"];
      case "given_back":
        return ["take_back", "not_returned", "set_due"];
      default:
        return [];
    }
  }
  switch (loan.state) {
    case "asked":
    case "agreed":
      return ["withdraw"];
    case "handed":
      return ["receive", "not_received"];
    case "on_loan":
      return ["give_back"];
    case "given_back":
      return ["undo_give_back"];
    default:
      return [];
  }
}

/** The loan waits for the reader's own word: a question to answer, or a hand-over or return to confirm. */
export function waitsForMe(loan: Loan): boolean {
  return loan.role === "lender" ? loan.state === "asked" || loan.state === "given_back" : loan.state === "handed";
}

export function waitingCount(loans: Loan[]): number {
  return loans.filter(waitsForMe).length;
}

/** The book is out and the day it was wanted back by has come. */
export function isDue(loan: Loan, today: number): boolean {
  return isOut(loan) && loan.dueOn !== null && loan.dueOn <= today;
}

export type LoanSection = "todo" | "open" | "lent" | "borrowed" | "past";
export const LOAN_SECTIONS: LoanSection[] = ["todo", "open", "lent", "borrowed", "past"];

/** Where a loan is listed: what waits for the reader first, what is over last. */
export function sectionOf(loan: Loan): LoanSection {
  if (isOver(loan)) return "past";
  if (waitsForMe(loan)) return "todo";
  if (isOut(loan)) return loan.role === "lender" ? "lent" : "borrowed";
  return "open";
}

/**
 * The name of the text that says how the loan stands, as the reader's side sees it,
 * and the moment the text names, if it names one.
 */
export function standingOf(loan: Loan): { key: string; moment: number | null } {
  const side = loan.role === "lender" ? "l" : "b";
  if (loan.state === "declined" && loan.reason === "taken") return { key: `loan_${side}_taken`, moment: null };
  const key = `loan_${side}_${loan.state}`;
  if (loan.state === "on_loan") return { key, moment: loan.receivedAt };
  if (loan.state === "returned") return { key, moment: loan.role === "borrower" ? (loan.givenBackAt ?? loan.closedAt) : loan.closedAt };
  if (loan.state === "asked" && loan.role === "borrower") return { key, moment: loan.askedAt };
  return { key, moment: null };
}

/**
 * What a borrower is told about the two moments both sides confirm, where it is not
 * obvious who says so first: how the handover goes, while the book is reserved, and how
 * the return goes, while the book is with them. At no other time, and never to the
 * lender. The Android app shows the same two hints in the same two states.
 */
export function hintOf(loan: Loan): "loan_handover_hint" | "loan_return_hint" | null {
  if (loan.role !== "borrower") return null;
  return loan.state === "agreed" ? "loan_handover_hint" : loan.state === "on_loan" ? "loan_return_hint" : null;
}

/** The reason a lender gave in their own words. "taken" is no such reason: it has a sentence of its own. */
export function givenReason(loan: Loan): string {
  const said = loan.reason.trim();
  return (loan.state === "declined" || loan.state === "cancelled") && said !== "" && said !== "taken" ? said : "";
}

export type DueLine = { key: "loan_due_by" | "loan_due_over"; day: number; late: boolean } | { key: "loan_due_open" | "loan_due_today"; day: null; late: boolean } | null;

/**
 * What to say about the day the book is wanted back by. Null while that is no question,
 * before the yes and after the end. Late, and written in the warning colour, is a book
 * whose day has passed: on the day itself it is due, not late.
 */
export function dueLine(loan: Loan, today: number): DueLine {
  if (!holdsBook(loan)) return null;
  if (loan.dueOn === null) return { key: "loan_due_open", day: null, late: false };
  if (isOut(loan) && loan.dueOn === today) return { key: "loan_due_today", day: null, late: false };
  if (isOut(loan) && loan.dueOn < today) return { key: "loan_due_over", day: loan.dueOn, late: true };
  return { key: "loan_due_by", day: loan.dueOn, late: false };
}

/** The books of mine that are reserved for a friend or in a friend's hands. They are not available to anybody else. */
export function heldBookIds(loans: Loan[]): Set<number> {
  return new Set(loans.filter((loan) => loan.role === "lender" && holdsBook(loan)).map((loan) => loan.bookId));
}

// ---- news ----

/** What this browser last saw of a loan. */
export interface Seen {
  at: number;
  state: LoanState;
  dueOn: number | null;
}

export type SeenLoans = Record<string, Seen>;

/**
 * What a browser remembers of the loans: how each stood, and the server's time of the
 * answer that said so. All windows of a browser share it, so that a step is told once
 * in that browser and not once in every window.
 */
export interface LoanMemory {
  time: number;
  loans: SeenLoans;
}

export function seenOf(loans: Loan[]): SeenLoans {
  const seen: SeenLoans = {};
  for (const loan of loans) seen[loan.id] = { at: loan.updatedAt, state: loan.state, dueOn: loan.dueOn };
  return seen;
}

/**
 * Reads what the browser remembered. Null when it remembered nothing that can be read.
 * What was written before the time was kept with it is read as "seen at the beginning
 * of time": every answer is newer than that.
 */
export function readSeen(remembered: string | null): LoanMemory | null {
  if (remembered === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(remembered);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const dated = isObject(raw.loans) && typeof raw.time === "number";
  const source = dated ? (raw.loans as Record<string, unknown>) : raw;
  const loans: SeenLoans = {};
  for (const [id, entry] of Object.entries(source)) {
    if (!isObject(entry) || typeof entry.at !== "number" || !LOAN_STATES.includes(entry.state as LoanState)) continue;
    loans[id] = { at: entry.at, state: entry.state as LoanState, dueOn: moment(entry.dueOn) };
  }
  return { time: dated ? (raw.time as number) : 0, loans };
}

/**
 * News is a loan the other side did something to since this browser last looked: it
 * changed after what was seen of it, and the last step was not the reader's own.
 * A browser that never looked before ([seen] is null) has no news: everything it finds
 * is simply how things stand.
 */
export function newsOf(loans: Loan[], seen: SeenLoans | null): Loan[] {
  if (seen === null) return [];
  return loans.filter((loan) => !loan.byMe && loan.updatedAt > (seen[loan.id]?.at ?? 0));
}

/** What a look at the loans gives the page to say, and to take back. */
export interface LoanNotices {
  /** The other side's step, with the name of its sentence. At most one per loan. */
  say: { loan: Loan; key: string }[];
  /**
   * The loans about which whatever was said before holds no longer: the reader took a
   * step of their own, the other side took a tap back, or the loan is gone. A notice
   * about one of these that still stands on the page is taken away.
   */
  unsay: string[];
}

/**
 * Compares the loans with what the browser saw of them. Every loan that changed since
 * is either told (the other side's step, if there are words for it) or untold (anything
 * else): never both, and a loan that did not change is neither. So a step is announced
 * when it is first seen and at no later look, and a notice does not outlive the reader's
 * own answer to it. The Android app does the same with its notifications: one per loan,
 * replaced by the next step, taken back when a tap was (work/Notifier.kt).
 */
export function loanNotices(loans: Loan[], seen: SeenLoans | null): LoanNotices {
  const notices: LoanNotices = { say: [], unsay: [] };
  if (seen === null) return notices;
  const listed = new Set<string>();
  for (const loan of loans) {
    listed.add(loan.id);
    const before = seen[loan.id];
    if (loan.updatedAt <= (before?.at ?? 0)) continue;
    const key = loan.byMe ? null : newsKey(loan, before);
    if (key) notices.say.push({ loan, key });
    else notices.unsay.push(loan.id);
  }
  for (const id of Object.keys(seen)) if (!listed.has(id)) notices.unsay.push(id);
  return notices;
}

/** What follows from an answer about the loans: what to say, and what the browser remembers from now on. */
export interface LoanLook {
  notices: LoanNotices;
  memory: LoanMemory;
  /** The answer is older than what the browser has seen already. Nothing follows from it. */
  late: boolean;
}

/**
 * Takes an answer about the loans, given at the server's [time], against what the
 * browser remembers. Three cases:
 *
 * - The browser remembers nothing: this is the first look after signing in. It tells
 *   no news, everything it finds is simply how things stand.
 * - The answer is older than what was seen already. That happens when two looks race,
 *   in one window or in two, and the one that asked first is answered last. Nothing is
 *   said and nothing is remembered from it: remembering it would make the news that
 *   was told in between new again at the next look.
 * - Otherwise what changed is told, and the answer is what the browser has seen now.
 *
 * A [time] of zero, from a server that does not say when it answered, counts as now.
 */
export function takeLoanAnswer(memory: LoanMemory | null, loans: Loan[], time: number): LoanLook {
  const none: LoanNotices = { say: [], unsay: [] };
  if (memory === null) return { notices: none, memory: { time, loans: seenOf(loans) }, late: false };
  if (time > 0 && time < memory.time) return { notices: none, memory, late: true };
  return { notices: loanNotices(loans, memory.loans), memory: { time: Math.max(time, memory.time), loans: seenOf(loans) }, late: false };
}

/**
 * The reader took a step themselves, and the server answered with the loan as it stands
 * now. That is an answer about this one loan and says nothing about the others: only
 * what is remembered of this one changes, so that news about another loan, which a
 * second window may have seen in the meantime, stays told. [gone] is a loan that was
 * put away. The time moves on to the step, which makes a look that asked before it,
 * in any window, late. A browser that remembers nothing goes on remembering nothing:
 * its first look is still to come.
 */
export function rememberStep(memory: LoanMemory | null, loan: Loan, gone: boolean): LoanMemory | null {
  if (memory === null) return null;
  const loans = { ...memory.loans };
  if (gone) delete loans[loan.id];
  else loans[loan.id] = { at: loan.updatedAt, state: loan.state, dueOn: loan.dueOn };
  return { time: Math.max(memory.time, loan.updatedAt), loans };
}

/**
 * The name of the sentence that tells the reader what the other side did, or null when
 * there is nothing new to say (a tap taken back, for instance). The server keeps no
 * history, so a step is told by the state it leads to. Where two steps lead to the same
 * state, what this browser saw of the loan [before] decides. The Android app tells its
 * notifications apart by the same rules (LoanRules.news).
 */
export function newsKey(loan: Loan, before: Seen | undefined): string | null {
  const dueMoved = before !== undefined && before.dueOn !== loan.dueOn;
  if (loan.role === "lender") {
    switch (loan.state) {
      case "asked":
        return "notify_loan_asked";
      case "withdrawn":
        // A question this browser never showed is not missed when it is gone.
        return before === undefined ? null : "notify_loan_withdrawn";
      case "agreed":
        // The only way back to "reserved" that the borrower has: the book did not arrive.
        return "notify_loan_not_received";
      case "on_loan":
        // Seen as out before: the borrower took "I gave it back" back, and nothing is new.
        return before && (before.state === "on_loan" || before.state === "given_back") ? null : "notify_loan_on_loan";
      case "given_back":
        return "notify_loan_given_back";
      default:
        return null;
    }
  }
  switch (loan.state) {
    case "agreed":
      if (before === undefined || before.state === "asked") return "notify_loan_agreed";
      // Otherwise it is another day, or "handed over" taken back, which needs no words.
      return dueMoved ? "notify_loan_due_changed" : null;
    case "handed":
      return before?.state === "handed" && dueMoved ? "notify_loan_due_changed" : "notify_loan_handed";
    case "on_loan":
      // Another day, or "I did not get it back"? Without having seen the loan before there is no telling.
      if (before === undefined) return null;
      return before.state !== "given_back" && dueMoved ? "notify_loan_due_changed" : "notify_loan_not_returned";
    case "given_back":
      return dueMoved ? "notify_loan_due_changed" : null;
    case "returned":
      return "notify_loan_returned";
    case "declined":
      return loan.reason === "taken" ? "notify_loan_taken" : "notify_loan_declined";
    case "cancelled":
      return "notify_loan_cancelled";
    default:
      // What is left is the reader's own doing: asking, and taking the question back, also
      // by ending the friendship. A friend who ends it answers my question with a no,
      // and that is told above like any other no.
      return null;
  }
}

// ---- the books follow the loans ----

/**
 * The id of the copy a borrower gets of a book on loan: the first 13 hexadecimal digits
 * of the loan's id, dashes left out, read as a number. Zero becomes one. Two devices of
 * one account that both see the loan make the same book, so the library has it once.
 */
export function loanBookId(loanId: string): number {
  const digits = loanId.replace(/[^0-9a-fA-F]/g, "").slice(0, 13);
  const id = digits === "" ? 0 : Number.parseInt(digits, 16);
  return id === 0 ? 1 : id;
}

/** The same book: the same ISBN, or the same title and first author. The rule the import of lists uses as well. */
export function sameAsLoaned(wanted: LoanBook, book: Book): boolean {
  if (wanted.isbn.trim() !== "" && wanted.isbn === book.isbn) return true;
  const first = (authors: string) => normalise(authors.split(",", 1)[0] ?? "");
  return normalise(wanted.title) === normalise(book.title) && first(wanted.authors) === first(book.authors);
}

/** The other person's name as a book carries it. Never empty: an empty name on a book means "at home". */
export function nameOnBook(loan: Loan): string {
  return loan.peerName.trim() !== "" ? loan.peerName : "?";
}

/** Looks a book up in what a friend shares, to learn more about it than the loan says. */
export type FriendBooks = (peer: string, bookId: number) => SharedBook | undefined;

/**
 * Brings the library in line with the loans. Applied after every look at the server,
 * and applying it twice changes nothing:
 *
 * - I am the lender and the book is out: my book carries the borrower's name, the day
 *   they got it, and the loan.
 * - I am the lender and the loan stands anywhere else: the book that carried the loan
 *   is at home again.
 * - I am the borrower and the book is out: my copy of it is borrowed from the lender.
 *   My copy is the book that carries the loan, else the book with the loan's own id,
 *   else a book of mine that is the same one and not mine (a wish, for instance). With
 *   none of those, a copy is added.
 * - I am the borrower and the book is back with the lender: my copy, if it still says
 *   "borrowed", says "not mine" from now on. It keeps what was noted in it.
 *
 * The loans are taken in the order the server lists them, and where several books fit,
 * the one with the lowest id is "the book": the same on every device, as in the app
 * (LoanBooks.follow). A friend who never gave themselves a name is written as "?": an
 * empty name on a book would mean that it is at home.
 */
export function followLoans(loans: Loan[], friendBooks: FriendBooks, zone: Zone, now: number): (vault: Vault) => Vault {
  return (vault) => {
    let books = vault.books;
    const change = (fits: (book: Book) => boolean, patch: Partial<Book>) => {
      books = books.map((book) => (fits(book) ? { ...book, ...patch, updatedAt: now } : book));
    };
    // The first book that fits, going by id.
    const first = (fits: (book: Book) => boolean) => books.filter(fits).reduce<Book | undefined>((lowest, book) => (lowest === undefined || book.id < lowest.id ? book : lowest), undefined);
    for (const loan of loans) {
      const who = nameOnBook(loan);
      if (loan.role === "lender") {
        if (isOut(loan)) {
          const mine = books.find((book) => book.id === loan.bookId);
          if (mine && mine.loanId !== loan.id) change((book) => book.id === mine.id, { lentTo: who, lentSince: dayOf(loan.receivedAt ?? now, zone), loanId: loan.id });
        } else if (books.some((book) => book.loanId === loan.id)) {
          change((book) => book.loanId === loan.id, { lentTo: "", lentSince: null, loanId: "" });
        }
      } else if (isOut(loan)) {
        const copy = first((book) => book.loanId === loan.id) ?? books.find((book) => book.id === loanBookId(loan.id)) ?? first((book) => book.ownership === "NOT_OWNED" && sameAsLoaned(loan.book, book));
        if (!copy) {
          books = [...books, borrowedCopy(loan, friendBooks(loan.peer, loan.bookId), now)];
        } else if (copy.ownership !== "BORROWED" || copy.borrowedFrom !== who || copy.loanId !== loan.id) {
          change((book) => book.id === copy.id, { ownership: "BORROWED", borrowedFrom: who, loanId: loan.id });
        }
      } else if (loan.state === "returned") {
        // A copy the reader marked as their own in the meantime is left alone.
        const borrowedByIt = (book: Book) => book.loanId === loan.id && book.ownership === "BORROWED";
        if (books.some(borrowedByIt)) change(borrowedByIt, { ownership: "NOT_OWNED" });
      }
    }
    return books === vault.books ? vault : { ...vault, books };
  };
}

/**
 * The copy a borrower gets: what the loan says about the book, and the blurb if the
 * friend's shelf has one. It is stamped with the moment the book was received, not with
 * the moment of writing: a second device that makes this book makes the very same one.
 */
function borrowedCopy(loan: Loan, shared: SharedBook | undefined, now: number): Book {
  return newBook({
    id: loanBookId(loan.id),
    title: loan.book.title,
    authors: loan.book.authors,
    isbn: loan.book.isbn,
    coverUrl: loan.book.coverUrl,
    pageCount: loan.book.pageCount,
    format: loan.book.format,
    description: shared?.description ?? "",
    status: "NONE",
    ownership: "BORROWED",
    borrowedFrom: nameOnBook(loan),
    loanId: loan.id,
    addedAt: loan.receivedAt ?? now,
    updatedAt: loan.receivedAt ?? now,
  });
}

/** The loan a book of mine carries, if the server still tells of it. Without one the book is lent or borrowed by hand. */
export function loanOf(book: Book, loans: Loan[]): Loan | undefined {
  return book.loanId === "" ? undefined : loans.find((loan) => loan.id === book.loanId);
}

/**
 * What belongs on the page of a book of mine: as its lender every question that is
 * still open and the loan that has it reserved or out, as its borrower the loan it
 * came in by. The loan the book carries comes first.
 */
export function loansAbout(book: Book, loans: Loan[]): Loan[] {
  const carried = loanOf(book, loans);
  const asLender = loans.filter((loan) => loan.role === "lender" && loan.bookId === book.id && !isOver(loan) && loan.id !== carried?.id);
  return carried ? [carried, ...asLender] : asLender;
}

/** My own loans of one book of a friend's: the one that is still running, or else the last one that ended. */
export function myLoanOf(loans: Loan[], friendId: string, bookId: number): { open: Loan | undefined; last: Loan | undefined } {
  const mine = loans.filter((loan) => loan.role === "borrower" && loan.peer === friendId && loan.bookId === bookId);
  return { open: mine.find((loan) => !isOver(loan)), last: mine.find(isOver) };
}


// ---- by hand ----

/**
 * The loan that ties a book of mine down: one the server tells of and that is not over,
 * which the book carries, or which is about this book of mine as its lender (a question,
 * a reservation, the book being out). Such a book cannot be deleted: as the borrower's
 * copy the next look at the server would bring it back, and as the lender's book the
 * loan would point at nothing. The loan is ended first.
 */
export function tyingLoan(book: Book, loans: Loan[]): Loan | undefined {
  return loans.find((loan) => !isOver(loan) && (loan.id === book.loanId || (loan.role === "lender" && loan.bookId === book.id)));
}

/**
 * "Got it back", said by hand about a book no known loan has: nobody has it any more,
 * and whatever loan it once carried is forgotten with that.
 */
export function backByHand(book: Book): Book {
  return { ...book, lentTo: "", lentSince: null, loanId: "" };
}

/** Lent by hand, to somebody without Shelfmark for instance. A loan the book carried before is forgotten. */
export function lentByHand(book: Book, to: string, since: number): Book {
  return { ...book, lentTo: to, lentSince: since, loanId: "" };
}

/**
 * Another ownership, chosen by hand. On a book whose loan the server no longer tells of
 * ([known] is false), that ends the loan by hand, and the book forgets it.
 */
export function ownedByHand(book: Book, ownership: Ownership, known: boolean): Book {
  if (ownership === book.ownership) return book;
  return known ? { ...book, ownership } : { ...book, ownership, loanId: "" };
}
