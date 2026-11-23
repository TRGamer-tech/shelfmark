// The cases of LogicTest.kt that concern the website: the library, the reading pace,
// statistics and goals. (The barcode scanner and the text recognition live on the phone.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { utcZone } from "../src/lib/dates.ts";
import type { LibraryFilter } from "../src/lib/libraryLogic.ts";
import { applyFilter, authorKey, formatPrice, formatRating, nextRating, sortKey } from "../src/lib/libraryLogic.ts";
import type { SortOrder } from "../src/lib/model.ts";
import { minutesLeft, pace, totalMinutes, totalPages } from "../src/lib/readingMath.ts";
import { packRows } from "../src/lib/shelf.ts";
import { computeStats, goalProgress, streaks } from "../src/lib/stats.ts";
import { at, book, day, goal, session } from "./helpers.ts";

// ---- library ----

const books = [
  book({ id: 1, title: "The Hobbit", authors: "J. R. R. Tolkien", status: "READ", rating: 5, addedAt: 10 }),
  book({ id: 2, title: "Der Vorleser", authors: "Bernhard Schlink", status: "READING", rating: 3, addedAt: 30 }),
  book({ id: 3, title: "Emma", authors: "Jane Austen", status: "WISHLIST", ownership: "NOT_OWNED", addedAt: 20 }),
  book({ id: 4, title: "Dune", authors: "Frank Herbert", lentTo: "Ben", addedAt: 40 }),
  book({ id: 5, title: "Momo", authors: "Michael Ende", ownership: "BORROWED", addedAt: 50 }),
];
const links = [
  { bookId: 1, shelfId: 7 },
  { bookId: 4, shelfId: 7 },
];

const titles = (filter: LibraryFilter, query = "", sort: SortOrder = "TITLE") => applyFilter(books, links, filter, query, sort).map((b) => b.title);

test("filters by list, status and ownership", () => {
  assert.deepEqual(titles({ kind: "all" }), ["Dune", "Emma", "The Hobbit", "Momo", "Der Vorleser"]);
  assert.deepEqual(titles({ kind: "status", status: "READ" }), ["The Hobbit"]);
  assert.deepEqual(titles({ kind: "status", status: "WISHLIST" }), ["Emma"]);
  assert.deepEqual(titles({ kind: "shelf", shelfId: 7 }), ["Dune", "The Hobbit"]);
  assert.deepEqual(titles({ kind: "lent" }), ["Dune"]);
  assert.deepEqual(titles({ kind: "borrowed" }), ["Momo"]);
});

test("search matches title and author", () => {
  assert.deepEqual(titles({ kind: "all" }, "schlink"), ["Der Vorleser"]);
  assert.deepEqual(titles({ kind: "all" }, "tolkien hob"), ["The Hobbit"]);
  assert.deepEqual(titles({ kind: "all" }, "xyz"), []);
});

test("sorting ignores articles and uses surnames", () => {
  assert.deepEqual(titles({ kind: "all" }, "", "ADDED"), ["Momo", "Dune", "Der Vorleser", "Emma", "The Hobbit"]);
  assert.deepEqual(titles({ kind: "all" }, "", "AUTHOR"), ["Emma", "Momo", "Dune", "Der Vorleser", "The Hobbit"]);
  assert.equal(titles({ kind: "all" }, "", "RATING")[0], "The Hobbit");
  assert.equal(sortKey("  Das Parfum"), "parfum");
  assert.equal(authorKey("Frank Herbert, Brian Herbert"), "herbert frank herbert");
});

test("spines are packed into rows that fit", () => {
  assert.deepEqual(packRows([40, 40, 40, 40, 40], 130, 2), [
    [0, 2],
    [3, 4],
  ]);
  assert.deepEqual(packRows([200, 200], 130, 2), [
    [0, 0],
    [1, 1],
  ]);
  assert.deepEqual(packRows([], 100, 2), []);
});

