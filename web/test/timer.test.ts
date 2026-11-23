// The reading timer: what the stopwatch counts, and what is kept of it in the browser.

import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsedSeconds, formatClock, isRunning, minutesOf, readTimer, ringDegrees, toggled, writeTimer } from "../src/lib/timer.ts";

const T0 = 1_760_000_000_000;

test("the clock reads hours, minutes and seconds", () => {
  assert.equal(formatClock(0), "00:00:00");
  assert.equal(formatClock(59), "00:00:59");
  assert.equal(formatClock(60), "00:01:00");
  assert.equal(formatClock(3909), "01:05:09");
  assert.equal(formatClock(36_000), "10:00:00");
  assert.equal(formatClock(-5), "00:00:00");
});

test("starting, pausing and going on", () => {
  // Started on page 40 of book 7.
  const started = toggled(null, 7, 40, T0);
  assert.deepEqual(started, { bookId: 7, runningSince: T0, accumulatedSeconds: 0, startedAt: T0, startPage: 40 });
  assert.equal(isRunning(started), true);
  assert.equal(elapsedSeconds(started, T0), 0);
  assert.equal(elapsedSeconds(started, T0 + 90_500), 90);

  // Paused after a minute and a half: the clock stands still from then on.
  const paused = toggled(started, 7, 55, T0 + 90_500);
  assert.equal(isRunning(paused), false);
  assert.equal(paused.runningSince, null);
  assert.equal(paused.accumulatedSeconds, 90);
  assert.equal(elapsedSeconds(paused, T0 + 500_000), 90);
  // The start of the session and the page it began on stay what they were.
  assert.equal(paused.startedAt, T0);
  assert.equal(paused.startPage, 40);

  // Going on ten minutes later adds to what was counted, the break is not reading time.
  const again = toggled(paused, 7, 55, T0 + 700_000);
  assert.equal(isRunning(again), true);
  assert.equal(again.accumulatedSeconds, 90);
  assert.equal(elapsedSeconds(again, T0 + 700_000 + 30_000), 120);
  assert.equal(again.startedAt, T0);
});

test("a timer for another book is replaced by a new one, there is only one at a time", () => {
  const first = toggled(null, 7, 0, T0);
  const second = toggled(first, 8, 12, T0 + 5000);
  assert.deepEqual(second, { bookId: 8, runningSince: T0 + 5000, accumulatedSeconds: 0, startedAt: T0 + 5000, startPage: 12 });
});

test("a clock that was set back does not make the timer run backwards", () => {
  const started = toggled(null, 7, 0, T0);
  assert.equal(elapsedSeconds(started, T0 - 60_000), 0);
  assert.equal(isRunning(null), false);
});

test("the minutes of the session are what the clock shows, rounded, at least one", () => {
  assert.equal(minutesOf(1), 1);
  assert.equal(minutesOf(29), 1);
  assert.equal(minutesOf(89), 1);
  assert.equal(minutesOf(90), 2);
  assert.equal(minutesOf(25 * 60 + 10), 25);
  assert.equal(minutesOf(3 * 3600), 180);
});

test("the ring goes round once a minute", () => {
  assert.equal(ringDegrees(0), 0);
  assert.equal(ringDegrees(15), 90);
  assert.equal(ringDegrees(59), 354);
  assert.equal(ringDegrees(60), 0);
  assert.equal(ringDegrees(75), 90);
});

test("a timer survives being written down and read again", () => {
  const running = toggled(null, 1_760_000_000_000_123, 40, T0);
  assert.deepEqual(readTimer(writeTimer(running)), running);
  const paused = toggled(running, running.bookId, 40, T0 + 61_000);
  assert.deepEqual(readTimer(writeTimer(paused)), paused);
});

test("what is no timer is read as none", () => {
  assert.equal(readTimer(null), null);
  assert.equal(readTimer(""), null);
  assert.equal(readTimer("not json"), null);
  assert.equal(readTimer("null"), null);
  assert.equal(readTimer("[1,2]"), null);
  assert.equal(readTimer('{"bookId":"7","runningSince":1,"accumulatedSeconds":0,"startedAt":1}'), null);
  assert.equal(readTimer('{"bookId":7,"runningSince":"now","accumulatedSeconds":0,"startedAt":1}'), null);
  assert.equal(readTimer('{"bookId":7,"runningSince":null,"accumulatedSeconds":0}'), null);
  // What can be mended is mended: a missing total or page counts as none.
  assert.deepEqual(readTimer('{"bookId":7,"runningSince":null,"startedAt":5}'), { bookId: 7, runningSince: null, accumulatedSeconds: 0, startedAt: 5, startPage: 0 });
  assert.deepEqual(readTimer('{"bookId":7,"runningSince":9,"accumulatedSeconds":-4,"startedAt":5,"startPage":-1}'), { bookId: 7, runningSince: 9, accumulatedSeconds: 0, startedAt: 5, startPage: 0 });
});
