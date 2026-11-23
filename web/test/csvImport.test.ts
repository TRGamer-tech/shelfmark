// Lists of books from other apps. The cases are those of CsvImportTest and of
// importAddsNewBooksAndCompletesKnownOnes in the app's PortedFeaturesTest.kt, on the
// same two files, so that the phone and the website read a list the same way.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CsvTable,
  GENERIC,
  GOODREADS,
  STORYGRAPH,
  applyImport,
  decodeText,
  fillGaps,
  importDay,
  importIdsFor,
  isZip,
  parseCsv,
  parseImport,
  previewImport,
  sameBook,
  splitSeries,
  statusOf,
} from "../src/lib/csvImport.ts";
import { toEpochDay, utcNoon } from "../src/lib/dates.ts";
import { emptyVault, readVault, writeVault } from "../src/lib/model.ts";
import type { Vault } from "../src/lib/model.ts";
import { addBook, booksWithoutCover, createShelf, fillCovers, importBooks } from "../src/lib/mutations.ts";
import { book as makeBook, day, fixture } from "./helpers.ts";

const NOW = 1_760_000_000_000;
const UTC = { now: NOW, noon: utcNoon };

test("the two lists are the ones the app is tested with", () => {
  // In the repository they live with the app's tests. The website keeps copies so that
  // it can be built and tested from its own folder alone.
  for (const name of ["goodreads_export.csv", "storygraph_export.csv"]) {
    const original = fileURLToPath(new URL(`../../app/src/test/resources/fixtures/${name}`, import.meta.url));
    if (!existsSync(original)) continue;
    assert.equal(fixture(name), readFileSync(original, "utf8"), `test/fixtures/${name} is out of date`);
  }
});

test("csv fields may hold commas, quotes and line breaks", () => {
  const rows = parseCsv('﻿a,b,c\r\n"one, two","say ""hi""","line\nbreak"\r\n\r\n3,4,5');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["one, two", 'say "hi"', "line\nbreak"],
    ["3", "4", "5"],
  ]);
  // Spreadsheets in German-speaking countries save with semicolons.
  assert.deepEqual(parseCsv('Titel;Autor\nMomo;"Ende, Michael"'), [
    ["Titel", "Autor"],
    ["Momo", "Ende, Michael"],
  ]);
  // Tabs, old Mac line ends, and nothing at all.
  assert.deepEqual(parseCsv("title\tauthor\rDune\tFrank Herbert\r"), [
    ["title", "author"],
    ["Dune", "Frank Herbert"],
  ]);
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n\n  \n"), []);
});

test("columns are found by name, whatever their case or order", () => {
  const table = new CsvTable(parseCsv(" Title , ISBN13,ISBN,Extra\nDune,,0441172717,x\n"));
  assert.equal(table.has("title"), true);
  assert.equal(table.has("nothing", "isbn"), true);
  assert.equal(table.has("author"), false);
  const [row] = table.rows;
  assert.equal(table.get(row, "title"), "Dune");
  // The first of the names that has something in this row.
  assert.equal(table.get(row, "isbn13", "isbn"), "0441172717");
  assert.equal(table.get(row, "author", "writer"), "");
  // What was asked for and is there counts as understood, spelled as the file spells it.
  assert.deepEqual(table.columns(), { recognised: ["Title", "ISBN13", "ISBN"], ignored: ["Extra"] });
});

