// What arrives from friends and what it does to the library (SocialRepository.import
// and ServerSync.take in the app), and the changes a reader makes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyVault, makeEnvelope, prefsOf, readVault, requestCodec, writeEnvelope, writeVault } from "../src/lib/model.ts";
import type { Vault } from "../src/lib/model.ts";
import {
  addBook,
  addOrnament,
  addRequest,
  answerRequest,
  createShelf,
  deleteBook,
  deleteCustomTheme,
  deleteShelf,
  modifyBook,
  moveOrnament,
  restoreBackup,
  saveCustomTheme,
  saveQuote,
  setOnShelf,
  setPrefs,
  setStatus,
} from "../src/lib/mutations.ts";
import { answerEnvelope, buildLibrary, requestEnvelope } from "../src/lib/share.ts";
import { acceptLibraries, displayCode, importMessages, readSyncAnswer } from "../src/lib/social.ts";
import { book, sample } from "./helpers.ts";

const ANNA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const CLARA = "33333333-3333-4333-8333-333333333333";

const annasVault = (): Vault => readVault(JSON.parse(sample("vault.json")));

const outgoing = (id: string) => ({
  ...requestCodec.read({}),
  id,
  incoming: false,
  bookRemoteId: 3,
  bookTitle: "Dune",
  bookAuthors: "Frank Herbert",
  peerId: ANNA,
  peerName: "Anna",
  note: "Please?",
  createdAt: 1000,
});

test("a borrow request addressed to me becomes an incoming request, once", () => {
  const start = { ...annasVault(), requests: [] };
  const message = { id: "m1", from: BEN, at: 5, payload: writeEnvelope(requestEnvelope(outgoing("r-9"), BEN, "Ben")) };
  const first = importMessages(start, [message], ANNA);
  assert.equal(first.newRequests.length, 1);
  const request = first.vault.requests[0];
  assert.equal(request.id, "r-9");
  assert.equal(request.incoming, true);
  assert.equal(request.bookRemoteId, 3);
  assert.equal(request.bookTitle, "Dune");
  assert.equal(request.bookAuthors, "Frank Herbert");
  assert.equal(request.peerId, BEN);
  assert.equal(request.peerName, "Ben");
  assert.equal(request.note, "Please?");
  assert.equal(request.status, "PENDING");
  assert.equal(request.createdAt, 1000);

  // The same message again (it stays on the server until it is acknowledged) changes nothing.
  const second = importMessages(first.vault, [message], ANNA);
  assert.equal(second.vault, first.vault);
  assert.equal(second.newRequests.length, 0);

  // Nor does it reset an answer that was already given.
  const answered = answerRequest("r-9", true, 20000, 2000)(first.vault);
  assert.equal(importMessages(answered, [message], ANNA).vault.requests[0].status, "ACCEPTED");
});

test("nobody can ask or answer in somebody else's name", () => {
  const start = { ...annasVault(), requests: [] };
  // Clara sends a request that claims to come from Ben.
  const forged = { id: "m1", from: CLARA, at: 5, payload: writeEnvelope(requestEnvelope(outgoing("r-1"), BEN, "Ben")) };
  assert.equal(importMessages(start, [forged], ANNA).vault, start);
  // A request for somebody else is not mine to answer.
  const other = { id: "m2", from: BEN, at: 5, payload: writeEnvelope(requestEnvelope({ ...outgoing("r-2"), peerId: CLARA }, BEN, "Ben")) };
  assert.equal(importMessages(start, [other], ANNA).vault, start);
  // Things that are no Shelfmark messages at all are passed over.
  const junk = [
    { id: "m3", from: BEN, at: 5, payload: { hello: "there" } },
    { id: "m4", from: BEN, at: 5, payload: null },
    { id: "m5", from: BEN, at: 5, payload: { app: "shelfmark", v: 99, type: "lend_request", request: { requestId: "x", fromId: BEN, toId: ANNA } } },
  ];
  assert.equal(importMessages(start, junk, ANNA).vault, start);
});

test("an answer updates the request I sent", () => {
  const mine = outgoing("r-5");
  const bensVault = addRequest(mine)(emptyVault());
  // Adding the same request twice keeps one.
  assert.equal(addRequest(mine)(bensVault).requests.length, 1);
  const incomingAtAnna = { ...mine, incoming: true, peerId: BEN, peerName: "Ben" };
  const yes = { id: "m1", from: ANNA, at: 9, payload: writeEnvelope(answerEnvelope(incomingAtAnna, true, ANNA, "Anna", 7777)) };
  const result = importMessages(bensVault, [yes], BEN);
  assert.equal(result.vault.requests[0].status, "ACCEPTED");
  assert.equal(result.vault.requests[0].answeredAt, 7777);
  assert.equal(result.answered.length, 1);
  // The same answer again is no news.
  const again = importMessages(result.vault, [yes], BEN);
  assert.equal(again.vault, result.vault);
  assert.equal(again.answered.length, 0);

  const no = { id: "m2", from: ANNA, at: 9, payload: writeEnvelope(answerEnvelope(incomingAtAnna, false, ANNA, "Anna", 8888)) };
  assert.equal(importMessages(bensVault, [no], BEN).vault.requests[0].status, "DECLINED");

  // An answer to a request that is not mine, or from somebody the request did not go to, is ignored.
  const unknown = { id: "m3", from: ANNA, at: 9, payload: writeEnvelope(answerEnvelope({ ...incomingAtAnna, id: "nope" }, true, ANNA, "Anna", 1)) };
  assert.equal(importMessages(bensVault, [unknown], BEN).vault, bensVault);
  const stranger = { id: "m4", from: CLARA, at: 9, payload: writeEnvelope(answerEnvelope(incomingAtAnna, true, CLARA, "Clara", 1)) };
  assert.equal(importMessages(bensVault, [stranger], BEN).vault, bensVault);
  const liar = { id: "m5", from: CLARA, at: 9, payload: writeEnvelope(answerEnvelope(incomingAtAnna, true, ANNA, "Anna", 1)) };
  assert.equal(importMessages(bensVault, [liar], BEN).vault, bensVault);
});

