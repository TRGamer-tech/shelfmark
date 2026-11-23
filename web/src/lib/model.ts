// The library as the Android app defines it (data/model/Models.kt and
// data/share/SharePayloads.kt). The documents on the server leave out every field that
// has its default value, so reading fills the defaults in and writing leaves them out
// again. Fields this website does not know are carried along untouched, so that a
// newer client does not lose what it added.

export type ReadingStatus = "NONE" | "WISHLIST" | "READING" | "READ" | "ABANDONED";
export type BookFormat = "UNKNOWN" | "HARDCOVER" | "PAPERBACK" | "EBOOK" | "AUDIOBOOK" | "OTHER";
export type Ownership = "OWNED" | "BORROWED" | "NOT_OWNED";
export type LendStatus = "PENDING" | "ACCEPTED" | "DECLINED";
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

export interface LendRequest {
  id: string;
  incoming: boolean;
  bookRemoteId: number;
  bookTitle: string;
  bookAuthors: string;
  isbn: string;
  peerId: string;
  peerName: string;
  note: string;
  status: LendStatus;
  createdAt: number;
  answeredAt: number | null;
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
  requests: LendRequest[];
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

export interface LendRequestMsg {
  requestId: string;
  bookId: number;
  bookTitle: string;
  bookAuthors: string;
  isbn: string;
  fromId: string;
  fromName: string;
  toId: string;
  note: string;
  createdAt: number;
  _extra?: Extra;
}

export interface LendAnswerMsg {
  requestId: string;
  accepted: boolean;
  bookTitle: string;
  fromId: string;
  fromName: string;
  toId: string;
  answeredAt: number;
  _extra?: Extra;
}

export interface Envelope {
  app: string;
  v: number;
  type: string;
  library: SharedLibrary | null;
  request: LendRequestMsg | null;
  answer: LendAnswerMsg | null;
  backup: Vault | null;
  _extra?: Extra;
}

export const ENVELOPE_APP = "shelfmark";
export const ENVELOPE_VERSION = 1;
export const TYPE_LIBRARY = "library";
export const TYPE_REQUEST = "lend_request";
export const TYPE_ANSWER = "lend_answer";
export const TYPE_BACKUP = "backup";

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

function codec<T>(fields: Field[]): Codec<T> {
  const known = new Set(fields.map((f) => f.key));
  return {
    fields,
    read(raw: unknown): T {
      const source = isObject(raw) ? raw : {};
      const out: Record<string, unknown> = {};
      for (const field of fields) out[field.key] = readValue(field.type, source[field.key], field);
      let extra: Extra | undefined;
      for (const key of Object.keys(source)) {
        if (!known.has(key)) (extra ??= {})[key] = source[key];
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

export const requestCodec = codec<LendRequest>([
  req("id", "string"),
  req("incoming", "boolean"),
  req("bookRemoteId", "number"),
  req("bookTitle", "string"),
  opt("bookAuthors", "string", ""),
  opt("isbn", "string", ""),
  req("peerId", "string"),
  req("peerName", "string"),
  opt("note", "string", ""),
  opt("status", "string", "PENDING"),
  opt("createdAt", "number", 0),
  maybe("answeredAt", "number"),
]);

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

export const vaultCodec = codec<Vault>([
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
  list("requests", requestCodec),
  maybe("prefs", prefsCodec as Codec<unknown>),
]);

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

export const requestMsgCodec = codec<LendRequestMsg>([
  req("requestId", "string"),
  req("bookId", "number"),
  req("bookTitle", "string"),
  opt("bookAuthors", "string", ""),
  opt("isbn", "string", ""),
  req("fromId", "string"),
  req("fromName", "string"),
  req("toId", "string"),
  opt("note", "string", ""),
  req("createdAt", "number"),
]);

export const answerMsgCodec = codec<LendAnswerMsg>([
  req("requestId", "string"),
  req("accepted", "boolean"),
  req("bookTitle", "string"),
  req("fromId", "string"),
  req("fromName", "string"),
  req("toId", "string"),
  req("answeredAt", "number"),
]);

export const envelopeCodec = codec<Envelope>([
  // The app always writes these two, default or not.
  req("app", "string"),
  req("v", "number"),
  req("type", "string"),
  maybe("library", sharedLibraryCodec as Codec<unknown>),
  maybe("request", requestMsgCodec as Codec<unknown>),
  maybe("answer", answerMsgCodec as Codec<unknown>),
  maybe("backup", vaultCodec as Codec<unknown>),
]);

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

export function writeVault(vault: Vault): Record<string, unknown> {
  return vaultCodec.write(vault);
}

/** True for something that looks like a library document, so that a wrong file is not taken for one. */
export function looksLikeVault(raw: unknown): boolean {
  return isObject(raw) && Array.isArray(raw.books) && Array.isArray(raw.shelves) && Array.isArray(raw.links) && Array.isArray(raw.quotes);
}

export function makeEnvelope(type: string, part: Partial<Pick<Envelope, "library" | "request" | "answer" | "backup">>): Envelope {
  return { app: ENVELOPE_APP, v: ENVELOPE_VERSION, type, library: null, request: null, answer: null, backup: null, ...part };
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