test("a Goodreads export is understood", () => {
  const plan = parseImport(fixture("goodreads_export.csv"), UTC);
  assert.ok(plan);
  assert.equal(plan.source, GOODREADS);
  assert.deepEqual(
    plan.books.map((p) => p.book.title),
    ["Dune", "Der Vorleser", "Momo"],
  );

  const dune = plan.books[0];
  assert.equal(dune.book.authors, "Frank Herbert");
  assert.equal(dune.book.isbn, "9780441172719");
  assert.equal(dune.book.status, "READ");
  assert.equal(dune.book.rating, 5);
  assert.equal(dune.book.pageCount, 896);
  assert.equal(dune.book.currentPage, 896);
  assert.equal(dune.book.format, "PAPERBACK");
  assert.equal(dune.book.publishedYear, "1965");
  assert.equal(dune.book.finishedOn, day("2024-03-02"));
  assert.equal(dune.book.readCount, 2);
  assert.equal(dune.book.review, "Sand. So much sand.\nWould read again.");
  // Goodreads writes the series into the title.
  assert.equal(dune.book.series, "Dune");
  assert.equal(dune.book.seriesPosition, 1);
  assert.equal(dune.book.ownership, "OWNED");
  assert.equal(dune.book.publisher, "Ace");
  // The day it was added there, at noon, so that it is the same day in every time zone nearby.
  assert.equal(dune.book.addedAt, utcNoon(day("2024-01-15")));
  // The three built-in shelves are states here, everything else becomes a list.
  assert.deepEqual(dune.lists, ["favorites", "sci-fi"]);

  // Wanted but not owned: a wish. Nothing to lend there.
  const vorleser = plan.books[1].book;
  assert.equal(vorleser.status, "WISHLIST");
  assert.equal(vorleser.ownership, "NOT_OWNED");
  assert.equal(vorleser.lendable, false);
  assert.equal(vorleser.isbn, "9783257229530");
  assert.equal(vorleser.readCount, 0);
  assert.equal(vorleser.finishedOn, null);
  assert.deepEqual(plan.books[1].lists, []);

  const momo = plan.books[2].book;
  assert.equal(momo.status, "READING");
  assert.equal(momo.authors, "Michael Ende, Lucas Zwirner, Marcel Dzama");
  assert.equal(momo.isbn, "");
  assert.equal(momo.format, "HARDCOVER");
  assert.equal(momo.currentPage, 0);

  // For the preview: which columns were read, and which the website has no use for.
  assert.deepEqual(plan.columns, [
    "Title",
    "Author",
    "Additional Authors",
    "ISBN",
    "ISBN13",
    "My Rating",
    "Publisher",
    "Binding",
    "Number of Pages",
    "Year Published",
    "Original Publication Year",
    "Date Read",
    "Date Added",
    "Bookshelves",
    "Exclusive Shelf",
    "My Review",
    "Read Count",
    "Owned Copies",
  ]);
  assert.deepEqual(plan.ignored, ["Book Id", "Author l-f", "Average Rating", "Bookshelves with positions", "Spoiler", "Private Notes"]);
});

test("a StoryGraph export is understood", () => {
  const plan = parseImport(fixture("storygraph_export.csv"), UTC);
  assert.ok(plan);
  assert.equal(plan.source, STORYGRAPH);
  const [hobbit, hailMary, piranesi, babel] = plan.books.map((p) => p.book);
  assert.equal(hobbit.status, "READ");
  assert.equal(hobbit.rating, 4.5);
  assert.equal(hobbit.startedOn, day("2024-01-03"));
  assert.equal(hobbit.finishedOn, day("2024-01-20"));
  assert.equal(hobbit.review, "Cosy.");
  assert.equal(hobbit.tags, "fantasy, classics");
  assert.equal(hobbit.format, "PAPERBACK");
  assert.equal(hobbit.readCount, 1);
  assert.equal(hobbit.authors, "J.R.R. Tolkien");
  assert.equal(hobbit.isbn, "9780261102217");

  assert.equal(hailMary.status, "READING");
  assert.equal(hailMary.format, "AUDIOBOOK");
  assert.equal(hailMary.lendable, false);

  assert.equal(piranesi.status, "ABANDONED");
  assert.equal(piranesi.format, "EBOOK");
  assert.equal(piranesi.rating, 2.25);

  assert.equal(babel.status, "WISHLIST");
  assert.equal(babel.ownership, "NOT_OWNED");
  assert.deepEqual(
    plan.books.map((p) => p.lists),
    [[], [], [], []],
  );
});