test("an answer only counts when it comes from the friend the request went to", () => {
  // Ben asked Anna for a book. Clara is a friend of Ben's too, and knows the id of the request.
  const mine = outgoing("r-7");
  const bensVault = addRequest(mine)(emptyVault());
  const atAnna = { ...mine, incoming: true, peerId: BEN, peerName: "Ben" };
  // Clara answers under their own name, so the server vouches for the sender. It is still not Clara's to answer.
  for (const accepted of [true, false]) {
    const meddling = { id: "m1", from: CLARA, at: 9, payload: writeEnvelope(answerEnvelope(atAnna, accepted, CLARA, "Clara", 4444)) };
    const result = importMessages(bensVault, [meddling], BEN);
    assert.equal(result.vault, bensVault);
    assert.equal(result.vault.requests[0].status, "PENDING");
    assert.equal(result.answered.length, 0);
  }
  // Anna's own answer still gets through afterwards, also in the same batch as Clara's.
  const clara = { id: "m1", from: CLARA, at: 9, payload: writeEnvelope(answerEnvelope(atAnna, true, CLARA, "Clara", 4444)) };
  const anna = { id: "m2", from: ANNA, at: 10, payload: writeEnvelope(answerEnvelope(atAnna, false, ANNA, "Anna", 5555)) };
  const both = importMessages(bensVault, [clara, anna], BEN);
  assert.equal(both.vault.requests[0].status, "DECLINED");
  assert.equal(both.vault.requests[0].answeredAt, 5555);
  // And an answer that was given is not overturned by somebody else later.
  const later = importMessages(both.vault, [clara], BEN);
  assert.equal(later.vault, both.vault);
});

test("saying yes marks my copy as lent, saying no does not", () => {
  const start = { ...annasVault(), requests: [] };
  const withBook = modifyBook(3, (b) => ({ ...b, lentTo: "", lentSince: null }), 1)(start);
  const message = { id: "m1", from: BEN, at: 5, payload: writeEnvelope(requestEnvelope(outgoing("r-9"), BEN, "Ben")) };
  const asked = importMessages(withBook, [message], ANNA).vault;

  const yes = answerRequest("r-9", true, 20790, 5000)(asked);
  assert.equal(yes.requests[0].status, "ACCEPTED");
  assert.equal(yes.requests[0].answeredAt, 5000);
  const dune = yes.books.find((b) => b.id === 3)!;
  assert.equal(dune.lentTo, "Ben");
  assert.equal(dune.lentSince, 20790);
  assert.equal(dune.updatedAt, 5000);
  // Lent out, it is no longer available to friends.
  const shared = buildLibrary(ANNA, "Anna", yes.books, yes.shelves, yes.links, true, true, 1);
  assert.equal(shared.books.find((b) => b.id === 3)!.available, false);

  const no = answerRequest("r-9", false, 20790, 5000)(asked);
  assert.equal(no.requests[0].status, "DECLINED");
  assert.equal(no.books.find((b) => b.id === 3)!.lentTo, "");

  // A book that is already with somebody keeps its borrower.
  const already = answerRequest("r-9", true, 20790, 5000)(importMessages(start, [message], ANNA).vault);
  assert.equal(already.books.find((b) => b.id === 3)!.lentTo, "Ben");
  assert.equal(already.books.find((b) => b.id === 3)!.lentSince, 20779);
  // My own requests cannot be answered by me.
  assert.equal(answerRequest("req-2", true, 1, 1)(annasVault()).requests[1].status, "PENDING");
});

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
  const answer = readSyncAnswer({ id: ANNA, code: "ABCDEFGHJK", name: "Anna", time: 5, friends: [{ id: BEN, name: "Ben" }], libraries: null, messages: [{ id: "m", from: BEN, at: 1, payload: {} }] });
  assert.equal(answer.friends[0].name, "Ben");
  assert.deepEqual(answer.libraries, []);
  assert.equal(answer.messages[0].from, BEN);
  assert.deepEqual(readSyncAnswer(null).friends, []);
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
  const current = setPrefs({ profileName: "Me", theme: "forest" })(addRequest(outgoing("r-1"))(addBook(book({ id: 1, title: "Old" }), [], 1)(emptyVault())));
  // A backup as the app writes it: no settings, no borrow requests.
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
  assert.equal(restored.requests.length, 1);
  assert.equal(prefsOf(restored).profileName, "Me");
  assert.equal(prefsOf(restored).theme, "forest");
  // A backup made on the website brings its settings and requests along.
  const full = restoreBackup(annasVault())(current);
  assert.equal(prefsOf(full).profileName, "Anna");
  assert.equal(full.requests.length, 2);
});
