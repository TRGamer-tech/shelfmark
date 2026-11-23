// The cases of InsightsTest in PortedFeaturesTest.kt: calendar, recaps and milestones
// are all views on the same reading history.

import assert from "node:assert/strict";
import { test } from "node:test";
import { utcZone } from "../src/lib/dates.ts";
import { MILESTONE_TIERS, dayAmount, daySummaries, milestone, milestoneTimeline, milestones, recap, timeOfDay } from "../src/lib/insights.ts";
import { at, book, day, purchase, session } from "./helpers.ts";

const paper = book({ id: 1, title: "Paper", authors: "Ann Author", pageCount: 300, status: "READING", genres: "Novel" });
const audio = book({ id: 2, title: "Audio", authors: "Ben Voice", pageCount: 600, format: "AUDIOBOOK", status: "READING" });
const old = book({ id: 3, title: "Old", authors: "Ann Author", pageCount: 520, status: "READ", readCount: 1, finishedOn: day("2024-03-09"), rating: 4.5, genres: "Novel, Classic" });
const short = book({ id: 4, title: "Short", authors: "Cy Third", pageCount: 90, status: "READ", readCount: 1, finishedOn: day("2024-03-10"), rating: 3 });

const sessions = [
  // Saturday and Sunday mornings, plus one weekday evening.
  session({ id: 1, bookId: 1, startedAt: at("2024-03-09", 9), startPage: 0, endPage: 40, minutes: 60 }),
  session({ id: 2, bookId: 1, startedAt: at("2024-03-10", 8), startPage: 40, endPage: 100, minutes: 75 }),
  session({ id: 3, bookId: 2, startedAt: at("2024-03-10", 10), startPage: 0, endPage: 45, minutes: 0 }),
  session({ id: 4, bookId: 1, startedAt: at("2024-03-12", 20), startPage: 100, endPage: 110, minutes: 15 }),
  session({ id: 5, bookId: 4, startedAt: at("2024-03-10", 7), startPage: 0, endPage: 90, minutes: 80 }),
];
const books = [paper, audio, old, short];

test("every day knows what was read and finished", () => {
  const days = daySummaries(books, sessions, utcZone);
  assert.deepEqual(Array.from(days.keys()).sort(), [day("2024-03-09"), day("2024-03-10"), day("2024-03-12")]);
  const saturday = days.get(day("2024-03-09"))!;
  // 40 pages read, and a 520 page book finished that has no sessions of its own.
  assert.equal(saturday.pages, 560);
  assert.equal(saturday.minutes, 60);
  assert.deepEqual(saturday.bookIds.slice().sort(), [1, 3]);
  assert.deepEqual(saturday.finishedIds, [3]);
  const sunday = days.get(day("2024-03-10"))!;
  // Listening counts as time, not as pages. "Short" has a session, so its pages are not counted twice.
  assert.equal(sunday.pages, 150);
  assert.equal(sunday.minutes, 75 + 45 + 80);
  assert.equal(sunday.sessions, 3);
  assert.deepEqual(sunday.finishedIds, [4]);
  assert.equal(days.get(day("2024-03-12"))!.pages, 10);
  assert.equal(dayAmount(saturday), 560);
});

