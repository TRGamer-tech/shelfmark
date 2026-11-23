// Pace and time estimates for a book, from its logged sessions (data/model/ReadingMath.kt).

import type { Book, ReadingSession } from "./model.ts";
import { isAudio } from "./rules.ts";

export function sessionPages(session: ReadingSession): number {
  return Math.max(0, session.endPage - session.startPage);
}

/** Minutes per page: measured from the timed sessions when there are any, else the reader's general speed. */
export function pace(sessions: ReadingSession[], fallback: number): number {
  const timed = sessions.filter((s) => s.minutes > 0 && sessionPages(s) > 0);
  const pages = timed.reduce((sum, s) => sum + sessionPages(s), 0);
  if (pages < 5) return fallback;
  const minutes = timed.reduce((sum, s) => sum + s.minutes, 0);
  return Math.min(15, Math.max(0.2, minutes / pages));
}

/** Estimated minutes left in the book, or null when the length is unknown or it is finished. */
export function minutesLeft(book: Book, sessions: ReadingSession[], fallbackPace: number): number | null {
  if (book.pageCount <= 0 || book.currentPage >= book.pageCount) return null;
  const left = book.pageCount - book.currentPage;
  // An audiobook's "pages" are minutes already.
  return isAudio(book) ? left : Math.round(left * pace(sessions, fallbackPace));
}

export function totalMinutes(sessions: ReadingSession[]): number {
  return Math.round(sessions.reduce((sum, s) => sum + s.minutes, 0));
}

export function totalPages(sessions: ReadingSession[]): number {
  return sessions.reduce((sum, s) => sum + sessionPages(s), 0);
}
