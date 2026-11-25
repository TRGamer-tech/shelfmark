// The book cart: the trolley where books wait to be shelved. A reader who looks for the
// seven volumes of a series puts each one on the cart as they find it, says once how
// they are to be shelved, and shelves them all with one change. This is the cart as
// data, apart from the page: what is on it, how each book is set, and what shelving
// makes of it. The cart is kept in the browser and does not go to the account.

import { normalise } from "./catalogue/remoteBook.ts";
import type { Book, Ownership, ReadingStatus } from "./model.ts";
import { OWNERSHIPS, READING_STATUSES, bookCodec } from "./model.ts";
import type { Change } from "./mutations.ts";
import { addBook } from "./mutations.ts";
import { withStatus } from "./rules.ts";

/** How a book is shelved: on which of the built-in lists, whose it is, and on which of the reader's own lists. */
export interface CartSettings {
  status: ReadingStatus;
  ownership: Ownership;
  listIds: number[];
}

export interface CartItem {
  /** What tells this book from the others on the cart: its ISBN, or its title and first author. */
  key: string;
  /** The book as it will be shelved, still without an id. */
  book: Book;
  /**
   * The book's own settings, once the reader set it apart from the rest. They stay as
   * they are when the settings for all change. Null for a book that goes with the rest.
   */
  own: CartSettings | null;
  /** Wanted although the same book stands on the shelf already. */
  anyway: boolean;
}

export interface Cart {
  /** The settings for every book that was not set apart. */
  forAll: CartSettings;
  items: CartItem[];
}

export const USUAL_SETTINGS: CartSettings = { status: "NONE", ownership: "OWNED", listIds: [] };

export function emptyCart(): Cart {
  return { forAll: { ...USUAL_SETTINGS, listIds: [] }, items: [] };
}

type Named = Pick<Book, "title" | "authors" | "isbn">;

const firstAuthor = (authors: string) => normalise(authors.split(",", 1)[0] ?? "");

/**
 * The same book: the same ISBN, or the same title and first author. It is the rule the
 * search uses to say "already in your library", and the one the import of lists uses.
 */
export function sameBook(a: Named, b: Named): boolean {
  if (a.isbn.trim() !== "" && a.isbn.trim() === b.isbn.trim()) return true;
  return normalise(a.title) === normalise(b.title) && firstAuthor(a.authors) === firstAuthor(b.authors);
}

/** What a book goes by on the cart. Two records of the same edition have the same key. */
export function cartKeyOf(book: Named): string {
  return book.isbn.trim() !== "" ? `isbn:${book.isbn.trim()}` : `name:${normalise(book.title)}|${firstAuthor(book.authors)}`;
}

/** The entry of a book on the cart, if it is there. */
export function onCart(cart: Cart, book: Named): CartItem | undefined {
  return cart.items.find((item) => item.key === cartKeyOf(book) || sameBook(item.book, book));
}

/**
 * Puts a book on the cart, at the end. A book that is on it already is not put there a
 * second time. [own] sets it apart at once, for a book whose list was chosen where it
 * was typed in.
 */
export function putOnCart(cart: Cart, book: Book, own: CartSettings | null = null): Cart {
  if (book.title.trim() === "" || onCart(cart, book)) return cart;
  return { ...cart, items: [...cart.items, { key: cartKeyOf(book), book: { ...book, id: 0 }, own: own ? tidy(own) : null, anyway: false }] };
}

export function takeOffCart(cart: Cart, key: string): Cart {
  return cart.items.some((item) => item.key === key) ? { ...cart, items: cart.items.filter((item) => item.key !== key) } : cart;
}

/** The one button of a search result: on the cart if it was not, off it if it was. */
export function toggleOnCart(cart: Cart, book: Book): Cart {
  const there = onCart(cart, book);
  return there ? takeOffCart(cart, there.key) : putOnCart(cart, book);
}

function tidy(settings: CartSettings): CartSettings {
  return { status: settings.status, ownership: settings.ownership, listIds: Array.from(new Set(settings.listIds)) };
}

/**
 * Changes settings. Choosing the wishlist for a book that is set as one's own proposes
 * "not mine" along with it, as adding a single book to the wishlist does: a wish is not
 * owned yet. The reader can say otherwise afterwards, and an ownership that is chosen in
 * the same breath counts.
 */
function changed(settings: CartSettings, patch: Partial<CartSettings>): CartSettings {
  const next = tidy({ ...settings, ...patch });
  if (patch.status === "WISHLIST" && settings.status !== "WISHLIST" && patch.ownership === undefined && next.ownership === "OWNED") next.ownership = "NOT_OWNED";
  return next;
}