test("any list with a title column works, also in German", () => {
  const plan = parseImport(
    [
      "Titel;Autor;ISBN;Seiten;Verlag;Jahr;Status;Bewertung;Reihe;Band",
      "Homo faber;Max Frisch;3-518-36854-0;203;Suhrkamp;1977;Gelesen;4,5;;",
      "Der Schwarm;Frank Schätzing;;987;Kiepenheuer & Witsch;2004;Am Lesen;;;",
      "Harry Potter und der Stein der Weisen;J. K. Rowling;;335;Carlsen;1998;Wunschliste;;Harry Potter;1",
    ].join("\n"),
    UTC,
  );
  assert.ok(plan);
  assert.equal(plan.source, GENERIC);
  const [faber, schwarm, potter] = plan.books.map((p) => p.book);
  assert.equal(faber.authors, "Max Frisch");
  assert.equal(faber.isbn, "9783518368541");
  assert.equal(faber.pageCount, 203);
  assert.equal(faber.publisher, "Suhrkamp");
  assert.equal(faber.publishedYear, "1977");
  assert.equal(faber.status, "READ");
  assert.equal(faber.rating, 4.5);
  assert.equal(faber.readCount, 1);
  assert.equal(faber.currentPage, 203);
  assert.equal(schwarm.status, "READING");
  assert.equal(schwarm.authors, "Frank Schätzing");
  // A list one keeps oneself is a list of books one has, so a wish stays on the shelf of unread books.
  assert.equal(potter.status, "NONE");
  assert.equal(potter.series, "Harry Potter");
  assert.equal(potter.seriesPosition, 1);
  // No day in the file: the book counts as added now.
  assert.equal(potter.addedAt, NOW);
  assert.deepEqual(plan.ignored, []);
});

test("a list in English with the other columns the app knows", () => {
  const plan = parseImport(
    [
      "name,author(s),isbn_13,page_count,format,rating,spice,favorite,cover_url,started,finished,read_count,genre,series,volume,status",
      'Fourth Wing,"Rebecca Yarros; Someone Else",9781649374042,512,Hardcover,"4,5",9,yes,https://example.org/fw.jpg,2024-05-01,2024-05-09 21:00:00,2,Fantasy,The Empyrean,"1,5",finished',
      "Wrong Cover,Nobody,,,,7,,no,file.jpg,,,,,,,tbr",
      ",No Title,,,,,,,,,,,,,,",
    ].join("\n"),
    UTC,
  );
  assert.ok(plan);
  assert.equal(plan.books.length, 2);
  const [wing, wrong] = plan.books.map((p) => p.book);
  assert.equal(wing.authors, "Rebecca Yarros, Someone Else");
  assert.equal(wing.isbn, "9781649374042");
  assert.equal(wing.rating, 4.5);
  // Chillies go up to five, whatever the file says.
  assert.equal(wing.spice, 5);
  assert.equal(wing.favorite, true);
  assert.equal(wing.coverUrl, "https://example.org/fw.jpg");
  assert.equal(wing.startedOn, day("2024-05-01"));
  assert.equal(wing.finishedOn, day("2024-05-09"));
  assert.equal(wing.readCount, 2);
  assert.equal(wing.genres, "Fantasy");
  assert.equal(wing.series, "The Empyrean");
  assert.equal(wing.seriesPosition, 1.5);
  assert.equal(wing.format, "HARDCOVER");
  // Stars stop at five, a cover needs a real address, and "to be read" of one's own list is simply unread.
  assert.equal(wrong.rating, 5);
  assert.equal(wrong.coverUrl, "");
  assert.equal(wrong.status, "NONE");
  assert.equal(wrong.favorite, false);
});

