// Which slice of the library is on screen, and in which order (ui/library/LibraryLogic.kt).

import type { Book, BookShelf, ReadingStatus, SortOrder } from "./model.ts";

export type LibraryFilter =
  | { kind: "all" }
  | { kind: "status"; status: ReadingStatus }
  | { kind: "shelf"; shelfId: number }
  /** My books that are currently with someone else. */
  | { kind: "lent" }
  /** Books I have on loan from someone. */
  | { kind: "borrowed" };

/** The order the built-in lists appear in, from what is on the nightstand to what was given up. */
export const STATUS_ORDER: ReadingStatus[] = ["READING", "NONE", "READ", "WISHLIST", "ABANDONED"];

export function matches(book: Book, filter: LibraryFilter, shelfMembers: Set<number>): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "status":
      return book.status === filter.status;
    case "shelf":
      return shelfMembers.has(book.id);
    case "lent":
      return book.lentTo.trim() !== "";
    case "borrowed":
      return book.ownership === "BORROWED";
  }
}

export function matchesQuery(book: Book, query: string): boolean {
  const q = query.trim();
  if (q === "") return true;
  const has = (text: string, word: string) => text.toLowerCase().includes(word.toLowerCase());
  return q
    .split(" ")
    .filter((word) => word.trim() !== "")
    .every((word) => has(book.title, word) || has(book.subtitle, word) || has(book.authors, word) || book.isbn.includes(word));
}

/** Leading articles are ignored when sorting, in English and German. */
export function sortKey(title: string): string {
  const lower = title.trim().toLowerCase();
  const article = ["the ", "a ", "an ", "der ", "die ", "das ", "ein ", "eine "].find((a) => lower.startsWith(a));
  return article ? lower.slice(article.length) : lower;
}

/** Sorts by surname: "Frank Herbert" files under H. */
export function authorKey(authors: string): string {
  const first = authors.split(",")[0].trim();
  if (first === "") return "￿";
  const surname = first.slice(first.lastIndexOf(" ") + 1);
  return (surname + " " + first).toLowerCase();
}

// Plain comparison by code units, as String.compareTo in the app, so both sort alike.
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sortBooks(books: Book[], order: SortOrder): Book[] {
  const copy = books.slice();
  switch (order) {
    case "ADDED":
      return copy.sort((a, b) => b.addedAt - a.addedAt || b.id - a.id);
    case "TITLE":
      return copy.sort((a, b) => compareText(sortKey(a.title), sortKey(b.title)));
    case "AUTHOR":
      return copy.sort((a, b) => compareText(authorKey(a.authors), authorKey(b.authors)) || compareText(sortKey(a.title), sortKey(b.title)));
    case "RATING":
      return copy.sort((a, b) => b.rating - a.rating || compareText(sortKey(a.title), sortKey(b.title)));
    default:
      // An order a newer app knows and this website does not: leave the books as they are.
      return copy;
  }
}

export function applyFilter(books: Book[], links: BookShelf[], filter: LibraryFilter, query: string, order: SortOrder): Book[] {
  const members = filter.kind === "shelf" ? new Set(links.filter((l) => l.shelfId === filter.shelfId).map((l) => l.bookId)) : new Set<number>();
  return sortBooks(
    books.filter((book) => matches(book, filter, members) && matchesQuery(book, query)),
    order,
  );
}

/** What tapping star number [star] does to the current rating: whole, then half, then clear. */
export function nextRating(rating: number, star: number): number {
  if (rating === star) return star - 0.5;
  if (rating === star - 0.5) return 0;
  return star;
}

/** 4.5 is shown as "4.5", 4 as "4". */
export function formatRating(rating: number, locale = "en"): string {
  if (rating % 1 === 0) return String(rating);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating);
}

/** "14.90 CHF", or just the number when no currency was entered. */
export function formatPrice(price: number, currency: string, locale = "en"): string {
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(price);
  return (number + " " + currency.trim()).trim();
}
