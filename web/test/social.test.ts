// What arrives from friends (ServerSync.take in the app), and the changes a reader makes.
// What loans do to the library is in loans.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyVault, makeEnvelope, prefsOf, readVault, writeEnvelope, writeVault } from "../src/lib/model.ts";
import type { Vault } from "../src/lib/model.ts";
import {
  addBook,
  addOrnament,
  createShelf,
  deleteBook,
  deleteCustomTheme,
  deleteShelf,
  moveOrnament,
  restoreBackup,
  saveCustomTheme,
  saveQuote,
  setOnShelf,
  setPrefs,
  setStatus,
} from "../src/lib/mutations.ts";
import { buildLibrary } from "../src/lib/share.ts";
import { acceptLibraries, displayCode, readSyncAnswer } from "../src/lib/social.ts";
import { book, sample } from "./helpers.ts";

const ANNA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const CLARA = "33333333-3333-4333-8333-333333333333";

const annasVault = (): Vault => readVault(JSON.parse(sample("vault.json")));

test("a library counts only for the friend it came from", () => {
  const vault = annasVault();
  const real = writeEnvelope(makeEnvelope("library", { library: buildLibrary(ANNA, "Anna", vault.books, vault.shelves, vault.links, true, true, 5) }));
  const accepted = acceptLibraries(
    [
      { owner: ANNA, at: 10, payload: real },
      // Clara publishes a library that says it is Anna's.
      { owner: CLARA, at: 11, payload: real },
      { owner: BEN, at: 12, payload: { app: "shelfmark", v: 1, type: "lend_request" } },
      { owner: BEN, at: 13, payload: "nonsense" },
    ],
    BEN,
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].owner, ANNA);
  assert.equal(accepted[0].at, 10);
  assert.equal(accepted[0].library.books.length, 5);
  assert.equal(accepted[0].library.books[2].status, "NONE");
  assert.equal(accepted[0].library.books[0].rating, 4.5);
  // My own library is never shown to me as a friend's.
  assert.equal(acceptLibraries([{ owner: ANNA, at: 10, payload: real }], ANNA).length, 0);
});

test("the answer of the server is read whatever is missing", () => {
  const loan = { id: "3f2a9c1e-7b4d-4e8a-9c0d-112233445566", role: "lender", peer: BEN, peerName: "Ben", bookId: 3, book: { title: "Dune" }, state: "asked", askedAt: 4, updatedAt: 4, byMe: false };
  const answer = readSyncAnswer({ id: ANNA, code: "ABCDEFGHJK", name: "Anna", time: 5, friends: [{ id: BEN, name: "Ben" }], libraries: null, loans: [loan, "nonsense"], messages: [] });
  assert.equal(answer.friends[0].name, "Ben");
  assert.deepEqual(answer.libraries, []);
  assert.equal(answer.loans.length, 1);
  assert.equal(answer.loans[0].book.title, "Dune");
  // The mailbox borrow requests used to travel through is gone: whatever a server still says there is not read.
  assert.equal("messages" in answer, false);
  // A server from before the loans has none, which is not an error.
  assert.deepEqual(readSyncAnswer({ id: ANNA, friends: [], libraries: [], messages: [] }).loans, []);
  assert.deepEqual(readSyncAnswer(null).friends, []);
  assert.deepEqual(readSyncAnswer(null).loans, []);
  assert.equal(displayCode("ABCDEFGHJK"), "ABCDE-FGHJK");
  assert.equal(displayCode(""), "");
});