test("text that is no list of books is refused", () => {
  assert.equal(parseImport("just a sentence, with a comma"), null);
  assert.equal(parseImport("date,amount\n2024-01-01,12"), null);
  assert.equal(parseImport("title,author\n"), null);
  assert.equal(parseImport(""), null);
  assert.equal(parseImport('{"app":"shelfmark","v":1,"type":"backup","backup":{"books":[]}}'), null);
});

test("words for reading states, and dates", () => {
  assert.equal(statusOf("Finished", true), "READ");
  assert.equal(statusOf("currently-reading", false), "READING");
  assert.equal(statusOf("DNF", true), "ABANDONED");
  assert.equal(statusOf("to-read", false), "WISHLIST");
  assert.equal(statusOf("to-read", true), "NONE");
  assert.equal(statusOf("something else", true), "NONE");
  assert.equal(statusOf(" Gelesen ", true), "READ");
  assert.equal(statusOf("Abgebrochen", false), "ABANDONED");
  assert.equal(importDay("2024/03/02"), day("2024-03-02"));
  assert.equal(importDay("2024-03-02 18:22:01"), day("2024-03-02"));
  assert.equal(importDay("02.03.2024"), day("2024-03-02"));
  assert.equal(importDay("soon"), null);
  // The other ways of writing a day that are accepted.
  assert.equal(importDay("2.3.2024"), day("2024-03-02"));
  assert.equal(importDay("03/02/2024"), day("2024-03-02"));
  assert.equal(importDay("2024/3/2"), day("2024-03-02"));
  assert.equal(importDay("  2024-03-02T10:00:00Z"), day("2024-03-02"));
  assert.equal(importDay(""), null);
  assert.equal(importDay("2024-13-02"), null);
  assert.equal(importDay("2024-00-10"), null);
  assert.equal(importDay("2024-03-32"), null);
  // The 30th of February is taken for the last day that month has, as the app takes it.
  assert.equal(importDay("2024-02-30"), toEpochDay(2024, 2, 29));
  assert.deepEqual(splitSeries("Dune (Dune, #1)"), { title: "Dune", series: "Dune", position: 1 });
  assert.deepEqual(splitSeries("The Colour of Magic (Discworld #1.5)"), { title: "The Colour of Magic", series: "Discworld", position: 1.5 });
  assert.deepEqual(splitSeries("Emma (annotated)"), { title: "Emma (annotated)", series: "", position: 0 });
});

test("the same book is recognised and only gaps are filled", () => {
  const mine = makeBook({ title: "Der Vorleser", authors: "Bernhard Schlink", rating: 4, review: "Meins" });
  const theirs = makeBook({ title: "der vorleser", authors: "Bernhard Schlink, Someone Else", isbn: "9783257229530", pageCount: 206, rating: 2, review: "Fremd", publisher: "Diogenes" });
  assert.equal(sameBook(mine, theirs), true);
  assert.equal(sameBook(mine, makeBook({ title: "Der Vorleser", authors: "Anna Other" })), false);
  assert.equal(sameBook(makeBook({ title: "A", isbn: "9783257229530" }), theirs), true);
  const merged = fillGaps(mine, theirs);
  assert.equal(merged.isbn, "9783257229530");
  assert.equal(merged.pageCount, 206);
  assert.equal(merged.publisher, "Diogenes");
  // What the reader wrote stays.
  assert.equal(merged.rating, 4);
  assert.equal(merged.review, "Meins");
  assert.equal(merged.title, "Der Vorleser");
});

function ids(from = 9_000_000_000_000_000) {
  let next = from;
  return () => next++;
}

