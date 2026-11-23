// Statistics and goals (data/stats/Stats.kt).

import type { Book, BookFormat, Goal, ReadingSession } from "./model.ts";
import type { Zone } from "./dates.ts";
import { dayOf, daysInMonth, fromEpochDay, isLeapYear, localZone, toEpochDay, weekdayOf } from "./dates.ts";
import { authorList, genreList, isAudio } from "./rules.ts";
import { sessionPages } from "./readingMath.ts";

export interface YearStats {
  year: number;
  booksFinished: number;
  pagesRead: number;
  minutesRead: number;
  sessions: number;
  /** Index 0 is January. */
  booksPerMonth: number[];
  pagesPerMonth: number[];
}

export type Ranked<T = string> = [T, number];

export interface LibraryStats {
  totalBooks: number;
  read: number;
  reading: number;
  unread: number;
  wishlist: number;
  abandoned: number;
  averageRating: number;
  averageSpice: number;
  quotes: number;
  currentStreak: number;
  bestStreak: number;
  byFormat: Ranked<BookFormat>[];
  /** Index 0 counts books rated up to one star, index 4 those above four. */
  byRating: number[];
  topAuthors: Ranked[];
  topGenres: Ranked[];
  /** Pages read per weekday, Monday first. */
  pagesByWeekday: number[];
  thisYear: YearStats;
  lastYear: YearStats;
}

/** One day's amount of reading, the common currency of statistics and goals. */
interface DayAmount {
  day: number;
  pages: number;
  minutes: number;
}

const finishedOnce = (book: Book) => book.status === "READ" || book.readCount > 0;

const average = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

/** Counts how often each name occurs, most frequent first, ties by name. */
export function ranking(names: string[], take: number): Ranked[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, take);
}

/**
 * Pages and minutes per day. Logged sessions count on their day. A finished book without
 * any session counts with all its pages on the day it was finished, so people who only
 * tick books off still get page totals.
 */
function dayAmounts(books: Book[], sessions: ReadingSession[], zone: Zone): DayAmount[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const withSessions = new Set(sessions.map((s) => s.bookId));
  const out: DayAmount[] = [];
  for (const session of sessions) {
    const book = byId.get(session.bookId);
    if (!book) continue;
    const audio = isAudio(book);
    out.push({
      day: dayOf(session.startedAt, zone),
      pages: audio ? 0 : sessionPages(session),
      // An audiobook's positions are minutes, so listening time is the distance covered.
      minutes: audio && session.minutes <= 0 ? sessionPages(session) : Math.round(session.minutes),
    });
  }
  for (const book of books) {
    if (book.finishedOn === null) continue;
    if (withSessions.has(book.id) || book.pageCount <= 0 || book.status !== "READ") continue;
    out.push(isAudio(book) ? { day: book.finishedOn, pages: 0, minutes: book.pageCount } : { day: book.finishedOn, pages: book.pageCount, minutes: 0 });
  }
  return out;
}

function yearStats(year: number, books: Book[], sessions: ReadingSession[], amounts: DayAmount[], zone: Zone): YearStats {
  const booksPerMonth = new Array<number>(12).fill(0);
  const pagesPerMonth = new Array<number>(12).fill(0);
  for (const book of books) {
    if (book.finishedOn === null) continue;
    const day = fromEpochDay(book.finishedOn);
    if (day.year === year && finishedOnce(book)) booksPerMonth[day.month - 1]++;
  }
  let minutes = 0;
  for (const amount of amounts) {
    const day = fromEpochDay(amount.day);
    if (day.year === year) {
      pagesPerMonth[day.month - 1] += amount.pages;
      minutes += amount.minutes;
    }
  }
  return {
    year,
    booksFinished: booksPerMonth.reduce((a, b) => a + b, 0),
    pagesRead: pagesPerMonth.reduce((a, b) => a + b, 0),
    minutesRead: minutes,
    sessions: sessions.filter((s) => zone.parts(s.startedAt).year === year).length,
    booksPerMonth,
    pagesPerMonth,
  };
}

/**
 * Current and best run of consecutive reading days. The current streak still counts
 * when today has no reading yet, it only breaks once a whole day was missed.
 */
export function streaks(days: Iterable<number>, today: number): [number, number] {
  const set = new Set(days);
  if (set.size === 0) return [0, 0];
  const sorted = Array.from(set).sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  let current = 0;
  let day = set.has(today) ? today : today - 1;
  while (set.has(day)) {
    current++;
    day--;
  }
  return [current, best];
}