/** Changes the settings for every book that was not set apart. */
export function setForAll(cart: Cart, patch: Partial<CartSettings>): Cart {
  return { ...cart, forAll: changed(cart.forAll, patch) };
}

/** How a book on the cart is shelved: by its own settings if it has some, by those for all otherwise. */
export function settingsOf(cart: Cart, item: CartItem): CartSettings {
  return item.own ?? cart.forAll;
}

/**
 * Changes the settings of one book, which sets it apart from the rest: from here on it
 * keeps what it has, whatever is chosen for all.
 */
export function setOwn(cart: Cart, key: string, patch: Partial<CartSettings>): Cart {
  return { ...cart, items: cart.items.map((item) => (item.key === key ? { ...item, own: changed(settingsOf(cart, item), patch) } : item)) };
}

/** Whether the same book stands on the shelf already. */
export function alreadyHere(item: CartItem, library: readonly Named[]): boolean {
  return library.some((book) => sameBook(book, item.book));
}

/** Says whether a book that is on the shelf already is shelved a second time all the same. */
export function wantAnyway(cart: Cart, key: string, wanted: boolean): Cart {
  return { ...cart, items: cart.items.map((item) => (item.key === key ? { ...item, anyway: wanted } : item)) };
}

/** The books that shelving will put on the shelf: all but those that are there already and not wanted a second time. */
export function toShelve(cart: Cart, library: readonly Named[]): CartItem[] {
  return cart.items.filter((item) => item.anyway || !alreadyHere(item, library));
}

/** A book as it stands on the shelf once it is shelved with these settings. */
export function shelvedBook(book: Book, settings: CartSettings, id: number, today: number): Book {
  // An e-book or an audiobook cannot be handed to a friend, as for any book that is added.
  const physical = book.format !== "EBOOK" && book.format !== "AUDIOBOOK";
  return withStatus({ ...book, id, ownership: settings.ownership, lendable: physical }, settings.status, today);
}

/**
 * Shelving the cart: ONE change to the library, and so one save, whatever the number of
 * books. [ids] hands out the ids of the new books. The change can be applied again
 * after another device saved in between, as every change can.
 */
export function shelveCart(cart: Cart, library: readonly Named[], ids: () => number, today: number, now: number): { change: Change; books: Book[] } {
  const entries = toShelve(cart, library).map((item) => {
    const settings = settingsOf(cart, item);
    return { book: shelvedBook(item.book, settings, ids(), today), listIds: settings.listIds };
  });
  const change: Change = (vault) => entries.reduce((document, entry) => addBook(entry.book, entry.listIds, now)(document), vault);
  return { change, books: entries.map((entry) => entry.book) };
}

// ---- kept in the browser ----

/** The cart as text, for the storage of the browser. */
export function writeCart(cart: Cart): string {
  return JSON.stringify({ forAll: cart.forAll, items: cart.items.map((item) => ({ book: bookCodec.write(item.book), own: item.own, anyway: item.anyway })) });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettings(raw: unknown): CartSettings | null {
  if (!isObject(raw)) return null;
  // A setting that cannot be read falls back to the usual one. Nothing is shelved by a word nobody knows.
  const status = (READING_STATUSES as string[]).includes(raw.status as string) ? (raw.status as ReadingStatus) : USUAL_SETTINGS.status;
  const ownership = (OWNERSHIPS as string[]).includes(raw.ownership as string) ? (raw.ownership as Ownership) : USUAL_SETTINGS.ownership;
  const listIds = Array.isArray(raw.listIds) ? raw.listIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id)) : [];
  return tidy({ status, ownership, listIds });
}

/**
 * Reads the cart from the storage of the browser. Whatever cannot be read is left out,
 * entry by entry: a damaged entry must not cost the reader the rest of the cart, and
 * nothing that is no book is ever shelved.
 */
export function readCart(text: string | null): Cart {
  const cart = emptyCart();
  if (text === null) return cart;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return cart;
  }
  if (!isObject(raw)) return cart;
  cart.forAll = readSettings(raw.forAll) ?? cart.forAll;
  let filled = cart;
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    if (!isObject(entry) || !isObject(entry.book) || typeof entry.book.title !== "string" || entry.book.title.trim() === "") continue;
    let book: Book;
    try {
      book = { ...bookCodec.read(entry.book), id: 0 };
    } catch {
      continue;
    }
    const before = filled.items.length;
    filled = putOnCart(filled, book, readSettings(entry.own));
    if (filled.items.length > before && entry.anyway === true) filled = wantAnyway(filled, cartKeyOf(book), true);
  }
  return filled;
}