test("an import adds new books and completes known ones", () => {
  // Dune is here already, with the reader's own opinion, and so is a list.
  let vault: Vault = addBook(makeBook({ id: 11, title: "Dune", authors: "Frank Herbert", rating: 3, review: "My own words" }), [], 100)(emptyVault());
  vault = createShelf(21, "Sci-Fi", 100)(vault);
  const plan = parseImport(fixture("goodreads_export.csv"), UTC);
  assert.ok(plan);

  const preview = previewImport(vault, plan);
  assert.deepEqual([preview.added.length, preview.known.length, preview.completed], [2, 1, 1]);
  assert.deepEqual(
    preview.added.map((b) => b.title),
    ["Der Vorleser", "Momo"],
  );
  assert.deepEqual(
    preview.known.map((b) => b.title),
    ["Dune"],
  );
  assert.deepEqual(preview.newLists, ["favorites"]);

  const done = applyImport(vault, plan, importIdsFor(plan, ids()), NOW);
  assert.deepEqual([done.added.length, done.completed], [2, 1]);
  const books = done.vault.books;
  assert.deepEqual(new Set(books.map((b) => b.title)), new Set(["Dune", "Der Vorleser", "Momo"]));
  const dune = books.find((b) => b.id === 11);
  assert.ok(dune);
  assert.equal(dune.isbn, "9780441172719");
  assert.equal(dune.pageCount, 896);
  assert.equal(dune.rating, 3);
  assert.equal(dune.review, "My own words");
  assert.equal(dune.updatedAt, NOW);
  // The reading state the reader gave their own copy is not overruled by the file.
  assert.equal(dune.status, "NONE");
  // Lists named in the file exist afterwards, an existing one is reused whatever its case.
  assert.deepEqual(new Set(done.vault.shelves.map((s) => s.name)), new Set(["Sci-Fi", "favorites"]));
  assert.deepEqual(new Set(done.vault.links.filter((l) => l.bookId === 11).map((l) => l.shelfId)), new Set(done.vault.shelves.map((s) => s.id)));
  const favorites = done.vault.shelves.find((s) => s.name === "favorites");
  assert.ok(favorites);
  assert.equal(favorites.position, 1);
  assert.equal(favorites.createdAt, NOW);
  // New books get ids of the website's kind, each its own, and keep the day they were added elsewhere.
  const fresh = books.filter((b) => b.id !== 11);
  assert.equal(new Set(fresh.map((b) => b.id)).size, 2);
  for (const b of fresh) assert.ok(b.id >= 9e15 && b.updatedAt === NOW && b.addedAt < NOW);

  // Importing the same file again changes nothing.
  const again = previewImport(done.vault, plan);
  assert.deepEqual([again.added.length, again.known.length, again.completed], [0, 3, 0]);
  const second = applyImport(done.vault, plan, importIdsFor(plan, ids(9_100_000_000_000_000)), NOW + 5);
  assert.deepEqual([second.added.length, second.completed], [0, 0]);
  assert.equal(second.vault, done.vault);
  assert.equal(second.vault.books.length, 3);
});

test("the import is one change that can be applied again without harm", () => {
  const plan = parseImport(fixture("storygraph_export.csv"), UTC);
  assert.ok(plan);
  const change = importBooks(plan, importIdsFor(plan, ids()), NOW);
  const once = change(emptyVault());
  assert.equal(once.books.length, 4);
  // Saved, and applied once more to what the server then holds: nothing is there twice.
  assert.equal(change(once), once);
  // Another device changed a title in the meantime: the row is still known by its id.
  const renamed = { ...once, books: once.books.map((b) => (b.title === "Babel" ? { ...b, title: "Babel, or the Necessity of Violence", isbn: "" } : b)) };
  assert.equal(change(renamed).books.length, 4);
  // What goes to the server is a document the app can read: whole numbers as ids, no nulls where none belong.
  const written = writeVault(once) as { books: Record<string, unknown>[] };
  assert.equal(written.books.length, 4);
  for (const b of written.books) assert.ok(Number.isSafeInteger(b.id) && typeof b.title === "string" && !Object.values(b).includes(null));
  assert.deepEqual(readVault(written).books, once.books);
});

