// Every change to the library, as a function from one document to the next.
//
// A change may be applied more than once: when somebody else saved in the meantime, the
// website fetches the fresh document and applies the same change again. So a change
// never carries a whole copy of the library, only what the reader did ("set the review
// of book 5 to this text"), and adding something that is already there replaces it.
// Ids and times are made before the change is built, never inside it.

import type { Book, CustomTheme, Goal, LendRequest, Note, Ornament, OrnamentKind, Purchase, Quote, ReadingSession, ReadingStatus, Shelf, Vault, VaultPrefs } from "./model.ts";
import { CUSTOM_THEME_PREFIX, THEME_SYSTEM, emptyVault, prefsOf } from "./model.ts";
import type { ImportIds, ImportPlan } from "./csvImport.ts";
import { applyImport } from "./csvImport.ts";
import { withStatus } from "./rules.ts";

export type Change = (vault: Vault) => Vault;

function upsert<T extends { id: number | string }>(items: T[], item: T): T[] {
  return items.some((existing) => existing.id === item.id) ? items.map((existing) => (existing.id === item.id ? item : existing)) : [...items, item];
}

// ---- books ----

export function addBook(book: Book, shelfIds: number[], now: number): Change {
  return (vault) => {
    const added: Book = { ...book, addedAt: now, updatedAt: now };
    const known = new Set(vault.shelves.map((s) => s.id));
    const links = vault.links.filter((l) => l.bookId !== book.id);
    for (const shelfId of shelfIds) if (known.has(shelfId)) links.push({ bookId: book.id, shelfId });
    return { ...vault, books: upsert(vault.books, added), links };
  };
}

/** Applies [change] to the stored book, so edits made in quick succession each start from the latest state. */
export function modifyBook(bookId: number, change: (book: Book) => Book, now: number): Change {
  return (vault) => {
    if (!vault.books.some((b) => b.id === bookId)) return vault;
    return { ...vault, books: vault.books.map((b) => (b.id === bookId ? { ...change(b), id: b.id, updatedAt: now } : b)) };
  };
}

/**
 * A book with another cover, or with none when [url] is empty. The name of the photo on
 * the phone that took the old cover goes with it: that phone still has the file, would
 * go on showing it, and would upload it again over the new address.
 */
export function withCover(book: Book, url: string): Book {
  return { ...book, coverUrl: url.trim(), coverPath: "" };
}

/** What the edit form shows and writes. The cover is not among it, see [editBook]. */
export type BookFields = Pick<
  Book,
  "title" | "subtitle" | "authors" | "isbn" | "publisher" | "publishedYear" | "language" | "pageCount" | "format" | "description" | "genres" | "tags" | "series" | "seriesPosition"
>;

/**
 * Saves the edit form. Only what the form shows is written, so stars or a status given
 * meanwhile elsewhere are kept. The cover is only touched when the reader chose another
 * one ([cover] is its address, "" for none, null for "left as it was"): a photo a phone
 * took in the meantime must survive somebody correcting the title here.
 */
export function editBook(bookId: number, fields: BookFields, cover: string | null, now: number): Change {
  return modifyBook(bookId, (stored) => (cover === null ? { ...stored, ...fields } : withCover({ ...stored, ...fields }, cover)), now);
}

/** Gives a book the cover that was looked up for it, unless it got one in the meantime. */
export function fillCover(bookId: number, url: string, now: number): Change {
  return fillCovers([{ bookId, url }], now);
}

/** The same for several books at once, as one change. Books that have a cover or a photo by now are left alone. */
export function fillCovers(found: { bookId: number; url: string }[], now: number): Change {
  return (vault) => {
    const urls = new Map(found.map((cover) => [cover.bookId, cover.url]));
    let changed = false;
    const books = vault.books.map((book) => {
      const url = urls.get(book.id);
      if (!url || book.coverUrl.trim() !== "" || book.coverPath.trim() !== "") return book;
      changed = true;
      return { ...withCover(book, url), updatedAt: now };
    });
    return changed ? { ...vault, books } : vault;
  };
}

/** Books that have neither a cover with an address nor a photo on a phone. */
export function booksWithoutCover(vault: Vault): Book[] {
  return vault.books.filter((book) => book.coverUrl.trim() === "" && book.coverPath.trim() === "");
}

/**
 * Brings in a list of books from another app, as one change and so as one save. The ids
 * are made beforehand: applied again to a fresh document, it adds nothing twice.
 */
export function importBooks(plan: ImportPlan, ids: ImportIds, now: number): Change {
  return (vault) => applyImport(vault, plan, ids, now).vault;
}

