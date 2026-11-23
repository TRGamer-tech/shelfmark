// The calendar, the recaps and the milestones: all views on the same reading history
// (data/stats/Insights.kt).

import type { Book, Purchase, ReadingSession } from "./model.ts";
import type { Zone } from "./dates.ts";
import { dayOf, localZone } from "./dates.ts";
import { authorList, genreList, isAudio } from "./rules.ts";
import { sessionPages } from "./readingMath.ts";
import { ranking, streaks } from "./stats.ts";
import type { Ranked } from "./stats.ts";

/** Everything that happened on one day. */
export interface DaySummary {
  day: number;
  pages: number;
  minutes: number;
  sessions: number;
  /** Books read in on this day. */
  bookIds: number[];
  /** Books finished on this day. */
  finishedIds: number[];
}

/** What the calendar colours by: pages, or minutes for a day of only listening. */
export function dayAmount(summary: DaySummary): number {
  return summary.pages > 0 ? summary.pages : summary.minutes;
}

export type TimeOfDay = "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT";

/** A light-hearted label for when someone reads most. */
export type ReaderType = "QUIET_SHELF" | "WEEKEND_READER" | "EARLY_BIRD" | "AFTERNOON_ESCAPIST" | "EVENING_UNWINDER" | "NIGHT_OWL";

/** The story of a month or a year. */
export interface Recap {
  from: number;
  to: number;
  finished: Book[];
  pages: number;
  minutes: number;
  sessions: number;
  readingDays: number;
  bestStreak: number;
  bestDay: DaySummary | null;
  averageRating: number;
  bestRated: Book | null;
  longest: Book | null;
  topAuthors: Ranked[];
  topGenres: Ranked[];
  /** 1 = Monday to 7 = Sunday. */
  favouriteWeekday: number | null;
  favouriteTime: TimeOfDay | null;
  readerType: ReaderType;
  /** Money spent on books in the period, per currency. */
  spent: Map<string, number>;
}

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour <= 11) return "MORNING";
  if (hour >= 12 && hour <= 16) return "AFTERNOON";
  if (hour >= 17 && hour <= 21) return "EVENING";
  return "NIGHT";
}

const finishedOnce = (book: Book) => book.status === "READ" || book.readCount > 0;

const addOnce = (ids: number[], id: number) => (ids.includes(id) ? ids : [...ids, id]);

/**
 * One entry per day on which something was read or finished. A finished book without
 * any session counts with all its pages on the day it was finished.
 */
export function daySummaries(books: Book[], sessions: ReadingSession[], zone: Zone = localZone): Map<number, DaySummary> {
  const byId = new Map(books.map((b) => [b.id, b]));
  const out = new Map<number, DaySummary>();
  const withSessions = new Set<number>();
  const at = (day: number): DaySummary => out.get(day) ?? { day, pages: 0, minutes: 0, sessions: 0, bookIds: [], finishedIds: [] };
  for (const session of sessions) {
    const book = byId.get(session.bookId);
    if (!book) continue;
    withSessions.add(book.id);
    const day = dayOf(session.startedAt, zone);
    const audio = isAudio(book);
    const current = at(day);
    out.set(day, {
      ...current,
      pages: current.pages + (audio ? 0 : sessionPages(session)),
      minutes: current.minutes + (audio && session.minutes <= 0 ? sessionPages(session) : Math.round(session.minutes)),
      sessions: current.sessions + 1,
      bookIds: addOnce(current.bookIds, book.id),
    });
  }
  for (const book of books) {
    if (book.finishedOn === null) continue;
    if (!finishedOnce(book)) continue;
    const current = at(book.finishedOn);
    const counted = !withSessions.has(book.id) && book.pageCount > 0;
    out.set(book.finishedOn, {
      ...current,
      pages: current.pages + (counted && !isAudio(book) ? book.pageCount : 0),
      minutes: current.minutes + (counted && isAudio(book) ? book.pageCount : 0),
      bookIds: addOnce(current.bookIds, book.id),
      finishedIds: addOnce(current.finishedIds, book.id),
    });
  }
  return out;
}