test("tapping stars cycles whole, half, clear", () => {
  assert.equal(nextRating(0, 4), 4);
  assert.equal(nextRating(4, 4), 3.5);
  assert.equal(nextRating(3.5, 4), 0);
  assert.equal(nextRating(4, 2), 2);
});

test("ratings and prices are written the way people write them", () => {
  assert.equal(formatRating(4), "4");
  assert.equal(formatRating(4.5, "en"), "4.5");
  assert.equal(formatRating(4.5, "de-CH"), "4.5");
  assert.equal(formatRating(4.5, "de-DE"), "4,5");
  assert.equal(formatPrice(24.9, " CHF ", "en"), "24.90 CHF");
  // Without a currency there is no stray space.
  assert.equal(formatPrice(24.9, "", "en"), "24.90");
});

// ---- reading pace ----

test("time left uses the measured pace when there is one", () => {
  const dune = book({ id: 1, title: "Dune", pageCount: 300, currentPage: 100 });
  // No timed session: the reader's general speed of 1.5 minutes a page.
  assert.equal(minutesLeft(dune, [], 1.5), 300);
  // 40 pages in 80 minutes: 2 minutes a page for this book.
  const timed = [session({ bookId: 1, startPage: 60, endPage: 100, minutes: 80 })];
  assert.equal(minutesLeft(dune, timed, 1.5), 400);
  assert.equal(minutesLeft({ ...dune, currentPage: 300 }, timed, 1.5), null);
  assert.equal(minutesLeft({ ...dune, pageCount: 0 }, timed, 1.5), null);
  // An audiobook's pages are minutes already.
  assert.equal(minutesLeft({ ...dune, format: "AUDIOBOOK" }, timed, 1.5), 200);
  assert.equal(pace([], 1.5), 1.5);
  assert.equal(totalPages(timed), 40);
  assert.equal(totalMinutes(timed), 80);
});

// ---- statistics and goals ----

const statBooks = [
  book({ id: 1, title: "A", authors: "Jane Austen", pageCount: 300, status: "READ", readCount: 1, finishedOn: day("2026-03-10"), rating: 4.5, spice: 2, format: "PAPERBACK", genres: "Classics, Romance" }),
  book({ id: 2, title: "B", authors: "Jane Austen", pageCount: 200, status: "READ", readCount: 1, finishedOn: day("2026-03-20"), rating: 3, format: "HARDCOVER", genres: "Classics" }),
  book({ id: 3, title: "C", authors: "Frank Herbert", pageCount: 600, status: "READING", format: "PAPERBACK" }),
  book({ id: 4, title: "D", authors: "Old One", pageCount: 100, status: "READ", readCount: 1, finishedOn: day("2025-12-01") }),
];
const statSessions = [
  session({ id: 1, bookId: 1, startedAt: at("2026-03-08"), startPage: 0, endPage: 100, minutes: 120 }),
  session({ id: 2, bookId: 1, startedAt: at("2026-03-09"), startPage: 100, endPage: 250, minutes: 0 }),
  session({ id: 3, bookId: 1, startedAt: at("2026-03-10"), startPage: 250, endPage: 300, minutes: 60 }),
  session({ id: 4, bookId: 3, startedAt: at("2026-11-21"), startPage: 0, endPage: 40, minutes: 50 }),
];

