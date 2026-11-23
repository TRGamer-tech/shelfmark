// The cases of BookRulesTest.kt, and what logging a session does to a book.

import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyVault } from "../src/lib/model.ts";
import { logSession } from "../src/lib/mutations.ts";
import { availableToLend, progressOf, withDefaultsFor, withStatus } from "../src/lib/rules.ts";
import { book as makeBook, session } from "./helpers.ts";

const book = makeBook({ title: "Dune", pageCount: 600 });

test("starting stamps the start date", () => {
  const reading = withStatus(book, "READING", 100);
  assert.equal(reading.startedOn, 100);
  assert.equal(reading.finishedOn, null);
});

test("finishing stamps the end date and fills the progress", () => {
  const read = withStatus(withStatus(book, "READING", 100), "READ", 120);
  assert.equal(read.startedOn, 100);
  assert.equal(read.finishedOn, 120);
  assert.equal(read.currentPage, 600);
  assert.equal(progressOf(read), 1);
});

test("dates the reader entered are kept", () => {
  const read = withStatus({ ...book, startedOn: 5, finishedOn: 9 }, "READ", 120);
  assert.equal(read.startedOn, 5);
  assert.equal(read.finishedOn, 9);
});

test("re-reading starts over and counts the second read", () => {
  const first = withStatus({ ...book, startedOn: 5 }, "READ", 9);
  assert.equal(first.readCount, 1);
  const again = withStatus(first, "READING", 200);
  assert.equal(again.startedOn, 200);
  assert.equal(again.finishedOn, null);
  assert.equal(again.currentPage, 0);
  assert.equal(withStatus(again, "READ", 230).readCount, 2);
});

test("the same status again changes nothing", () => {
  const read = withStatus(book, "READ", 9);
  assert.equal(withStatus(read, "READ", 50), read);
});

test("the other lists leave dates and pages alone", () => {
  const reading = { ...withStatus(book, "READING", 100), currentPage: 80 };
  for (const status of ["ABANDONED", "WISHLIST", "NONE"] as const) {
    const moved = withStatus(reading, status, 150);
    assert.equal(moved.status, status);
    assert.equal(moved.startedOn, 100);
    assert.equal(moved.currentPage, 80);
    assert.equal(moved.readCount, 0);
  }
});

test("wishlist books are not owned", () => {
  assert.equal(withDefaultsFor(book, "WISHLIST", 1).ownership, "NOT_OWNED");
  assert.equal(withDefaultsFor(book, "READING", 1).ownership, "OWNED");
});

test("only physical owned books that are not on loan can be lent", () => {
  assert.equal(availableToLend(withDefaultsFor(book, "NONE", 1)), true);
  assert.equal(availableToLend(withDefaultsFor({ ...book, format: "EBOOK" }, "NONE", 1)), false);
  assert.equal(availableToLend({ ...book, ownership: "BORROWED" }), false);
  assert.equal(availableToLend({ ...book, lentTo: "Anna" }), false);
  assert.equal(availableToLend(withDefaultsFor(book, "WISHLIST", 1)), false);
});

test("progress needs a length and a bookmark", () => {
  assert.equal(progressOf(book), null);
  assert.equal(progressOf({ ...book, currentPage: 150 }), 0.25);
  assert.equal(progressOf({ ...book, pageCount: 0, currentPage: 150 }), null);
  assert.equal(progressOf({ ...book, currentPage: 900 }), 1);
});

test("logging a session moves the book along", () => {
  const start = { ...emptyVault(), books: [{ ...book, id: 1 }] };
  // An unstarted book counts as being read from the first session on.
  const first = logSession(session({ id: 11, bookId: 1, startPage: 0, endPage: 120, minutes: 90 }), 500, 1)(start);
  assert.equal(first.books[0].status, "READING");
  assert.equal(first.books[0].startedOn, 500);
  assert.equal(first.books[0].currentPage, 120);
  assert.equal(first.sessions.length, 1);
  // The bookmark never goes backwards.
  const back = logSession(session({ id: 12, bookId: 1, startPage: 10, endPage: 60 }), 501, 2)(first);
  assert.equal(back.books[0].currentPage, 120);
  // Reaching the last page finishes the book.
  const done = logSession(session({ id: 13, bookId: 1, startPage: 120, endPage: 600 }), 510, 3)(back);
  assert.equal(done.books[0].status, "READ");
  assert.equal(done.books[0].finishedOn, 510);
  assert.equal(done.books[0].readCount, 1);
  assert.equal(done.books[0].updatedAt, 3);
  assert.equal(done.sessions.length, 3);
});

test("a session that is applied twice counts once", () => {
  // This happens when somebody else saved in between and the change is applied again.
  const start = { ...emptyVault(), books: [{ ...book, id: 1 }] };
  const change = logSession(session({ id: 13, bookId: 1, startPage: 0, endPage: 600 }), 510, 3);
  const twice = change(change(start));
  assert.equal(twice.sessions.length, 1);
  assert.equal(twice.books[0].readCount, 1);
  assert.equal(twice.books[0].status, "READ");
});

test("a session in a finished book does not finish it again", () => {
  const read = withStatus({ ...book, id: 1 }, "READ", 9);
  const after = logSession(session({ id: 20, bookId: 1, startPage: 0, endPage: 600 }), 600, 5)({ ...emptyVault(), books: [read] });
  assert.equal(after.books[0].readCount, 1);
  assert.equal(after.books[0].finishedOn, 9);
});