/** The first entry with the largest value, as maxByOrNull in the app. */
function maxBy<T>(items: T[], value: (item: T) => number): T | null {
  let best: T | null = null;
  let bestValue = -Infinity;
  for (const item of items) {
    const v = value(item);
    if (best === null || v > bestValue) {
      best = item;
      bestValue = v;
    }
  }
  return best;
}

export function recap(books: Book[], sessions: ReadingSession[], purchases: Purchase[], from: number, to: number, zone: Zone = localZone): Recap {
  const inRangeDay = (day: number) => day >= from && day <= to;
  // In the order of the calendar, so that of two equally good days the earlier one is the best day.
  const days = Array.from(daySummaries(books, sessions, zone).values())
    .filter((d) => inRangeDay(d.day))
    .sort((a, b) => a.day - b.day);
  const finished = books
    .filter((b) => b.finishedOn !== null && inRangeDay(b.finishedOn) && finishedOnce(b))
    .sort((a, b) => (a.finishedOn ?? 0) - (b.finishedOn ?? 0));
  const inRange = sessions.filter((s) => inRangeDay(dayOf(s.startedAt, zone)));
  // Counted in the order the sessions come, so that a tie goes to whatever was seen first.
  const byTime = new Map<TimeOfDay, number>();
  const byWeekday = new Map<number, number>();
  for (const session of inRange) {
    const parts = zone.parts(session.startedAt);
    const time = timeOfDay(parts.hour);
    byTime.set(time, (byTime.get(time) ?? 0) + 1);
    byWeekday.set(parts.weekday, (byWeekday.get(parts.weekday) ?? 0) + 1);
  }
  const favouriteTime = maxBy(Array.from(byTime.entries()), (e) => e[1])?.[0] ?? null;
  const favouriteWeekday = maxBy(Array.from(byWeekday.entries()), (e) => e[1])?.[0] ?? null;
  const weekend = (byWeekday.get(6) ?? 0) + (byWeekday.get(7) ?? 0);
  const rated = finished.filter((b) => b.rating > 0);
  // The best rating wins, and among equals the one finished last.
  let bestRated: Book | null = null;
  for (const book of rated) {
    if (bestRated === null || book.rating > bestRated.rating || (book.rating === bestRated.rating && (book.finishedOn ?? 0) > (bestRated.finishedOn ?? 0))) {
      bestRated = book;
    }
  }
  const spent = new Map<string, number>();
  for (const purchase of purchases) {
    if (!inRangeDay(purchase.day) || !(purchase.price > 0)) continue;
    const currency = purchase.currency.trim().toUpperCase();
    spent.set(currency, (spent.get(currency) ?? 0) + purchase.price);
  }
  let readerType: ReaderType;
  if (inRange.length === 0) readerType = "QUIET_SHELF";
  else if (weekend * 7 > inRange.length * 4) readerType = "WEEKEND_READER";
  else if (favouriteTime === "MORNING") readerType = "EARLY_BIRD";
  else if (favouriteTime === "AFTERNOON") readerType = "AFTERNOON_ESCAPIST";
  else if (favouriteTime === "EVENING") readerType = "EVENING_UNWINDER";
  else readerType = "NIGHT_OWL";
  return {
    from,
    to,
    finished,
    pages: days.reduce((sum, d) => sum + d.pages, 0),
    minutes: days.reduce((sum, d) => sum + d.minutes, 0),
    sessions: inRange.length,
    readingDays: days.length,
    bestStreak: streaks(
      days.map((d) => d.day),
      to,
    )[1],
    bestDay: maxBy(
      days.filter((d) => dayAmount(d) > 0),
      dayAmount,
    ),
    averageRating: rated.length === 0 ? 0 : rated.reduce((sum, b) => sum + b.rating, 0) / rated.length,
    bestRated,
    longest: maxBy(
      finished.filter((b) => b.pageCount > 0 && !isAudio(b)),
      (b) => b.pageCount,
    ),
    topAuthors: ranking(
      finished.flatMap((b) => authorList(b.authors)),
      5,
    ),
    topGenres: ranking(
      finished.flatMap((b) => genreList(b)),
      5,
    ),
    favouriteWeekday,
    favouriteTime,
    readerType,
    spent,
  };
}