test("year statistics count books, pages and time", () => {
  const stats = computeStats(statBooks, statSessions, 3, day("2026-11-22"), utcZone);
  assert.equal(stats.thisYear.booksFinished, 2);
  // Sessions of book 1 (300) and 3 (40), plus book 2 which was ticked off without sessions (200).
  assert.equal(stats.thisYear.pagesRead, 540);
  assert.equal(stats.thisYear.minutesRead, 230);
  assert.equal(stats.thisYear.sessions, 4);
  assert.equal(stats.thisYear.booksPerMonth[2], 2);
  assert.equal(stats.thisYear.pagesPerMonth[2], 500);
  assert.equal(stats.lastYear.booksFinished, 1);
  assert.equal(stats.lastYear.pagesRead, 100);
  assert.equal(stats.averageRating, 3.75);
  assert.deepEqual(stats.topAuthors[0], ["Jane Austen", 2]);
  assert.deepEqual(stats.topGenres[0], ["Classics", 2]);
  assert.deepEqual(stats.byRating, [0, 0, 1, 0, 1]);
  assert.equal(stats.totalBooks, 4);
  assert.equal(stats.read, 3);
  assert.equal(stats.reading, 1);
  assert.equal(stats.quotes, 3);
  assert.equal(stats.averageSpice, 2);
  assert.deepEqual(stats.byFormat, [
    ["PAPERBACK", 2],
    ["HARDCOVER", 1],
  ]);
  // 2026-03-08 was a Sunday, the 9th a Monday, the 10th a Tuesday, the 20th a Friday, 2026-11-21 a Saturday.
  assert.deepEqual(stats.pagesByWeekday, [250, 50, 0, 0, 200, 40, 100]);
});

test("streaks count consecutive days", () => {
  assert.deepEqual(streaks([10, 11, 12], 12), [3, 3]);
  // Nothing read today yet: yesterday's streak still stands.
  assert.deepEqual(streaks([10, 11, 12], 13), [3, 3]);
  // A whole day missed: the current streak is gone, the record stays.
  assert.deepEqual(streaks([10, 11, 12], 14), [0, 3]);
  assert.deepEqual(streaks([1, 2, 3, 4, 9], 9), [1, 4]);
  assert.deepEqual(streaks([], 5), [0, 0]);
});

test("a yearly book goal tracks progress and pace", () => {
  const yearly = goal({ id: 1, kind: "BOOKS", target: 12, repeat: "YEARLY" });
  const progress = goalProgress(yearly, statBooks, statSessions, day("2026-11-22"), utcZone);
  assert.equal(progress.start, day("2026-01-01"));
  assert.equal(progress.end, day("2026-12-31"));
  assert.equal(progress.done, 2);
  assert.equal(progress.daysLeft, 40);
  assert.equal(progress.reached, false);
  // 2 of 12 with the year almost over.
  assert.equal(progress.ahead, false);
  assert.equal(progress.perDay, 0.25);
});

test("page and time goals use their own periods", () => {
  const today = day("2026-11-22"); // a Sunday
  const weekly = goal({ id: 2, kind: "PAGES", target: 30, repeat: "WEEKLY" });
  const week = goalProgress(weekly, statBooks, statSessions, today, utcZone);
  assert.equal(week.start, day("2026-11-16"));
  assert.equal(week.end, day("2026-11-22"));
  assert.equal(week.done, 40);
  assert.equal(week.reached, true);

  const once = goal({ id: 3, kind: "MINUTES", target: 600, startDay: day("2026-03-01"), endDay: day("2026-03-31") });
  const march = goalProgress(once, statBooks, statSessions, today, utcZone);
  assert.equal(march.done, 180);
  assert.equal(march.daysLeft, 0);
  assert.equal(march.perDay, null);

  const daily = goal({ id: 4, kind: "PAGES", target: 20, repeat: "DAILY" });
  assert.equal(goalProgress(daily, statBooks, statSessions, today, utcZone).done, 0);
  assert.equal(goalProgress(daily, statBooks, statSessions, day("2026-11-21"), utcZone).done, 40);

  const monthly = goal({ id: 5, kind: "BOOKS", target: 2, repeat: "MONTHLY" });
  const month = goalProgress(monthly, statBooks, statSessions, day("2026-03-15"), utcZone);
  assert.equal(month.start, day("2026-03-01"));
  assert.equal(month.end, day("2026-03-31"));
  assert.equal(month.done, 2);
  assert.equal(month.fraction, 1);
});