test("a book that stands in the file twice is added once", () => {
  const plan = parseImport("title,author,pages\nDune,Frank Herbert,\nDUNE,Frank Herbert,896\nMomo,Michael Ende,304\n", UTC);
  assert.ok(plan);
  const preview = previewImport(emptyVault(), plan);
  assert.deepEqual([preview.added.length, preview.known.length], [2, 1]);
  const done = applyImport(emptyVault(), plan, importIdsFor(plan, ids()), NOW);
  assert.deepEqual(
    done.vault.books.map((b) => [b.title, b.pageCount]),
    [
      ["Dune", 896],
      ["Momo", 304],
    ],
  );
});

// aBookTheFileNamesTwiceIsOneBookWithEverythingBothRowsKnow in the app's PortedFeaturesTest.kt.
test("a known book the file names twice keeps what both rows know, and is counted once", () => {
  const dune = makeBook({ id: 1, title: "Dune", authors: "Frank Herbert" });
  const vault = { ...emptyVault(), books: [dune] };
  const csv =
    "title,author,pages,isbn,publisher\n" +
    "Dune,Frank Herbert,896,,\n" +
    "Dune,Frank Herbert,,9780441172719,Ace\n" +
    "Momo,Michael Ende,304,,\n" +
    "Momo,Michael Ende,,9783522202558,\n";
  const plan = parseImport(csv, UTC);
  assert.ok(plan);
  assert.equal(plan.books.length, 4);
  const preview = previewImport(vault, plan);
  assert.deepEqual([preview.added.length, preview.known.length], [1, 3]);
  const done = applyImport(vault, plan, importIdsFor(plan, ids()), NOW);
  // One book added, one completed: books are counted, not rows.
  assert.deepEqual([done.added.length, done.completed], [1, 1]);
  assert.equal(done.vault.books.length, 2);
  const filled = done.vault.books.find((b) => b.id === 1);
  assert.deepEqual([filled?.pageCount, filled?.isbn, filled?.publisher], [896, "9780441172719", "Ace"]);
  const again = previewImport(done.vault, plan);
  assert.deepEqual([again.added.length, again.known.length], [0, 4]);
});

test("a row matches the first book it could mean, by ISBN or by title and first author", () => {
  // Two copies of a title are in the library already. One has an ISBN.
  const paperback = makeBook({ id: 1, title: "Emma", authors: "Jane Austen" });
  const hardcover = makeBook({ id: 2, title: "Emma: A Novel", authors: "Austen, Jane", isbn: "9780141439587" });
  const vault = { ...emptyVault(), books: [paperback, hardcover] };
  const plan = parseImport(
    [
      "title,author,isbn,pages,publisher",
      // The ISBN of the second, the name of the first: the first book in the library that matches is taken.
      "Emma,Jane Austen,9780141439587,474,",
      // Only the ISBN matches. The first copy has it by now, from the row above, and comes first again.
      "Emma (Penguin Classics),J. Austen,9780141439587,,Penguin",
      // A known book that gains an ISBN from one row is found by it from the next.
      "Persuasion,Jane Austen,9780141439686,,",
      "Persuasion (annotated),Somebody Else,9780141439686,249,",
    ].join("\n"),
    UTC,
  );
  assert.ok(plan);
  const done = applyImport(vault, plan, importIdsFor(plan, ids()), NOW);
  assert.deepEqual(
    done.vault.books.map((b) => [b.id < 100 ? b.id : "new", b.title, b.isbn, b.pageCount, b.publisher]),
    [
      [1, "Emma", "9780141439587", 474, "Penguin"],
      [2, "Emma: A Novel", "9780141439587", 0, ""],
      ["new", "Persuasion", "9780141439686", 249, ""],
    ],
  );
  // Three rows met a book that was there by then. One book that was there before gained
  // something: the first Emma. Persuasion came with this file and does not count as completed.
  assert.deepEqual([done.added.length, done.known.length, done.completed], [1, 3, 1]);
  // What one row filled in is still there after the next row for the same book.
  assert.equal(done.vault.books[0].pageCount, 474);
});