export function computeStats(books: Book[], sessions: ReadingSession[], quoteCount: number, today: number, zone: Zone = localZone): LibraryStats {
  const amounts = dayAmounts(books, sessions, zone);
  const finished = books.filter((b) => b.readCount > 0 || b.status === "READ");
  const rated = books.filter((b) => b.rating > 0);
  const spiced = books.filter((b) => b.spice > 0);
  const days = new Set<number>(amounts.map((a) => a.day));
  for (const book of finished) if (book.finishedOn !== null) days.add(book.finishedOn);
  const [current, best] = streaks(days, today);
  const weekday = new Array<number>(7).fill(0);
  for (const amount of amounts) weekday[weekdayOf(amount.day) - 1] += amount.pages;
  const formats = new Map<BookFormat, number>();
  for (const book of books) if (book.format !== "UNKNOWN") formats.set(book.format, (formats.get(book.format) ?? 0) + 1);
  const year = fromEpochDay(today).year;
  return {
    totalBooks: books.length,
    read: books.filter((b) => b.status === "READ").length,
    reading: books.filter((b) => b.status === "READING").length,
    unread: books.filter((b) => b.status === "NONE").length,
    wishlist: books.filter((b) => b.status === "WISHLIST").length,
    abandoned: books.filter((b) => b.status === "ABANDONED").length,
    averageRating: average(rated.map((b) => b.rating)),
    averageSpice: average(spiced.map((b) => b.spice)),
    quotes: quoteCount,
    currentStreak: current,
    bestStreak: best,
    byFormat: Array.from(formats.entries()).sort((a, b) => b[1] - a[1]),
    byRating: [1, 2, 3, 4, 5].map((star) => rated.filter((b) => b.rating > star - 1 && b.rating <= star).length),
    topAuthors: ranking(
      finished.flatMap((b) => authorList(b.authors)),
      5,
    ),
    topGenres: ranking(
      books.flatMap((b) => genreList(b)),
      6,
    ),
    pagesByWeekday: weekday,
    thisYear: yearStats(year, books, sessions, amounts, zone),
    lastYear: yearStats(year - 1, books, sessions, amounts, zone),
  };
}

/** Amount done towards [goal] between two days (both included). */
export function goalDone(goal: Goal, books: Book[], sessions: ReadingSession[], start: number, end: number, zone: Zone): number {
  const inRange = (day: number) => day >= start && day <= end;
  switch (goal.kind) {
    case "PAGES":
      return dayAmounts(books, sessions, zone)
        .filter((a) => inRange(a.day))
        .reduce((sum, a) => sum + a.pages, 0);
    case "MINUTES":
      return dayAmounts(books, sessions, zone)
        .filter((a) => inRange(a.day))
        .reduce((sum, a) => sum + a.minutes, 0);
    default:
      return books.filter((b) => b.finishedOn !== null && inRange(b.finishedOn) && finishedOnce(b)).length;
  }
}

export interface GoalProgress {
  goal: Goal;
  /** The period that counts right now, as epoch days. */
  start: number;
  end: number;
  done: number;
  daysLeft: number;
  /** Share of the period that has passed, 0 to 1. */
  timeFraction: number;
  fraction: number;
  reached: boolean;
  ahead: boolean;
  remaining: number;
  /** How much per remaining day is needed to get there, or null when the period is over. */
  perDay: number | null;
}

/** The current period of a goal: its own dates, or the running day, week, month or year. */
export function goalWindow(goal: Goal, today: number): [number, number] {
  const { year, month } = fromEpochDay(today);
  switch (goal.repeat) {
    case "DAILY":
      return [today, today];
    case "WEEKLY": {
      const monday = today - (weekdayOf(today) - 1);
      return [monday, monday + 6];
    }
    case "MONTHLY":
      return [toEpochDay(year, month, 1), toEpochDay(year, month, daysInMonth(year, month))];
    case "YEARLY":
      return [toEpochDay(year, 1, 1), toEpochDay(year, 12, 31)];
    default:
      return [goal.startDay, goal.endDay];
  }
}

export function goalProgress(goal: Goal, books: Book[], sessions: ReadingSession[], today: number, zone: Zone = localZone): GoalProgress {
  const [start, end] = goalWindow(goal, today);
  const total = Math.max(1, end - start + 1);
  const elapsed = Math.min(total, Math.max(0, today - start + 1));
  const done = goalDone(goal, books, sessions, start, end, zone);
  // Today still counts as a day to read on.
  const daysLeft = Math.max(0, end - today + 1);
  const timeFraction = elapsed / total;
  const fraction = goal.target <= 0 ? 0 : Math.min(1, Math.max(0, done / goal.target));
  const reached = done >= goal.target;
  const remaining = Math.max(0, goal.target - done);
  return {
    goal,
    start,
    end,
    done,
    daysLeft,
    timeFraction,
    fraction,
    reached,
    ahead: fraction >= timeFraction,
    remaining,
    perDay: reached || daysLeft <= 0 ? null : remaining / daysLeft,
  };
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}
