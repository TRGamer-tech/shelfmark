// The library as the Android app defines it (data/model/Models.kt and
// data/share/SharePayloads.kt). The documents on the server leave out every field that
// has its default value, so reading fills the defaults in and writing leaves them out
// again. Fields this website does not know are carried along untouched, so that a
// newer client does not lose what it added.

export type ReadingStatus = "NONE" | "WISHLIST" | "READING" | "READ" | "ABANDONED";
export type BookFormat = "UNKNOWN" | "HARDCOVER" | "PAPERBACK" | "EBOOK" | "AUDIOBOOK" | "OTHER";
export type Ownership = "OWNED" | "BORROWED" | "NOT_OWNED";
export type GoalKind = "BOOKS" | "PAGES" | "MINUTES";
export type GoalRepeat = "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type OrnamentKind =
  | "PLANT"
  | "CACTUS"
  | "CANDLE"
  | "MUG"
  | "VASE"
  | "LAMP"
  | "GLOBE"
  | "CLOCK"
  | "TROPHY"
  | "FRAME"
  | "PUMPKIN"
  | "BOOKEND"
  | "CAT"
  | "BOOKSTACK";

export type ViewMode = "COVERS" | "SPINES" | "LIST";
export type SortOrder = "ADDED" | "TITLE" | "AUTHOR" | "RATING";
export const VIEW_MODES: ViewMode[] = ["COVERS", "SPINES", "LIST"];
export const SORT_ORDERS: SortOrder[] = ["ADDED", "TITLE", "AUTHOR", "RATING"];