test("a long list is imported in good time", () => {
  const rows = ["title,author,isbn,pages"];
  for (let i = 0; i < 3000; i++) rows.push(`Volume ${i},Author ${i % 50},,${100 + i}`);
  const plan = parseImport(rows.join("\n"), UTC);
  assert.ok(plan);
  const started = Date.now();
  const once = applyImport(emptyVault(), plan, importIdsFor(plan, ids()), NOW);
  const again = applyImport(once.vault, plan, importIdsFor(plan, ids(9_200_000_000_000_000)), NOW);
  assert.equal(once.added.length, 3000);
  assert.deepEqual([again.added.length, again.known.length, again.completed], [0, 3000, 0]);
  assert.equal(again.vault, once.vault);
  // Generous for a slow machine. Held row by row against the library this took many times as long.
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test("a list from a spreadsheet on Windows keeps its umlauts", () => {
  const utf8 = new TextEncoder().encode("Titel;Autor\nDer Schwarm;Frank Schätzing\n");
  assert.equal(decodeText(utf8), "Titel;Autor\nDer Schwarm;Frank Schätzing\n");
  // The same text as Windows-1252 writes it: "ä" is the single byte E4, which is no UTF-8.
  const windows = Uint8Array.from("Titel;Autor\nDer Schwarm;Frank Schätzing\n", (c) => c.charCodeAt(0));
  assert.equal(decodeText(windows), "Titel;Autor\nDer Schwarm;Frank Schätzing\n");
  assert.equal(parseImport(decodeText(windows), UTC)?.books[0].book.authors, "Frank Schätzing");
});

test("a zip archive is told from a text file", () => {
  assert.equal(isZip(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])), true);
  assert.equal(isZip(Uint8Array.from([0x50, 0x4b, 0x05, 0x06])), true);
  assert.equal(isZip(new TextEncoder().encode("PK is how this sentence starts")), false);
  assert.equal(isZip(new TextEncoder().encode("Title,Author\n")), false);
  assert.equal(isZip(new Uint8Array()), false);
});

test("books without a cover get the ones that were found, in one change", () => {
  const bare = makeBook({ id: 1, title: "Momo" });
  const withAddress = makeBook({ id: 2, title: "Dune", coverUrl: "https://example.org/dune.jpg" });
  const onPhone = makeBook({ id: 3, title: "Emma", coverPath: "photo.jpg" });
  const unknown = makeBook({ id: 4, title: "Nobody Knows This One" });
  const vault = { ...emptyVault(), books: [bare, withAddress, onPhone, unknown] };
  assert.deepEqual(
    booksWithoutCover(vault).map((b) => b.title),
    ["Momo", "Nobody Knows This One"],
  );
  const found = [
    { bookId: 1, url: "https://covers.example/momo.jpg" },
    { bookId: 2, url: "https://covers.example/other-dune.jpg" },
    { bookId: 3, url: "https://covers.example/emma.jpg" },
    { bookId: 99, url: "https://covers.example/gone.jpg" },
  ];
  const after = fillCovers(found, 500)(vault);
  assert.equal(after.books[0].coverUrl, "https://covers.example/momo.jpg");
  assert.equal(after.books[0].updatedAt, 500);
  // A cover the reader chose, and a photo on a phone, are not replaced. Those books are not touched at all.
  assert.equal(after.books[1], withAddress);
  assert.equal(after.books[2], onPhone);
  assert.equal(after.books[3], unknown);
  assert.deepEqual(
    booksWithoutCover(after).map((b) => b.title),
    ["Nobody Knows This One"],
  );
  // Nothing found is nothing to save.
  assert.equal(fillCovers([], 600)(after), after);
  assert.equal(fillCovers(found, 600)(after), after);
});
