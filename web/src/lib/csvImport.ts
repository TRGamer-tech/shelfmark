// Lists of books from other apps (data/importer/CsvImporter.kt in the app), and what
// becomes of them in the library (previewImport and importBooks in LibraryRepository.kt).
//
// Goodreads and StoryGraph are recognised by their columns. Anything else is matched
// by column name, so most CSV exports work.

import { extractYear, normalise, parseFormat, stripHtml } from "./catalogue/remoteBook.ts";
import { daysInMonth, localNoon, toEpochDay } from "./dates.ts";
import * as Isbn from "./isbn.ts";
import type { Book, BookFormat, ReadingStatus, Shelf, Vault } from "./model.ts";
import { newBook } from "./model.ts";

// ---- plain CSV reading ----

const blank = (text: string) => text.trim() === "";

function separatorOf(header: string): string {
  let best = ",";
  let most = -1;
  for (const separator of [",", ";", "\t"]) {
    const count = header.split(separator).length - 1;
    if (count > most) {
      best = separator;
      most = count;
    }
  }
  return best;
}

/** Quoted fields, doubled quotes, line breaks inside quotes, any common separator. Empty lines are dropped. */
export function parseCsv(text: string): string[][] {
  const content = text.startsWith("﻿") ? text.slice(1) : text;
  const separator = separatorOf(content.split(/\r\n|\n|\r/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.some((value) => !blank(value))) rows.push(row);
    row = [];
  };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted && c === '"' && content[i + 1] === '"') {
      field += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && c === separator) {
      row.push(field);
      field = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && content[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
    }
  }
  endRow();
  return rows;
}

/** A CSV file with a header row. Columns are found by name, whatever their case or order. */
export class CsvTable {
  private readonly titles: string[];
  private readonly header: string[];
  /** The columns somebody asked for and that are there: what the importer made use of. */
  private readonly used = new Set<string>();
  readonly rows: string[][];

  constructor(rows: string[][]) {
    this.titles = (rows[0] ?? []).map((title) => title.trim());
    this.header = this.titles.map((title) => title.toLowerCase());
    this.rows = rows.slice(1);
  }

  has(...names: string[]): boolean {
    let found = false;
    for (const name of names) {
      if (this.header.includes(name)) {
        this.used.add(name);
        found = true;
      }
    }
    return found;
  }

  /** The value of the first of [names] that exists as a column and is not empty in this row. */
  get(row: string[], ...names: string[]): string {
    let found = "";
    for (const name of names) {
      const index = this.header.indexOf(name);
      if (index < 0) continue;
      this.used.add(name);
      const value = (row[index] ?? "").trim();
      if (found === "" && value !== "") found = value;
    }
    return found;
  }

  /** The names of the columns as the file spells them: those that were read, and the rest. */
  columns(): { recognised: string[]; ignored: string[] } {
    const recognised: string[] = [];
    const ignored: string[] = [];
    this.titles.forEach((title, index) => {
      if (title === "") return;
      (this.used.has(this.header[index]) ? recognised : ignored).push(title);
    });
    return { recognised, ignored };
  }
}

// ---- from rows to books ----

/** A book read from a foreign file, with the names of the lists of one's own it should go on. */
export interface PlannedBook {
  book: Book;
  lists: string[];
}

export interface ImportPlan {
  source: string;
  books: PlannedBook[];
  /** The columns of the file that were understood, and those that were not, for the preview. */
  columns: string[];
  ignored: string[];
}

export const GOODREADS = "Goodreads";
export const STORYGRAPH = "StoryGraph";
export const GENERIC = "CSV";

/** What the importer needs to know about time: the present, and noon of a day as a moment. */
export interface ImportClock {
  now: number;
  noon: (epochDay: number) => number;
}

/** As String.toIntOrNull: whole numbers only, nothing around them. */
function int(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= -2147483648 && value <= 2147483647 ? value : null;
}