test("changes can be applied again to a fresh document without doing harm", () => {
  // After a conflict the same change runs a second time, on what the other device saved.
  const start = emptyVault();
  const novel = book({ id: 77, title: "Emma", authors: "Jane Austen", pageCount: 400 });
  const changes = [
    createShelf(5, " Holiday ", 10),
    addBook(novel, [5, 999], 20),
    setStatus(77, "READING", 100, 30),
    saveQuote({ id: 8, bookId: 77, text: "Q", page: 3, note: "", fromOcr: false, createdAt: 40 }),
    addOrnament(9, "list_5", "CAT", 1),
    moveOrnament(9, -4),
    setPrefs({ profileName: "Ben", viewMode: "SPINES" }),
  ];
  const once = changes.reduce((doc, change) => change(doc), start);
  const twice = changes.reduce((doc, change) => change(doc), once);
  assert.deepEqual(writeVault(twice), writeVault(once));
  assert.equal(once.shelves[0].name, "Holiday");
  assert.deepEqual(once.links, [{ bookId: 77, shelfId: 5 }]);
  assert.equal(once.books[0].addedAt, 20);
  assert.equal(once.books[0].status, "READING");
  assert.equal(once.books[0].startedOn, 100);
  assert.equal(once.ornaments[0].position, 0);
  assert.equal(prefsOf(once).profileName, "Ben");
  assert.equal(prefsOf(once).viewMode, "SPINES");
  assert.equal(prefsOf(once).shareStatus, true);

  // A change to a book that the other device deleted in the meantime does nothing.
  const gone = deleteBook(77)(once);
  assert.equal(gone.quotes.length, 0);
  assert.equal(gone.links.length, 0);
  assert.equal(setStatus(77, "READ", 1, 1)(gone), gone);
  assert.equal(saveQuote({ id: 8, bookId: 77, text: "Q", page: 0, note: "", fromOcr: false, createdAt: 1 })(gone), gone);
  assert.equal(setOnShelf(77, 5, true)(gone).links.length, 0);

  const noList = deleteShelf(5)(once);
  assert.equal(noList.shelves.length, 0);
  assert.equal(noList.links.length, 0);
  assert.equal(noList.ornaments.length, 0);
  assert.equal(noList.books.length, 1);
});

test("themes of one's own are saved, replaced and removed", () => {
  const moor = { id: "moor", name: "Moor", background: -15723248, card: -14932964, accent: -8665985, text: -1511192 };
  let vault = saveCustomTheme(moor)(emptyVault());
  vault = setPrefs({ theme: "custom:moor" })(vault);
  vault = saveCustomTheme({ ...moor, name: "Moor 2" })(vault);
  assert.equal(prefsOf(vault).customThemes.length, 1);
  assert.equal(prefsOf(vault).customThemes[0].name, "Moor 2");
  vault = deleteCustomTheme("moor")(vault);
  assert.equal(prefsOf(vault).customThemes.length, 0);
  // A theme that is gone cannot stay selected.
  assert.equal(prefsOf(vault).theme, "system");
});

test("restoring a backup replaces the library and keeps what a backup does not hold", () => {
  const current = setPrefs({ profileName: "Me", theme: "forest" })(addBook(book({ id: 1, title: "Old" }), [], 1)(emptyVault()));
  // A backup as the app writes it: no settings.
  const backup = readVault({
    exportedAt: 9,
    books: [{ id: 2, title: "New" }],
    shelves: [{ id: 3, name: "L" }],
    links: [
      { bookId: 2, shelfId: 3 },
      { bookId: 99, shelfId: 3 },
    ],
    quotes: [
      { id: 4, bookId: 2, text: "kept" },
      { id: 5, bookId: 99, text: "orphan" },
    ],
    ornaments: [
      { id: 6, shelfKey: "list_3", kind: "CAT" },
      { id: 7, shelfKey: "list_42", kind: "MUG" },
      { id: 8, shelfKey: "READ", kind: "LAMP" },
    ],
  });
  const restored = restoreBackup(backup)(current);
  assert.deepEqual(
    restored.books.map((b) => b.title),
    ["New"],
  );
  assert.equal(restored.links.length, 1);
  assert.deepEqual(
    restored.quotes.map((q) => q.text),
    ["kept"],
  );
  assert.deepEqual(
    restored.ornaments.map((o) => o.id),
    [6, 8],
  );
  assert.equal(prefsOf(restored).profileName, "Me");
  assert.equal(prefsOf(restored).theme, "forest");
  // A backup made on the website brings its settings along.
  const full = restoreBackup(annasVault())(current);
  assert.equal(prefsOf(full).profileName, "Anna");
  // A backup from before the loans carried borrow requests. They do not come back.
  assert.equal("requests" in full, false);
  assert.equal("requests" in writeVault(full), false);
});
