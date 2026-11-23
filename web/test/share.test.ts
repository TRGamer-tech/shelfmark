import assert from "node:assert/strict";
import { test } from "node:test";
import { makeEnvelope, prefsOf, readEnvelope, readVault, requestCodec, writeEnvelope } from "../src/lib/model.ts";
import { answerEnvelope, buildLibrary, libraryEnvelope, libraryFingerprint, requestEnvelope } from "../src/lib/share.ts";
import { sample } from "./helpers.ts";

const ANNA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const MOMENT = 1795400000000;

const vault = readVault(JSON.parse(sample("vault.json")));

function library(includeStatus: boolean, includeRatings: boolean) {
  return writeEnvelope(makeEnvelope("library", { library: buildLibrary(ANNA, "Anna", vault.books, vault.shelves, vault.links, includeStatus, includeRatings, MOMENT) }));
}

/** The text the app writes: two spaces, a line break at the end. */
const pretty = (document: unknown) => JSON.stringify(document, null, 2) + "\n";

test("the library friends get with everything shared is what the app builds", () => {
  const built = library(true, true);
  assert.deepEqual(built, JSON.parse(sample("library-everything.json")));
  // The same fields in the same order: byte for byte the file the app wrote.
  assert.equal(pretty(built), sample("library-everything.json"));
});

test("the library friends get with nothing but ownership shared is what the app builds", () => {
  const built = library(false, false);
  assert.deepEqual(built, JSON.parse(sample("library-owned-only.json")));
  assert.equal(pretty(built), sample("library-owned-only.json"));
  // The wishlist stays private: Babel is not owned and does not appear.
  const titles = (built.library as { books: { title: string }[] }).books.map((b) => b.title);
  assert.deepEqual(titles, ["Der Vorleser", "Der Prozess", "Dune", "Momo"]);
});

test("mixed sharing settings each hide their own part", () => {
  const statusOnly = buildLibrary(ANNA, "Anna", vault.books, vault.shelves, vault.links, true, false, MOMENT);
  assert.equal(statusOnly.books[0].status, "READ");
  assert.deepEqual(statusOnly.books[0].shelves, ["Lieblinge"]);
  assert.equal(statusOnly.books[0].rating, 0);
  assert.equal(statusOnly.books[0].review, "");
  assert.equal(statusOnly.books[0].startedOn, null);
  const ratingsOnly = buildLibrary(ANNA, "Anna", vault.books, vault.shelves, vault.links, false, true, MOMENT);
  assert.equal(ratingsOnly.books[0].status, null);
  assert.deepEqual(ratingsOnly.books[0].shelves, []);
  assert.equal(ratingsOnly.books[0].rating, 4.5);
  assert.equal(ratingsOnly.books.length, 4);
  // Dune is lent out and Der Prozess may not be lent: neither is available.
  assert.deepEqual(
    statusOnly.books.map((b) => b.available),
    [true, false, false, false, false],
  );
});

test("the published library follows the settings in the vault", () => {
  const envelope = libraryEnvelope(vault, ANNA, MOMENT);
  // The sample library has status sharing on and rating sharing off.
  assert.equal(prefsOf(vault).shareRatings, false);
  assert.equal(envelope.library!.ownerId, ANNA);
  assert.equal(envelope.library!.ownerName, "Anna");
  assert.equal(envelope.library!.includesStatus, true);
  assert.equal(envelope.library!.includesRatings, false);
  assert.equal(envelope.library!.books[0].rating, 0);
});

test("the fingerprint ignores when the library was built and nothing else", () => {
  const a = libraryFingerprint(libraryEnvelope(vault, ANNA, 1));
  const b = libraryFingerprint(libraryEnvelope(vault, ANNA, 2));
  assert.equal(a, b);
  const renamed = { ...vault, books: vault.books.map((book) => (book.id === 3 ? { ...book, title: "Dune Messiah" } : book)) };
  assert.notEqual(libraryFingerprint(libraryEnvelope(renamed, ANNA, 1)), a);
  // A review is private while ratings are not shared, so writing one changes nothing for friends.
  const reviewed = { ...vault, books: vault.books.map((book) => (book.id === 3 ? { ...book, review: "Sand." } : book)) };
  assert.equal(libraryFingerprint(libraryEnvelope(reviewed, ANNA, 1)), a);
});

test("a borrow request and its answer are the messages the app sends", () => {
  const request = {
    ...requestCodec.read({}),
    id: "req-1",
    incoming: false,
    bookRemoteId: 3,
    bookTitle: "Dune",
    bookAuthors: "Frank Herbert",
    peerId: ANNA,
    peerName: "Anna",
    note: "Für die Ferien?",
    createdAt: MOMENT,
  };
  const sent = writeEnvelope(requestEnvelope(request, BEN, "Ben"));
  assert.deepEqual(sent, JSON.parse(sample("lend-request.json")));
  assert.equal(pretty(sent), sample("lend-request.json"));

  // Anna holds the same request as an incoming one and says yes.
  const incoming = { ...request, incoming: true, peerId: BEN, peerName: "Ben" };
  const answer = writeEnvelope(answerEnvelope(incoming, true, ANNA, "Anna", MOMENT));
  assert.deepEqual(answer, JSON.parse(sample("lend-answer.json")));
  assert.equal(pretty(answer), sample("lend-answer.json"));

  const read = readEnvelope(JSON.parse(sample("lend-request.json")))!;
  assert.equal(read.request!.fromId, BEN);
  assert.equal(read.request!.isbn, "");
  assert.equal(read.library, null);
});