export const READING_STATUSES: ReadingStatus[] = ["NONE", "WISHLIST", "READING", "READ", "ABANDONED"];
export const BOOK_FORMATS: BookFormat[] = ["UNKNOWN", "HARDCOVER", "PAPERBACK", "EBOOK", "AUDIOBOOK", "OTHER"];
export const OWNERSHIPS: Ownership[] = ["OWNED", "BORROWED", "NOT_OWNED"];
export const GOAL_KINDS: GoalKind[] = ["BOOKS", "PAGES", "MINUTES"];
export const GOAL_REPEATS: GoalRepeat[] = ["ONCE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
export const ORNAMENT_KINDS: OrnamentKind[] = [
  "PLANT",
  "CACTUS",
  "CANDLE",
  "MUG",
  "VASE",
  "LAMP",
  "GLOBE",
  "CLOCK",
  "TROPHY",
  "FRAME",
  "PUMPKIN",
  "BOOKEND",
  "CAT",
  "BOOKSTACK",
];

/** What a document held that this website has no field for. Written back as it came. */
export type Extra = Record<string, unknown>;

export interface Book {
  id: number;
  title: string;
  subtitle: string;
  /** Display string, several authors separated by ", ". */
  authors: string;
  isbn: string;
  publisher: string;
  publishedYear: string;
  language: string;
  pageCount: number;
  format: BookFormat;
  description: string;
  coverUrl: string;
  /** Name of a photo that only exists on the phone. The website cannot show it. */
  coverPath: string;
  status: ReadingStatus;
  ownership: Ownership;
  borrowedFrom: string;
  lendable: boolean;
  lentTo: string;
  lentSince: number | null;
  /**
   * The loan between friends this book is out on or came in by (lib/loans.ts). Empty for
   * a book that is at home, or lent and borrowed by hand.
   */
  loanId: string;
  /** 0 = unrated, otherwise 0.5 to 5 in half star steps. */
  rating: number;
  /** 0 = not set, 1 to 5 chillies. */
  spice: number;
  review: string;
  startedOn: number | null;
  finishedOn: number | null;
  currentPage: number;
  readCount: number;
  favorite: boolean;
  genres: string;
  tags: string;
  series: string;
  seriesPosition: number;
  addedAt: number;
  updatedAt: number;
  _extra?: Extra;
}

export interface Shelf {
  id: number;
  name: string;
  position: number;
  createdAt: number;
  _extra?: Extra;
}

export interface BookShelf {
  bookId: number;
  shelfId: number;
  _extra?: Extra;
}

export interface Quote {
  id: number;
  bookId: number;
  text: string;
  page: number;
  note: string;
  fromOcr: boolean;
  createdAt: number;
  _extra?: Extra;
}

export interface ReadingSession {
  id: number;
  bookId: number;
  startedAt: number;
  startPage: number;
  endPage: number;
  minutes: number;
  note: string;
  _extra?: Extra;
}

export interface Note {
  id: number;
  bookId: number;
  title: string;
  text: string;
  page: number;
  createdAt: number;
  _extra?: Extra;
}

export interface Goal {
  id: number;
  name: string;
  kind: GoalKind;
  target: number;
  startDay: number;
  endDay: number;
  repeat: GoalRepeat;
  archived: boolean;
  createdAt: number;
  _extra?: Extra;
}

export interface Purchase {
  id: number;
  bookId: number;
  day: number;
  price: number;
  currency: string;
  store: string;
  note: string;
  _extra?: Extra;
}

export interface Ornament {
  id: number;
  /** The name of a built-in list ("READING") or "list_" and the id of a list of one's own. */
  shelfKey: string;
  kind: OrnamentKind;
  /** The ornament stands after this many books. */
  position: number;
  _extra?: Extra;
}

/** A theme made by the user. Colours are ARGB integers, signed as on Android. */
export interface CustomTheme {
  id: string;
  name: string;
  background: number;
  card: number;
  accent: number;
  text: number;
  _extra?: Extra;
}

export interface VaultPrefs {
  profileName: string;
  shareStatus: boolean;
  shareRatings: boolean;
  minutesPerPage: number;
  theme: string;
  customThemes: CustomTheme[];
  /** How the shelf is drawn: covers on boards, spines side by side, or a plain list. */
  viewMode: ViewMode;
  sort: SortOrder;
  /** The lively shelf: candles flicker, tea steams, books settle in. */
  motion: boolean;
  _extra?: Extra;
}

/** The whole library of an account. The same document as a backup of the app. */
export interface Vault {
  exportedAt: number;
  books: Book[];
  shelves: Shelf[];
  links: BookShelf[];
  quotes: Quote[];
  sessions: ReadingSession[];
  notes: Note[];
  goals: Goal[];
  purchases: Purchase[];
  ornaments: Ornament[];
  /** Null in a document that was written before settings travelled with the library. */
  prefs: VaultPrefs | null;
  _extra?: Extra;
}

export interface SharedBook {
  id: number;
  title: string;
  authors: string;
  isbn: string;
  coverUrl: string;
  pages: number;
  format: BookFormat;
  description: string;
  ownership: Ownership;
  available: boolean;
  status: ReadingStatus | null;
  shelves: string[];
  rating: number;
  spice: number;
  review: string;
  startedOn: number | null;
  finishedOn: number | null;
  _extra?: Extra;
}

export interface SharedLibrary {
  ownerId: string;
  ownerName: string;
  createdAt: number;
  includesStatus: boolean;
  includesRatings: boolean;
  books: SharedBook[];
  _extra?: Extra;
}

export interface Envelope {
  app: string;
  v: number;
  type: string;
  library: SharedLibrary | null;
  backup: Vault | null;
  _extra?: Extra;
}

export const ENVELOPE_APP = "shelfmark";
export const ENVELOPE_VERSION = 1;
export const TYPE_LIBRARY = "library";
export const TYPE_BACKUP = "backup";
// Borrow requests used to travel as files and messages of these two types. They are
// loans on the server now (lib/loans.ts). The names stay so that such a file can be told
// what it is: from an older version.
const OLD_REQUEST_TYPES = ["lend_request", "lend_answer"];

export const DEFAULT_SPEED = 1.5;
export const THEME_SYSTEM = "system";
export const CUSTOM_THEME_PREFIX = "custom:";

// ---------------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------------

type Primitive = "string" | "number" | "boolean";

interface Field {
  key: string;
  /** What to do with the value: a plain type, a nested object, or a list of something. */
  type: Primitive | Codec<unknown> | { list: Codec<unknown> | Primitive };
  /** The value a missing field stands for. Fields with a default are left out when they have it. */
  def?: unknown;
  /** Always written, as fields without a default are in the app. */
  required?: boolean;
  /** May be absent altogether, which is read as null. */
  nullable?: boolean;
}

export interface Codec<T> {
  fields: Field[];
  read(raw: unknown): T;
  write(value: T): Record<string, unknown>;
}

/**
 * Where a document holds something that cannot be read without changing it, as a path
 * like "books[2].pageCount", or null when all of it can.
 *
 * Reading is forgiving on purpose: a number where a text belongs is read as the default,
 * a list that is no list as an empty one. That is right for what is only shown, a
 * friend's shelf for instance. For a document that is written back it would be a quiet
 * loss: the default would be saved over what was there. So the library is looked at with
 * this before it is taken, and a document with a fault is not touched.
 *
 * Not a fault: a field this website does not know (it is carried along), a word it does
 * not know where it has a fixed set (a status, a format, a kind of ornament a newer
 * version invented: a text is written back as the text it was), and a null (nothing was
 * there, and nothing is written).
 */
function faultIn(fields: Field[], raw: unknown, path: string): string | null {
  if (!isObject(raw)) return path === "" ? "the document" : path;
  for (const field of fields) {
    const at = path === "" ? field.key : `${path}.${field.key}`;
    const value = raw[field.key];
    if (value === undefined || value === null) {
      // The app has no default for these and refuses a document without them.
      if (field.required) return at;
      continue;
    }
    const type = field.type;
    if (typeof type === "string") {
      if (typeof value !== type || (type === "number" && !Number.isFinite(value))) return at;
    } else if ("list" in type) {
      if (!Array.isArray(value)) return at;
      const inner = type.list;
      for (let index = 0; index < value.length; index++) {
        const fault = typeof inner === "string" ? (typeof value[index] === inner ? null : `${at}[${index}]`) : faultIn(inner.fields, value[index], `${at}[${index}]`);
        if (fault) return fault;
      }
    } else {
      const fault = faultIn(type.fields, value, at);
      if (fault) return fault;
    }
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fallbackFor(type: Primitive): unknown {
  return type === "string" ? "" : type === "number" ? 0 : false;
}

function readValue(type: Field["type"], raw: unknown, field: Field): unknown {
  const missing = raw === undefined || raw === null;
  if (typeof type === "string") {
    if (missing || typeof raw !== type) {
      if (field.nullable) return null;
      return field.def !== undefined ? field.def : fallbackFor(type);
    }
    return raw;
  }
  if ("list" in type) {
    if (!Array.isArray(raw)) return [];
    const inner = type.list;
    if (typeof inner === "string") return raw.filter((item) => typeof item === inner);
    return raw.filter(isObject).map((item) => inner.read(item));
  }
  if (missing || !isObject(raw)) return field.nullable ? null : type.read({});
  return type.read(raw);
}

function writeValue(type: Field["type"], value: unknown): unknown {
  if (typeof type === "string") return value;
  if ("list" in type) {
    const inner = type.list;
    const items = Array.isArray(value) ? value : [];
    return typeof inner === "string" ? items.slice() : items.map((item) => inner.write(item));
  }
  return type.write(value);
}

/**
 * [gone] names fields that used to be part of the document and are not any more. Unlike
 * a field this website merely does not know, they are not carried along: what is read
 * is read without them, and so written without them.
 */
function codec<T>(fields: Field[], gone: string[] = []): Codec<T> {
  const known = new Set(fields.map((f) => f.key));
  const dropped = new Set(gone);
  return {
    fields,
    read(raw: unknown): T {
      const source = isObject(raw) ? raw : {};
      const out: Record<string, unknown> = {};
      for (const field of fields) out[field.key] = readValue(field.type, source[field.key], field);
      let extra: Extra | undefined;
      for (const key of Object.keys(source)) {
        if (!known.has(key) && !dropped.has(key)) (extra ??= {})[key] = source[key];
      }
      if (extra) out._extra = extra;
      return out as T;
    },
    write(value: T): Record<string, unknown> {
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const field of fields) {
        const current = source[field.key];
        if (current === undefined || current === null) {
          // A field without a default cannot be left out, the app would not read the document.
          if (field.required) out[field.key] = typeof field.type === "string" ? fallbackFor(field.type) : writeValue(field.type, current);
          continue;
        }
        if (!field.required) {
          if (typeof field.type === "string" && current === field.def) continue;
          if (typeof field.type === "object" && "list" in field.type && Array.isArray(current) && current.length === 0) continue;
        }
        out[field.key] = writeValue(field.type, current);
      }
      const extra = source._extra;
      if (isObject(extra)) {
        for (const key of Object.keys(extra)) if (!(key in out)) out[key] = extra[key];
      }
      return out;
    },
  };
}

const req = (key: string, type: Field["type"]): Field => ({ key, type, required: true });
const opt = (key: string, type: Primitive, def: unknown): Field => ({ key, type, def });
const maybe = (key: string, type: Field["type"]): Field => ({ key, type, nullable: true });
const list = (key: string, of: Codec<any> | Primitive, required = false): Field => ({ key, type: { list: of as Codec<unknown> | Primitive }, required });

// The order of the fields is the order the app writes them in, so that a document
// written here looks like one written there.

export const bookCodec = codec<Book>([
  opt("id", "number", 0),
  req("title", "string"),
  opt("subtitle", "string", ""),
  opt("authors", "string", ""),
  opt("isbn", "string", ""),
  opt("publisher", "string", ""),
  opt("publishedYear", "string", ""),
  opt("language", "string", ""),
  opt("pageCount", "number", 0),
  opt("format", "string", "UNKNOWN"),
  opt("description", "string", ""),
  opt("coverUrl", "string", ""),
  opt("coverPath", "string", ""),
  opt("status", "string", "NONE"),
  opt("ownership", "string", "OWNED"),
  opt("borrowedFrom", "string", ""),
  opt("lendable", "boolean", true),
  opt("lentTo", "string", ""),
  maybe("lentSince", "number"),
  opt("loanId", "string", ""),
  opt("rating", "number", 0),
  opt("spice", "number", 0),
  opt("review", "string", ""),
  maybe("startedOn", "number"),
  maybe("finishedOn", "number"),
  opt("currentPage", "number", 0),
  opt("readCount", "number", 0),
  opt("favorite", "boolean", false),
  opt("genres", "string", ""),
  opt("tags", "string", ""),
  opt("series", "string", ""),
  opt("seriesPosition", "number", 0),
  // In the app a missing moment means "now". Zero stands for missing here and is not written.
  opt("addedAt", "number", 0),
  opt("updatedAt", "number", 0),
]);

export const shelfCodec = codec<Shelf>([opt("id", "number", 0), req("name", "string"), opt("position", "number", 0), opt("createdAt", "number", 0)]);

export const linkCodec = codec<BookShelf>([req("bookId", "number"), req("shelfId", "number")]);

export const quoteCodec = codec<Quote>([
  opt("id", "number", 0),
  req("bookId", "number"),
  req("text", "string"),
  opt("page", "number", 0),
  opt("note", "string", ""),
  opt("fromOcr", "boolean", false),
  opt("createdAt", "number", 0),
]);

export const sessionCodec = codec<ReadingSession>([
  opt("id", "number", 0),
  req("bookId", "number"),
  opt("startedAt", "number", 0),
  opt("startPage", "number", 0),
  opt("endPage", "number", 0),
  opt("minutes", "number", 0),
  opt("note", "string", ""),
]);

export const noteCodec = codec<Note>([
  opt("id", "number", 0),
  req("bookId", "number"),
  opt("title", "string", ""),
  req("text", "string"),
  opt("page", "number", 0),
  opt("createdAt", "number", 0),
]);

export const goalCodec = codec<Goal>([
  opt("id", "number", 0),
  opt("name", "string", ""),
  opt("kind", "string", "BOOKS"),
  req("target", "number"),
  req("startDay", "number"),
  req("endDay", "number"),
  opt("repeat", "string", "ONCE"),
  opt("archived", "boolean", false),
  opt("createdAt", "number", 0),
]);

export const purchaseCodec = codec<Purchase>([
  opt("id", "number", 0),
  req("bookId", "number"),
  req("day", "number"),
  opt("price", "number", 0),
  opt("currency", "string", ""),
  opt("store", "string", ""),
  opt("note", "string", ""),
]);

export const ornamentCodec = codec<Ornament>([opt("id", "number", 0), req("shelfKey", "string"), req("kind", "string"), opt("position", "number", 0)]);

export const customThemeCodec = codec<CustomTheme>([
  req("id", "string"),
  req("name", "string"),
  req("background", "number"),
  req("card", "number"),
  req("accent", "number"),
  req("text", "number"),
]);

export const prefsCodec = codec<VaultPrefs>([
  opt("profileName", "string", ""),
  opt("shareStatus", "boolean", true),
  opt("shareRatings", "boolean", true),
  opt("minutesPerPage", "number", DEFAULT_SPEED),
  opt("theme", "string", THEME_SYSTEM),
  list("customThemes", customThemeCodec),
  opt("viewMode", "string", "COVERS"),
  opt("sort", "string", "ADDED"),
  opt("motion", "boolean", true),
]);

export const vaultCodec = codec<Vault>(
  [
    req("exportedAt", "number"),
    list("books", bookCodec, true),
    list("shelves", shelfCodec, true),
    list("links", linkCodec, true),
    list("quotes", quoteCodec, true),
    list("sessions", sessionCodec),
    list("notes", noteCodec),
    list("goals", goalCodec),
    list("purchases", purchaseCodec),
    list("ornaments", ornamentCodec),
    maybe("prefs", prefsCodec as Codec<unknown>),
  ],
  // Borrow requests lived here before loans were kept on the server.
  ["requests"],
);

export const sharedBookCodec = codec<SharedBook>([
  req("id", "number"),
  req("title", "string"),
  opt("authors", "string", ""),
  opt("isbn", "string", ""),
  opt("coverUrl", "string", ""),
  opt("pages", "number", 0),
  opt("format", "string", "UNKNOWN"),
  opt("description", "string", ""),
  opt("ownership", "string", "OWNED"),
  opt("available", "boolean", false),
  maybe("status", "string"),
  list("shelves", "string"),
  opt("rating", "number", 0),
  opt("spice", "number", 0),
  opt("review", "string", ""),
  maybe("startedOn", "number"),
  maybe("finishedOn", "number"),
]);

export const sharedLibraryCodec = codec<SharedLibrary>([
  req("ownerId", "string"),
  req("ownerName", "string"),
  req("createdAt", "number"),
  req("includesStatus", "boolean"),
  req("includesRatings", "boolean"),
  list("books", sharedBookCodec, true),
]);

export const envelopeCodec = codec<Envelope>(
  [
    // The app always writes these two, default or not.
    req("app", "string"),
    req("v", "number"),
    req("type", "string"),
    maybe("library", sharedLibraryCodec as Codec<unknown>),
    maybe("backup", vaultCodec as Codec<unknown>),
  ],
  ["request", "answer"],
);

// ---------------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------------

export const DEFAULT_PREFS: VaultPrefs = prefsCodec.read({});

/** An account that never saved anything starts from this. */
export function emptyVault(): Vault {
  return vaultCodec.read({ exportedAt: 0, books: [], shelves: [], links: [], quotes: [] });
}

/** The settings of a library, with the defaults for one that has none yet. */
export function prefsOf(vault: Vault): VaultPrefs {
  return vault.prefs ?? DEFAULT_PREFS;
}

/** A new book with every field at its default. */
export function newBook(fields: Partial<Book> & { title: string }): Book {
  return { ...bookCodec.read({ title: fields.title }), ...fields };
}

export function readVault(raw: unknown): Vault {
  return vaultCodec.read(raw);
}

/** The format of a library document that this website knows. A document that names none is format 1. */
export const VAULT_FORMAT = 1;

/**
 * - "newer": the document names a format this website does not know yet. The site has
 *   to be updated before it can open the library.
 * - "unreadable": the document is damaged, or has a shape this website does not know.
 */
export type Unread = "newer" | "unreadable";

export type VaultCheck = { ok: true; vault: Vault } | { ok: false; why: Unread; where: string };

/**
 * Reads the library of an account, or says why it cannot be read. A library that cannot
 * be read is never replaced: not by an empty one, and not by what this website would
 * make of it (supabase/README.md, "A library a client cannot read is never replaced").
 */
export function inspectVault(raw: unknown): VaultCheck {
  if (!isObject(raw)) return { ok: false, why: "unreadable", where: "the document" };
  const format = raw.format;
  if (format !== undefined && format !== null) {
    if (typeof format !== "number" || !Number.isFinite(format)) return { ok: false, why: "unreadable", where: "format" };
    if (format > VAULT_FORMAT) return { ok: false, why: "newer", where: "format" };
  }
  const fault = faultIn(vaultCodec.fields, raw, "");
  if (fault) return { ok: false, why: "unreadable", where: fault };
  return { ok: true, vault: vaultCodec.read(raw) };
}

export function writeVault(vault: Vault): Record<string, unknown> {
  return vaultCodec.write(vault);
}

/** True for something that looks like a library document, so that a wrong file is not taken for one. */
export function looksLikeVault(raw: unknown): boolean {
  return isObject(raw) && Array.isArray(raw.books) && Array.isArray(raw.shelves) && Array.isArray(raw.links) && Array.isArray(raw.quotes);
}

export function makeEnvelope(type: string, part: Partial<Pick<Envelope, "library" | "backup">>): Envelope {
  return { app: ENVELOPE_APP, v: ENVELOPE_VERSION, type, library: null, backup: null, ...part };
}

export function writeEnvelope(envelope: Envelope): Record<string, unknown> {
  return envelopeCodec.write({ ...envelope, app: ENVELOPE_APP });
}

/** Reads a Shelfmark envelope. Null for anything else, as ShareCodec.decode in the app. */
export function readEnvelope(raw: unknown): Envelope | null {
  if (!isObject(raw)) return null;
  // The marker must really be there, a default does not count.
  if (raw.app !== ENVELOPE_APP) return null;
  if (typeof raw.type !== "string") return null;
  return envelopeCodec.read({ v: ENVELOPE_VERSION, ...raw });
}

/**
 * True for a file from the time when a borrow request and its answer were sent as
 * files. Nothing can be done with one any more, except saying where it comes from.
 */
export function isOldRequestFile(raw: unknown): boolean {
  return isObject(raw) && raw.app === ENVELOPE_APP && typeof raw.type === "string" && OLD_REQUEST_TYPES.includes(raw.type);
}
