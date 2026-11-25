// What changing the reading status does to a book, as data/model/BookRules.kt.

import type { Book, ReadingStatus } from "./model.ts";

/**
 * Moves a book to another built-in list and keeps the reading dates in step: starting
 * a book stamps the start date, finishing it stamps the end date. Dates the reader
 * already entered are never overwritten.
 */
export function withStatus(book: Book, newStatus: ReadingStatus, today: number): Book {
  if (newStatus === book.status) return book;
  const moved: Book = { ...book, status: newStatus };
  switch (newStatus) {
    case "READING":
      // Picking up a finished book again is a re-read: it starts from the first page.
      return book.status === "READ"
        ? { ...moved, startedOn: today, finishedOn: null, currentPage: 0 }
        : { ...moved, startedOn: book.startedOn ?? today, finishedOn: null };
    case "READ":
      return {
        ...moved,
        finishedOn: book.finishedOn ?? today,
        currentPage: book.pageCount > 0 ? book.pageCount : book.currentPage,
        readCount: book.readCount + 1,
      };
    default:
      return moved;
  }
}

/** Sensible defaults for a book that is being added to the given list. */
export function withDefaultsFor(book: Book, newStatus: ReadingStatus, today: number): Book {
  const ownership = newStatus === "WISHLIST" ? "NOT_OWNED" : book.ownership;
  const physical = book.format !== "EBOOK" && book.format !== "AUDIOBOOK";
  return withStatus({ ...book, ownership, lendable: physical }, newStatus, today);
}

/** A friend can ask for this book right now. A wish that says it is owned is not on the shelf, so nobody can borrow it. */
export function availableToLend(book: Book): boolean {
  return book.ownership === "OWNED" && book.lendable && book.lentTo.trim() === "" && book.status !== "WISHLIST";
}

export function isAudio(book: { format: string }): boolean {
  return book.format === "AUDIOBOOK";
}

function commaList(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function genreList(book: Book): string[] {
  return commaList(book.genres);
}

export function tagList(book: Book): string[] {
  return commaList(book.tags);
}

export function authorList(authors: string): string[] {
  return commaList(authors);
}

/** Reading progress from 0 to 1, or null when it cannot be computed. */
export function progressOf(book: Book): number | null {
  if (book.pageCount > 0 && book.currentPage > 0) return Math.min(1, Math.max(0, book.currentPage / book.pageCount));
  return null;
}