export function setStatus(bookId: number, status: ReadingStatus, today: number, now: number): Change {
  return modifyBook(bookId, (book) => withStatus(book, status, today), now);
}

/** Deleting a book takes its quotes, sessions, notes, purchases and list memberships with it. */
export function deleteBook(bookId: number): Change {
  return (vault) => ({
    ...vault,
    books: vault.books.filter((b) => b.id !== bookId),
    links: vault.links.filter((l) => l.bookId !== bookId),
    quotes: vault.quotes.filter((q) => q.bookId !== bookId),
    sessions: vault.sessions.filter((s) => s.bookId !== bookId),
    notes: vault.notes.filter((n) => n.bookId !== bookId),
    purchases: vault.purchases.filter((p) => p.bookId !== bookId),
  });
}

// ---- lists ----

export function createShelf(id: number, name: string, now: number): Change {
  return (vault) => {
    if (vault.shelves.some((s) => s.id === id)) return vault;
    const position = vault.shelves.reduce((max, s) => Math.max(max, s.position), -1) + 1;
    const shelf: Shelf = { id, name: name.trim(), position, createdAt: now };
    return { ...vault, shelves: [...vault.shelves, shelf] };
  };
}

export function renameShelf(id: number, name: string): Change {
  return (vault) => ({ ...vault, shelves: vault.shelves.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)) });
}

/** The books stay in the library, only the list, its memberships and what stood on its shelf go. */
export function deleteShelf(id: number): Change {
  return (vault) => ({
    ...vault,
    shelves: vault.shelves.filter((s) => s.id !== id),
    links: vault.links.filter((l) => l.shelfId !== id),
    ornaments: vault.ornaments.filter((o) => o.shelfKey !== `list_${id}`),
  });
}

export function setOnShelf(bookId: number, shelfId: number, member: boolean): Change {
  return (vault) => {
    const without = vault.links.filter((l) => !(l.bookId === bookId && l.shelfId === shelfId));
    if (!member) return { ...vault, links: without };
    if (!vault.books.some((b) => b.id === bookId) || !vault.shelves.some((s) => s.id === shelfId)) return vault;
    return { ...vault, links: [...without, { bookId, shelfId }] };
  };
}

// ---- quotes, notes, purchases, goals ----

export function saveQuote(quote: Quote): Change {
  return (vault) => (vault.books.some((b) => b.id === quote.bookId) ? { ...vault, quotes: upsert(vault.quotes, quote) } : vault);
}

export function deleteQuote(id: number): Change {
  return (vault) => ({ ...vault, quotes: vault.quotes.filter((q) => q.id !== id) });
}

export function saveNote(note: Note): Change {
  return (vault) => (vault.books.some((b) => b.id === note.bookId) ? { ...vault, notes: upsert(vault.notes, note) } : vault);
}

export function deleteNote(id: number): Change {
  return (vault) => ({ ...vault, notes: vault.notes.filter((n) => n.id !== id) });
}

export function savePurchase(purchase: Purchase): Change {
  return (vault) => (vault.books.some((b) => b.id === purchase.bookId) ? { ...vault, purchases: upsert(vault.purchases, purchase) } : vault);
}

export function deletePurchase(id: number): Change {
  return (vault) => ({ ...vault, purchases: vault.purchases.filter((p) => p.id !== id) });
}

export function saveGoal(goal: Goal): Change {
  return (vault) => ({ ...vault, goals: upsert(vault.goals, goal) });
}

export function deleteGoal(id: number): Change {
  return (vault) => ({ ...vault, goals: vault.goals.filter((g) => g.id !== id) });
}

// ---- reading sessions ----

/**
 * Logs a reading session and moves the book along with it: the bookmark advances, an
 * unstarted book counts as being read, and reaching the last page finishes it.
 */
export function logSession(session: ReadingSession, today: number, now: number): Change {
  return (vault) => {
    const book = vault.books.find((b) => b.id === session.bookId);
    if (!book) return vault;
    // Applied a second time (after somebody else saved in between) the session is already there.
    const repeated = vault.sessions.some((s) => s.id === session.id);
    let updated = book;
    if (book.status !== "READING" && book.status !== "READ") updated = withStatus(updated, "READING", today);
    updated = { ...updated, currentPage: Math.max(updated.currentPage, session.endPage) };
    if (updated.pageCount > 0 && session.endPage >= updated.pageCount && updated.status === "READING") {
      updated = withStatus(updated, "READ", today);
    }
    return {
      ...vault,
      sessions: repeated ? vault.sessions : [...vault.sessions, session],
      books: vault.books.map((b) => (b.id === book.id ? { ...updated, updatedAt: now } : b)),
    };
  };
}