/** As String.toFloatOrNull for the numbers a list of books holds. */
function float(text: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Maps the many words apps use for a reading state. A book to read that is not owned is a wish. */
export function statusOf(word: string, owned: boolean): ReadingStatus {
  switch (word.trim().toLowerCase()) {
    case "read":
    case "finished":
    case "completed":
    case "done":
    case "gelesen":
    case "beendet":
      return "READ";
    case "currently-reading":
    case "currently reading":
    case "reading":
    case "in progress":
    case "in-progress":
    case "paused":
    case "on hold":
    case "on-hold":
    case "am lesen":
    case "lese ich":
      return "READING";
    case "did-not-finish":
    case "did not finish":
    case "dnf":
    case "gave up":
    case "abandoned":
    case "stopped":
    case "abgebrochen":
      return "ABANDONED";
    case "to-read":
    case "to read":
    case "want to read":
    case "want-to-read":
    case "tbr":
    case "planned":
    case "wishlist":
    case "wunschliste":
      return owned ? "NONE" : "WISHLIST";
    default:
      return "NONE";
  }
}

const SERIES_IN_TITLE = /^(.+?)\s*\((.+?),?\s*#(\d+(?:[.,]\d+)?)\)$/;

/** Splits "Dune (Dune, #1)" into the title, the series and the position in it. */
export function splitSeries(raw: string): { title: string; series: string; position: number } {
  const match = SERIES_IN_TITLE.exec(raw.trim());
  if (!match) return { title: raw.trim(), series: "", position: 0 };
  return { title: match[1].trim(), series: match[2].trim(), position: float(match[3].replace(",", ".")) ?? 0 };
}

function people(text: string): string[] {
  return text
    .split(/[,;&]/)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** Goodreads wraps ISBNs as ="0441172717" so that spreadsheets keep the leading zero. */
function isbn(...candidates: string[]): string {
  for (const candidate of candidates) {
    const bare = (candidate.startsWith("=") ? candidate.slice(1) : candidate).replace(/^"+|"+$/g, "");
    const found = Isbn.to13(bare);
    if (found) return found;
  }
  return "";
}

function rating(text: string): number {
  return clamp(float(text.replace(",", ".")) ?? 0, 0, 5);
}

// The ways of writing a date that are tried, in this order: yyyy/MM/dd, yyyy-MM-dd,
// dd.MM.yyyy, d.M.yyyy, MM/dd/yyyy, yyyy/M/d. Each names where year, month and day stand.
const DATE_FORMATS: [RegExp, number, number, number][] = [
  [/^(\d{4,})\/(\d{2})\/(\d{2})$/, 1, 2, 3],
  [/^(\d{4,})-(\d{2})-(\d{2})$/, 1, 2, 3],
  [/^(\d{2})\.(\d{2})\.(\d{4,})$/, 3, 2, 1],
  [/^(\d+)\.(\d+)\.(\d{4,})$/, 3, 2, 1],
  [/^(\d{2})\/(\d{2})\/(\d{4,})$/, 3, 1, 2],
  [/^(\d{4,})\/(\d+)\/(\d+)$/, 1, 2, 3],
];

/** A date as other apps write it, with or without a time behind it, as a day since 1970. Null for anything else. */
export function importDay(text: string): number | null {
  const value = text.trim().slice(0, 10).trim();
  if (value === "") return null;
  for (const [pattern, y, m, d] of DATE_FORMATS) {
    const match = pattern.exec(value);
    if (!match) continue;
    const year = Number(match[y]);
    const month = Number(match[m]);
    const day = Number(match[d]);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    // As java.time does when it is lenient about the 31st of a short month: the last day that exists.
    return toEpochDay(year, month, Math.min(day, daysInMonth(year, month)));
  }
  return null;
}

function moment(text: string, clock: ImportClock): number {
  const day = importDay(text);
  return day === null ? clock.now : clock.noon(day);
}

/** Settles the fields that depend on the list the book ends up on. */
function finish(book: Book, status: ReadingStatus, owned: boolean): Book {
  const wish = status === "WISHLIST" && !owned;
  return {
    ...book,
    status,
    ownership: wish ? "NOT_OWNED" : "OWNED",
    lendable: book.format !== "EBOOK" && book.format !== "AUDIOBOOK" && !wish,
    readCount: status === "READ" ? Math.max(1, book.readCount) : book.readCount,
    currentPage: status === "READ" ? book.pageCount : 0,
  };
}

const GOODREADS_STATES = new Set(["read", "currently-reading", "to-read"]);

function goodreads(t: CsvTable, row: string[], clock: ImportClock): PlannedBook | null {
  const { title, series, position } = splitSeries(t.get(row, "title"));
  if (blank(title)) return null;
  const shelf = t.get(row, "exclusive shelf");
  const owned = (int(t.get(row, "owned copies")) ?? 0) > 0;
  const status = statusOf(shelf, owned);
  const finished = importDay(t.get(row, "date read"));
  const book = newBook({
    title,
    authors: [t.get(row, "author"), ...people(t.get(row, "additional authors"))].filter((name) => !blank(name)).join(", "),
    isbn: isbn(t.get(row, "isbn13"), t.get(row, "isbn")),
    publisher: t.get(row, "publisher"),
    publishedYear: extractYear(t.get(row, "original publication year", "year published")),
    pageCount: int(t.get(row, "number of pages")) ?? 0,
    format: parseFormat(t.get(row, "binding")),
    rating: rating(t.get(row, "my rating")),
    review: stripHtml(t.get(row, "my review")),
    finishedOn: status === "READ" ? finished : null,
    readCount: status === "READ" ? Math.max(1, int(t.get(row, "read count")) ?? 1) : 0,
    series,
    seriesPosition: position,
    addedAt: moment(t.get(row, "date added"), clock),
  });
  return {
    book: finish(book, status, owned),
    // The three built-in shelves are states here, everything else becomes a list.
    lists: t
      .get(row, "bookshelves")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "" && !GOODREADS_STATES.has(name)),
  };
}

function storygraph(t: CsvTable, row: string[], clock: ImportClock): PlannedBook | null {
  const title = t.get(row, "title");
  if (blank(title)) return null;
  const owned = ["yes", "true", "1"].includes(t.get(row, "owned?", "owned").toLowerCase());
  const status = statusOf(t.get(row, "read status"), owned);
  // "Dates Read" holds ranges like 2024/01/03-2024/01/20, several of them for re-reads.
  const lastRange = (t.get(row, "dates read").split(",").pop() ?? "").trim();
  const dash = lastRange.lastIndexOf("-");
  const finished = importDay(t.get(row, "last date read")) ?? importDay(dash < 0 ? lastRange : lastRange.slice(dash + 1));
  const kind = t.get(row, "format");
  const format: BookFormat = kind.toLowerCase() === "audio" ? "AUDIOBOOK" : kind.toLowerCase() === "digital" ? "EBOOK" : parseFormat(kind);
  const book = newBook({
    title,
    authors: people(t.get(row, "authors")).join(", "),
    isbn: isbn(t.get(row, "isbn/uid")),
    format,
    rating: rating(t.get(row, "star rating")),
    review: stripHtml(t.get(row, "review")),
    startedOn: lastRange.includes("-") ? importDay(lastRange.slice(0, lastRange.indexOf("-"))) : null,
    finishedOn: status === "READ" ? finished : null,
    readCount: status === "READ" ? Math.max(1, int(t.get(row, "read count")) ?? 1) : 0,
    tags: t.get(row, "tags"),
    addedAt: moment(t.get(row, "date added"), clock),
  });
  return { book: finish(book, status, owned), lists: [] };
}

const TITLE_COLUMNS = ["title", "book_title", "name", "titel", "buchtitel"];

function generic(t: CsvTable, row: string[], clock: ImportClock): PlannedBook | null {
  const title = t.get(row, ...TITLE_COLUMNS);
  if (blank(title)) return null;
  // A list one keeps oneself is a list of books one has, so a wish stays on the shelf of unread books.
  const status = statusOf(t.get(row, "status", "read status", "exclusive shelf", "shelf", "state", "lesestatus", "regal"), true);
  const cover = t.get(row, "cover_url", "cover", "cover_link", "image", "thumbnail");
  const book = newBook({
    title,
    subtitle: t.get(row, "subtitle", "untertitel"),
    authors: people(t.get(row, "authors", "author(s)", "author", "author_names", "autor", "autoren", "autorin", "verfasser")).join(", "),
    isbn: isbn(t.get(row, "isbn13", "isbn_13", "isbn", "isbn10", "isbn_10")),
    publisher: t.get(row, "publisher", "verlag"),
    publishedYear: extractYear(t.get(row, "published_date", "published", "publication_date", "published_at", "year", "jahr", "erscheinungsjahr")),
    language: t.get(row, "language", "sprache"),
    description: stripHtml(t.get(row, "description", "beschreibung", "klappentext")),
    format: parseFormat(t.get(row, "type", "format", "book_type", "reading_format", "binding", "einband")),
    pageCount: int(t.get(row, "pages", "page_count", "pages_count", "number of pages", "total_pages", "seiten", "seitenzahl")) ?? 0,
    rating: rating(t.get(row, "rating", "my rating", "star_rating", "star rating", "bewertung", "sterne")),
    spice: clamp(int(t.get(row, "spice", "spice_level")) ?? 0, 0, 5),
    review: stripHtml(t.get(row, "latest_review", "review", "my review", "rezension")),
    series: t.get(row, "series", "series_name", "reihe", "serie"),
    seriesPosition: float(t.get(row, "series_position", "series_index", "series_number", "volume", "series_order", "band").replace(",", ".")) ?? 0,
    genres: t.get(row, "genres", "genre"),
    tags: t.get(row, "tags"),
    favorite: ["true", "yes", "1", "y"].includes(t.get(row, "favorite", "favourite", "is_favorite").toLowerCase()),
    coverUrl: cover.startsWith("http") ? cover : "",
    startedOn: importDay(t.get(row, "start_date", "started", "date started")),
    finishedOn: importDay(t.get(row, "end_date", "finished", "date read", "date finished")),
    readCount: int(t.get(row, "read_count", "read count")) ?? 0,
    addedAt: moment(t.get(row, "date_added", "added", "created_at", "dateadded", "date added"), clock),
  });
  return { book: finish(book, status, true), lists: [] };
}

/** Returns null when the text is not a table of books: no title column, or no book in it. */
export function parseImport(text: string, clock: ImportClock = { now: Date.now(), noon: localNoon }): ImportPlan | null {
  const table = new CsvTable(parseCsv(text));
  let source: string;
  let read: (t: CsvTable, row: string[], clock: ImportClock) => PlannedBook | null;
  if (table.has("exclusive shelf") && table.has("title")) [source, read] = [GOODREADS, goodreads];
  else if (table.has("read status") && table.has("title")) [source, read] = [STORYGRAPH, storygraph];
  else if (table.has(...TITLE_COLUMNS)) [source, read] = [GENERIC, generic];
  else return null;
  const books: PlannedBook[] = [];
  for (const row of table.rows) {
    const planned = read(table, row, clock);
    if (planned) books.push(planned);
  }
  if (books.length === 0) return null;
  const { recognised, ignored } = table.columns();
  return { source, books, columns: recognised, ignored };
}

// ---- into the library ----

/** Two records describe the same book when the ISBN matches, or title and first author do. */
export function sameBook(a: Book, b: Book): boolean {
  if (!blank(a.isbn) && a.isbn === b.isbn) return true;
  const first = (authors: string) => normalise(authors.split(",", 1)[0] ?? "");
  return normalise(a.title) === normalise(b.title) && first(a.authors) === first(b.authors);
}

/** Adds what [incoming] knows and [existing] lacks. Nothing the reader already entered is overwritten. */
export function fillGaps(existing: Book, incoming: Book): Book {
  const text = (mine: string, theirs: string) => (blank(mine) ? theirs : mine);
  return {
    ...existing,
    isbn: text(existing.isbn, incoming.isbn),
    publisher: text(existing.publisher, incoming.publisher),
    publishedYear: text(existing.publishedYear, incoming.publishedYear),
    pageCount: existing.pageCount > 0 ? existing.pageCount : incoming.pageCount,
    format: existing.format !== "UNKNOWN" ? existing.format : incoming.format,
    description: text(existing.description, incoming.description),
    coverUrl: text(existing.coverUrl, incoming.coverUrl),
    rating: existing.rating > 0 ? existing.rating : incoming.rating,
    review: text(existing.review, incoming.review),
    startedOn: existing.startedOn ?? incoming.startedOn,
    finishedOn: existing.finishedOn ?? incoming.finishedOn,
    genres: text(existing.genres, incoming.genres),
    tags: text(existing.tags, incoming.tags),
    series: text(existing.series, incoming.series),
  };
}

const FILLED: (keyof Book)[] = ["isbn", "publisher", "publishedYear", "pageCount", "format", "description", "coverUrl", "rating", "review", "startedOn", "finishedOn", "genres", "tags", "series"];

/**
 * The ids an import may need, made before anything is changed: one per book of the
 * plan, in its order, and one per list name (in small letters) that may have to be
 * created. A change must come out the same however often it is applied.
 */
export interface ImportIds {
  books: number[];
  lists: Record<string, number>;
}

export function importIdsFor(plan: ImportPlan, nextId: () => number): ImportIds {
  const lists: Record<string, number> = {};
  for (const planned of plan.books) for (const name of planned.lists) lists[name.toLowerCase()] ??= nextId();
  return { books: plan.books.map(() => nextId()), lists };
}

export interface ImportOutcome {
  vault: Vault;
  /** Books of the plan that were not in the library, as they were added. */
  added: Book[];
  /** Books that were there already, as the plan has them. They only get their gaps filled. */
  known: Book[];
  /** How many of the known books gained something. */
  completed: number;
  /** The lists that had to be created. */
  newLists: string[];
}

/**
 * Adds the books of [plan]. A book that is already in the library is not duplicated,
 * it only gains what the file knows and the library does not. A book that stands in the
 * file twice is added once. The lists named in the file exist afterwards, an existing
 * one is reused whatever its case.
 */
export function applyImport(vault: Vault, plan: ImportPlan, ids: ImportIds, now: number): ImportOutcome {
  const library = vault.books.slice();
  const shelves: Shelf[] = vault.shelves.slice();
  const links = vault.links.slice();
  const lists = new Map(shelves.map((shelf) => [shelf.name.toLowerCase(), shelf.id]));
  const linked = new Set(links.map((link) => `${link.bookId}|${link.shelfId}`));

  // Where each book stands, by id, by ISBN and by title with first author, so that a long
  // list does not have to be held against the whole library row by row. Each keeps the
  // first book it was given, which is the one "the first book that matches" would find.
  const byId = new Map<number, number>();
  const byIsbn = new Map<string, number>();
  const byName = new Map<string, number>();
  const nameOf = (book: Book) => `${normalise(book.title)}|${normalise(book.authors.split(",", 1)[0] ?? "")}`;
  const earliest = (index: Map<string, number>, key: string, at: number) => {
    const known = index.get(key);
    if (known === undefined || at < known) index.set(key, at);
  };
  const note = (book: Book, at: number) => {
    byId.set(book.id, at);
    if (!blank(book.isbn)) earliest(byIsbn, book.isbn, at);
    earliest(byName, nameOf(book), at);
  };
  library.forEach(note);
  const find = (book: Book): number => {
    const isbnAt = blank(book.isbn) ? undefined : byIsbn.get(book.isbn);
    const nameAt = byName.get(nameOf(book));
    if (isbnAt === undefined) return nameAt ?? -1;
    return nameAt === undefined ? isbnAt : Math.min(isbnAt, nameAt);
  };

  const added: Book[] = [];
  const known: Book[] = [];
  const newLists: string[] = [];
  // Books, not rows: a file can name the same book twice.
  const completedIds = new Set<number>();
  let changed = false;
  plan.books.forEach((planned, index) => {
    const id = ids.books[index];
    // A book with this id is this very row, saved by an earlier attempt of the same import.
    const matchAt = byId.get(id) ?? find(planned.book);
    let bookId: number;
    if (matchAt < 0) {
      const book: Book = { ...planned.book, id, updatedAt: now };
      library.push(book);
      note(book, library.length - 1);
      added.push(book);
      bookId = id;
      changed = true;
    } else {
      const match = library[matchAt];
      const filled = fillGaps(match, planned.book);
      if (FILLED.some((key) => filled[key] !== match[key])) {
        // "Completed" are books that were here before, not ones this file just brought.
        if (!added.some((book) => book.id === match.id)) completedIds.add(match.id);
        library[matchAt] = { ...filled, updatedAt: now };
        // It may have gained an ISBN, by which a later row can find it.
        note(library[matchAt], matchAt);
        changed = true;
      }
      known.push(planned.book);
      bookId = match.id;
    }
    for (const name of planned.lists) {
      const key = name.toLowerCase();
      let listId = lists.get(key);
      if (listId === undefined) {
        listId = ids.lists[key];
        if (!shelves.some((shelf) => shelf.id === listId)) {
          const position = shelves.reduce((max, shelf) => Math.max(max, shelf.position), -1) + 1;
          shelves.push({ id: listId, name: name.trim(), position, createdAt: now });
          newLists.push(name.trim());
        }
        lists.set(key, listId);
        changed = true;
      }
      if (!linked.has(`${bookId}|${listId}`)) {
        links.push({ bookId, shelfId: listId });
        linked.add(`${bookId}|${listId}`);
        changed = true;
      }
    }
  });
  // Nothing to do leaves the library as it is, so that nothing is saved for it.
  return { vault: changed ? { ...vault, books: library, shelves, links } : vault, added, known, completed: completedIds.size, newLists };
}

/** What an import would do, without doing it. */
export function previewImport(vault: Vault, plan: ImportPlan): Omit<ImportOutcome, "vault"> {
  let next = -1;
  const { added, known, completed, newLists } = applyImport(vault, plan, importIdsFor(plan, () => next--), 0);
  return { added, known, completed, newLists };
}

// ---- reading the file ----

/**
 * The text of a file. Lists that come out of a spreadsheet on Windows are often not
 * UTF-8, and read as such every umlaut would be lost, so those are read as Windows-1252.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** True for a zip archive, which the website does not open. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
}