export type MilestoneCategory = "BOOKS" | "PAGES" | "SESSIONS" | "HOURS" | "REVIEWS" | "QUOTES" | "STREAK" | "LONG_BOOKS";

export const MILESTONE_CATEGORIES: MilestoneCategory[] = ["BOOKS", "PAGES", "SESSIONS", "HOURS", "REVIEWS", "QUOTES", "STREAK", "LONG_BOOKS"];

/** A book counts as long from this many pages. */
export const LONG_BOOK_PAGES = 500;

export const MILESTONE_TIERS: Record<MilestoneCategory, number[]> = {
  BOOKS: [1, 10, 25, 50, 100, 250, 500],
  PAGES: [1_000, 5_000, 10_000, 25_000, 50_000, 100_000],
  SESSIONS: [10, 50, 100, 500, 1_000],
  HOURS: [10, 50, 100, 250, 500, 1_000],
  REVIEWS: [1, 10, 25, 50, 100],
  QUOTES: [1, 10, 25, 50, 100, 250],
  STREAK: [3, 7, 14, 30, 100, 365],
  LONG_BOOKS: [1, 5, 10, 25, 50],
};

export interface Milestone {
  category: MilestoneCategory;
  value: number;
  tiers: number[];
  /** How many tiers have been passed. */
  reached: number;
  /** The next tier to aim for, or null when all are done. */
  next: number | null;
  /** Progress from the last tier passed towards the next one, 0 to 1. */
  progress: number;
}

export function milestone(category: MilestoneCategory, value: number, tiers: number[] = MILESTONE_TIERS[category]): Milestone {
  const next = tiers.find((tier) => value < tier) ?? null;
  const passed = tiers.filter((tier) => value >= tier);
  const base = passed.length > 0 ? passed[passed.length - 1] : 0;
  const progress = next === null ? 1 : Math.min(1, Math.max(0, (value - base) / (next - base)));
  return { category, value, tiers, reached: passed.length, next, progress };
}

export function milestones(books: Book[], sessions: ReadingSession[], quoteCount: number, today: number, zone: Zone = localZone): Milestone[] {
  const days = Array.from(daySummaries(books, sessions, zone).values());
  const finished = books.filter(finishedOnce);
  const values: Record<MilestoneCategory, number> = {
    BOOKS: finished.length,
    PAGES: days.reduce((sum, d) => sum + d.pages, 0),
    SESSIONS: sessions.length,
    HOURS: Math.floor(days.reduce((sum, d) => sum + d.minutes, 0) / 60),
    REVIEWS: books.filter((b) => b.review.trim() !== "").length,
    QUOTES: quoteCount,
    STREAK: streaks(
      days.map((d) => d.day),
      today,
    )[1],
    LONG_BOOKS: finished.filter((b) => !isAudio(b) && b.pageCount >= LONG_BOOK_PAGES).length,
  };
  return MILESTONE_CATEGORIES.map((category) => milestone(category, values[category]));
}

/** A dated moment worth remembering, e.g. the day the tenth book was finished. */
export interface MilestoneEvent {
  day: number;
  category: MilestoneCategory;
  tier: number;
  book: Book | null;
}

/** When each book-count tier was reached, newest first. */
export function milestoneTimeline(books: Book[]): MilestoneEvent[] {
  const finished = books.filter((b) => b.finishedOn !== null && finishedOnce(b)).sort((a, b) => (a.finishedOn ?? 0) - (b.finishedOn ?? 0));
  const events: MilestoneEvent[] = [];
  for (const tier of MILESTONE_TIERS.BOOKS) {
    const book = finished[tier - 1];
    if (book) events.push({ day: book.finishedOn as number, category: "BOOKS", tier, book });
  }
  const long = finished.filter((b) => !isAudio(b) && b.pageCount >= LONG_BOOK_PAGES);
  for (const tier of MILESTONE_TIERS.LONG_BOOKS) {
    const book = long[tier - 1];
    if (book) events.push({ day: book.finishedOn as number, category: "LONG_BOOKS", tier, book });
  }
  return events.sort((a, b) => b.day - a.day);
}