export function deleteSession(id: number): Change {
  return (vault) => ({ ...vault, sessions: vault.sessions.filter((s) => s.id !== id) });
}

// ---- ornaments ----

export function addOrnament(id: number, shelfKey: string, kind: OrnamentKind, position: number): Change {
  return (vault) => {
    const ornament: Ornament = { id, shelfKey, kind, position: Math.max(0, position) };
    return { ...vault, ornaments: upsert(vault.ornaments, ornament) };
  };
}

export function moveOrnament(id: number, position: number): Change {
  return (vault) => ({ ...vault, ornaments: vault.ornaments.map((o) => (o.id === id ? { ...o, position: Math.max(0, position) } : o)) });
}

export function deleteOrnament(id: number): Change {
  return (vault) => ({ ...vault, ornaments: vault.ornaments.filter((o) => o.id !== id) });
}

// ---- settings ----

export function setPrefs(patch: Partial<VaultPrefs>): Change {
  return (vault) => ({ ...vault, prefs: { ...prefsOf(vault), ...patch } });
}

/** Adds the theme, or replaces the one with the same id. */
export function saveCustomTheme(theme: CustomTheme): Change {
  return (vault) => {
    const prefs = prefsOf(vault);
    return { ...vault, prefs: { ...prefs, customThemes: [...prefs.customThemes.filter((t) => t.id !== theme.id), theme] } };
  };
}

export function deleteCustomTheme(id: string): Change {
  return (vault) => {
    const prefs = prefsOf(vault);
    return {
      ...vault,
      prefs: {
        ...prefs,
        customThemes: prefs.customThemes.filter((t) => t.id !== id),
        // A theme that is gone cannot stay selected.
        theme: prefs.theme === CUSTOM_THEME_PREFIX + id ? THEME_SYSTEM : prefs.theme,
      },
    };
  };
}

// ---- borrow requests ----

/** Records a request I am sending to a friend. */
export function addRequest(request: LendRequest): Change {
  return (vault) => (vault.requests.some((r) => r.id === request.id) ? vault : { ...vault, requests: [...vault.requests, request] });
}

export function deleteRequest(id: string): Change {
  return (vault) => ({ ...vault, requests: vault.requests.filter((r) => r.id !== id) });
}

/** Answers a friend's request with yes or no. Saying yes also marks my copy as lent out. */
export function answerRequest(requestId: string, accept: boolean, today: number, now: number): Change {
  return (vault) => {
    const request = vault.requests.find((r) => r.id === requestId && r.incoming);
    if (!request) return vault;
    const requests = vault.requests.map((r) => (r === request ? { ...r, status: accept ? ("ACCEPTED" as const) : ("DECLINED" as const), answeredAt: now } : r));
    let books = vault.books;
    if (accept) {
      books = books.map((book) =>
        book.id === request.bookRemoteId && book.ownership === "OWNED" && book.lentTo.trim() === ""
          ? { ...book, lentTo: request.peerName, lentSince: today, updatedAt: now }
          : book,
      );
    }
    return { ...vault, requests, books };
  };
}

// ---- backup ----

/**
 * Replaces the library with a backup. Whatever points at a book or list that did not
 * come along is dropped, as the app does. A backup made by the app holds no settings and
 * no borrow requests, in that case the current ones stay.
 */
export function restoreBackup(backup: Vault): Change {
  return (vault) => {
    const bookIds = new Set(backup.books.map((b) => b.id));
    const shelfIds = new Set(backup.shelves.map((s) => s.id));
    const listOf = (key: string) => (key.startsWith("list_") ? Number(key.slice(5)) : null);
    return {
      ...emptyVault(),
      _extra: backup._extra,
      exportedAt: backup.exportedAt,
      books: backup.books,
      shelves: backup.shelves,
      links: backup.links.filter((l) => bookIds.has(l.bookId) && shelfIds.has(l.shelfId)),
      quotes: backup.quotes.filter((q) => bookIds.has(q.bookId)),
      sessions: backup.sessions.filter((s) => bookIds.has(s.bookId)),
      notes: backup.notes.filter((n) => bookIds.has(n.bookId)),
      goals: backup.goals,
      purchases: backup.purchases.filter((p) => bookIds.has(p.bookId)),
      ornaments: backup.ornaments.filter((o) => {
        const id = listOf(o.shelfKey);
        return id === null || shelfIds.has(id);
      }),
      requests: backup.requests.length > 0 ? backup.requests : vault.requests,
      prefs: backup.prefs ?? vault.prefs,
    };
  };
}