test("a recap tells the story of a month", () => {
  const purchases = [
    purchase({ bookId: 1, day: day("2024-03-05"), price: 24.9, currency: "chf" }),
    purchase({ bookId: 3, day: day("2024-03-20"), price: 12.0, currency: "CHF" }),
    purchase({ bookId: 2, day: day("2024-03-21"), price: 9.99, currency: "EUR" }),
    purchase({ bookId: 4, day: day("2024-04-02"), price: 50.0, currency: "CHF" }),
  ];
  const march = recap(books, sessions, purchases, day("2024-03-01"), day("2024-03-31"), utcZone);
  assert.deepEqual(
    march.finished.map((b) => b.title),
    ["Old", "Short"],
  );
  assert.equal(march.pages, 720);
  assert.equal(march.sessions, 5);
  assert.equal(march.readingDays, 3);
  assert.equal(march.bestStreak, 2);
  assert.equal(march.bestDay!.day, day("2024-03-09"));
  assert.equal(march.bestRated!.title, "Old");
  assert.equal(march.longest!.title, "Old");
  assert.equal(march.averageRating, 3.75);
  assert.deepEqual(march.topAuthors[0], ["Ann Author", 1]);
  assert.deepEqual(
    march.topGenres.find((g) => g[0] === "Novel"),
    ["Novel", 1],
  );
  assert.equal(march.favouriteTime, "MORNING");
  assert.equal(march.favouriteWeekday, 7);
  // Four of five sessions fall on a weekend.
  assert.equal(march.readerType, "WEEKEND_READER");
  assert.ok(Math.abs(march.spent.get("CHF")! - 36.9) < 0.001);
  assert.ok(Math.abs(march.spent.get("EUR")! - 9.99) < 0.001);

  // A month without anything.
  const empty = recap(books, sessions, purchases, day("2023-01-01"), day("2023-01-31"), utcZone);
  assert.equal(empty.readerType, "QUIET_SHELF");
  assert.equal(empty.finished.length, 0);
  assert.equal(empty.bestDay, null);
  assert.equal(empty.spent.size, 0);
});

test("the reader type follows the time of day", () => {
  const typeAt = (hour: number) =>
    recap([paper], [session({ bookId: 1, startedAt: at("2024-03-13", hour), startPage: 0, endPage: 10 })], [], day("2024-03-01"), day("2024-03-31"), utcZone).readerType;
  assert.equal(typeAt(6), "EARLY_BIRD");
  assert.equal(typeAt(14), "AFTERNOON_ESCAPIST");
  assert.equal(typeAt(19), "EVENING_UNWINDER");
  assert.equal(typeAt(23), "NIGHT_OWL");
  assert.equal(typeAt(2), "NIGHT_OWL");
  assert.equal(timeOfDay(5), "MORNING");
  assert.equal(timeOfDay(11), "MORNING");
  assert.equal(timeOfDay(12), "AFTERNOON");
  assert.equal(timeOfDay(17), "EVENING");
  assert.equal(timeOfDay(22), "NIGHT");
});

test("milestones count and remember when they were reached", () => {
  const all = new Map(milestones(books, sessions, 12, day("2024-03-12"), utcZone).map((m) => [m.category, m]));
  const finished = all.get("BOOKS")!;
  assert.equal(finished.value, 2);
  assert.equal(finished.reached, 1);
  assert.equal(finished.next, 10);
  assert.ok(Math.abs(finished.progress - 1 / 9) < 0.001);
  assert.equal(all.get("PAGES")!.value, 720);
  assert.equal(all.get("PAGES")!.reached, 0);
  assert.equal(all.get("SESSIONS")!.value, 5);
  assert.equal(all.get("HOURS")!.value, Math.floor((60 + 75 + 45 + 80 + 15) / 60));
  assert.equal(all.get("QUOTES")!.value, 12);
  assert.equal(all.get("QUOTES")!.reached, 2);
  assert.equal(all.get("STREAK")!.value, 2);
  assert.equal(all.get("LONG_BOOKS")!.value, 1);
  assert.equal(all.get("REVIEWS")!.value, 0);
  assert.equal(all.size, 8);

  const timeline = milestoneTimeline(books);
  assert.equal(timeline.length, 2);
  assert.ok(timeline.every((e) => e.book!.title === "Old" && e.day === day("2024-03-09") && e.tier === 1));
  assert.deepEqual(new Set(timeline.map((e) => e.category)), new Set(["BOOKS", "LONG_BOOKS"]));

  // With every tier passed there is nothing left to aim for.
  const done = milestone("REVIEWS", 500, MILESTONE_TIERS.REVIEWS);
  assert.equal(done.next, null);
  assert.equal(done.progress, 1);
  assert.equal(done.reached, 5);
});
