import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_PREFS,
  emptyVault,
  inspectVault,
  isOldRequestFile,
  looksLikeVault,
  makeEnvelope,
  prefsOf,
  readEnvelope,
  readVault,
  writeEnvelope,
  writeVault,
} from "../src/lib/model.ts";
import { old, sample } from "./helpers.ts";

const NAMES = ["vault.json", "library-everything.json", "library-owned-only.json", "loan.json"];

test("the copies of the contract samples are the samples", () => {
  // In the repository the samples live next to the server. The website keeps copies so
  // that it can be built and tested on its own, and this notices when they drift apart.
  for (const name of NAMES) {
    const original = fileURLToPath(new URL(`../../supabase/samples/${name}`, import.meta.url));
    if (!existsSync(original)) continue;
    assert.equal(sample(name), readFileSync(original, "utf8"), `test/fixtures/samples/${name} is out of date`);
  }
});

test("a vault is read with every default filled in", () => {
  const vault = readVault(JSON.parse(sample("vault.json")));
  assert.equal(vault.books.length, 5);
  const [vorleser, prozess, dune, babel, momo] = vault.books;

  // Written out in the file.
  assert.equal(vorleser.status, "READ");
  assert.equal(vorleser.rating, 4.5);
  assert.equal(vorleser.favorite, true);
  assert.equal(vorleser.startedOn, 20768);

  // Left out because they have their default value.
  assert.equal(dune.status, "NONE");
  assert.equal(dune.ownership, "OWNED");
  assert.equal(dune.lendable, true);
  assert.equal(dune.rating, 0);
  assert.equal(dune.spice, 0);
  assert.equal(dune.review, "");
  assert.equal(dune.isbn, "");
  assert.equal(dune.currentPage, 0);
  assert.equal(dune.readCount, 0);
  assert.equal(dune.favorite, false);
  assert.equal(dune.startedOn, null);
  assert.equal(dune.finishedOn, null);
  assert.equal(dune.lentTo, "Ben");
  assert.equal(dune.lentSince, 20779);
  assert.equal(prozess.lendable, false);
  assert.equal(prozess.format, "PAPERBACK");
  assert.equal(babel.id, 1795400000000123);
  assert.equal(babel.pageCount, 0);
  assert.equal(babel.format, "UNKNOWN");
  assert.equal(momo.coverPath, "cover_5.jpg");
  assert.equal(momo.coverUrl, "");

  assert.equal(vault.shelves[0].position, 0);
  assert.equal(vault.shelves[1].position, 1);
  assert.equal(vault.sessions[0].startPage, 0);
  assert.equal(vault.sessions[0].note, "");
  assert.equal(vault.quotes[0].fromOcr, false);
  assert.equal(vault.goals[0].kind, "BOOKS");
  assert.equal(vault.goals[0].name, "");
  assert.equal(vault.goals[0].archived, false);
  assert.equal(vault.purchases[0].note, "");
  // Dune is out on a loan between friends and says which. A book no loan has touched carries none.
  assert.equal(dune.loanId, "3f2a9c1e-7b4d-4e8a-9c0d-112233445566");
  assert.equal(vorleser.loanId, "");

  const prefs = prefsOf(vault);
  assert.equal(prefs.profileName, "Anna");
  assert.equal(prefs.shareStatus, true);
  assert.equal(prefs.shareRatings, false);
  assert.equal(prefs.minutesPerPage, 2);
  assert.equal(prefs.theme, "custom:moor");
  // Colours are signed 32 bit ARGB integers, as Android keeps them.
  assert.equal(prefs.customThemes[0].background, -15723248);
  assert.equal(prefs.viewMode, "SPINES");
  assert.equal(prefs.sort, "TITLE");
  assert.equal(prefs.motion, false);
});

const sampleVault = (): Record<string, unknown> => JSON.parse(sample("vault.json"));

test("a vault that is read and written back is the same document", () => {
  const original = sampleVault();
  assert.deepEqual(writeVault(readVault(original)), original);
  // The same holds a second time round, nothing creeps in.
  assert.deepEqual(writeVault(readVault(writeVault(readVault(original)))), original);
});

test("a vault that still carries borrow requests is read without them and written without them", () => {
  // Borrow requests lived in the vault before loans were kept on the server. They are
  // not a field this website merely does not know, which it would carry along: they are gone.
  const before = JSON.parse(old("vault-with-requests.json"));
  assert.equal(before.requests.length, 2, "the file is a vault from before the loans");
  const vault = readVault(before);
  assert.equal("requests" in vault, false);
  assert.equal(vault._extra, undefined);
  const written = writeVault(vault);
  assert.equal("requests" in written, false);
  const { requests, ...rest } = before;
  assert.deepEqual(written, rest);
  // Everything else of the old vault is there.
  assert.equal(vault.books.length, 5);
  assert.equal(vault.books[2].lentTo, "Ben");
  // It is a library like any other: read as it is, not refused.
  assert.equal(inspectVault(before).ok, true);
  // In a backup file as well.
  const backup = readEnvelope({ app: "shelfmark", v: 1, type: "backup", backup: before })!;
  assert.equal("requests" in writeVault(backup.backup!), false);
});

test("the loan a book is out on or came in by travels in the vault, and is left out when there is none", () => {
  const vault = readVault({ exportedAt: 1, books: [{ id: 7, title: "Emma", lentTo: "Ben", lentSince: 20800, loanId: "3f2a9c1e-7b4d-4e8a-9c0d-112233445566" }, { id: 8, title: "Persuasion" }], shelves: [], links: [], quotes: [] });
  assert.equal(vault.books[0].loanId, "3f2a9c1e-7b4d-4e8a-9c0d-112233445566");
  assert.equal(vault.books[1].loanId, "");
  const written = writeVault(vault) as { books: Record<string, unknown>[] };
  assert.equal(written.books[0].loanId, "3f2a9c1e-7b4d-4e8a-9c0d-112233445566");
  assert.equal("loanId" in written.books[1], false);
});

test("fields this website does not know are kept at every level", () => {
  const original = {
    exportedAt: 1,
    books: [{ id: 9, title: "X", somethingNew: true, nested: { a: [1, 2] } }],
    shelves: [{ id: 3, name: "L", colour: "red" }],
    links: [{ bookId: 9, shelfId: 3, addedBy: "phone" }],
    quotes: [{ id: 4, bookId: 9, text: "Q", mood: "bright" }],
    sessions: [{ id: 5, bookId: 9, place: "train" }],
    notes: [{ id: 6, bookId: 9, text: "N", pinned: true }],
    goals: [{ id: 7, target: 3, startDay: 0, endDay: 0, emoji: "x" }],
    purchases: [{ id: 8, bookId: 9, day: 100, gift: true }],
    ornaments: [{ id: 10, shelfKey: "READ", kind: "TEAPOT", tilt: 3 }],
    prefs: { theme: "ember", accentShape: "round", customThemes: [{ id: "a", name: "A", background: -1, card: -2, accent: -3, text: -4, font: "serif" }] },
    fromTheFuture: { a: 1 },
  };
  const vault = readVault(original);
  assert.equal(vault.books[0].title, "X");
  // A kind of ornament a newer app invented is not thrown away either.
  assert.equal(vault.ornaments[0].kind, "TEAPOT");
  assert.deepEqual(writeVault(vault), original);

  // Changing a known field leaves the unknown ones alone.
  const changed = { ...vault, books: vault.books.map((b) => ({ ...b, rating: 4 })) };
  const written = writeVault(changed) as { books: Record<string, unknown>[]; fromTheFuture: unknown };
  assert.equal(written.books[0].rating, 4);
  assert.equal(written.books[0].somethingNew, true);
  assert.deepEqual(written.fromTheFuture, { a: 1 });
});

test("what the app could not read is never written", () => {
  // Fields without a default have to be there, null is never written, and defaults are left out.
  const vault = emptyVault();
  assert.deepEqual(writeVault(vault), { exportedAt: 0, books: [], shelves: [], links: [], quotes: [] });
  const withBook = { ...vault, books: [{ ...readVault({ books: [{ title: "T" }] }).books[0], id: 5, lentSince: null, startedOn: null }] };
  assert.deepEqual(writeVault(withBook).books, [{ id: 5, title: "T" }]);
  const text = JSON.stringify(writeVault(readVault(JSON.parse(sample("vault.json")))));
  assert.equal(text.includes("null"), false);
});

test("the settings a shelf is drawn with travel in the vault", () => {
  assert.equal(DEFAULT_PREFS.viewMode, "COVERS");
  assert.equal(DEFAULT_PREFS.sort, "ADDED");
  assert.equal(DEFAULT_PREFS.motion, true);
  assert.equal(DEFAULT_PREFS.minutesPerPage, 1.5);
  assert.equal(DEFAULT_PREFS.theme, "system");
  const vault = readVault({ exportedAt: 1, books: [], shelves: [], links: [], quotes: [], prefs: { viewMode: "SPINES", sort: "TITLE", motion: false } });
  assert.equal(prefsOf(vault).viewMode, "SPINES");
  assert.equal(prefsOf(vault).sort, "TITLE");
  assert.equal(prefsOf(vault).motion, false);
  assert.deepEqual(writeVault(vault).prefs, { viewMode: "SPINES", sort: "TITLE", motion: false });
  // Defaults are left out, as the app does.
  const defaults = { ...vault, prefs: { ...prefsOf(vault), viewMode: "COVERS" as const, sort: "ADDED" as const, motion: true } };
  assert.deepEqual(writeVault(defaults).prefs, {});
  // A library without settings stays one until something is set.
  assert.equal("prefs" in writeVault(emptyVault()), false);
});

test("a backup is the vault in the envelope of the app", () => {
  const vault = readVault(JSON.parse(sample("vault.json")));
  const file = writeEnvelope(makeEnvelope("backup", { backup: vault }));
  assert.deepEqual(Object.keys(file), ["app", "v", "type", "backup"]);
  assert.equal(file.app, "shelfmark");
  assert.equal(file.v, 1);
  assert.equal(file.type, "backup");
  assert.deepEqual(file.backup, sampleVault());
  const back = readEnvelope(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(writeVault(back!.backup!), sampleVault());
});

test("a file with a borrow request or its answer is known for what it is: from an older version", () => {
  // Such files were sent between friends before loans were kept on the server.
  assert.equal(isOldRequestFile(JSON.parse(old("lend-request.json"))), true);
  assert.equal(isOldRequestFile(JSON.parse(old("lend-answer.json"))), true);
  assert.equal(isOldRequestFile(JSON.parse(sample("library-everything.json"))), false);
  assert.equal(isOldRequestFile(JSON.parse(sample("vault.json"))), false);
  assert.equal(isOldRequestFile({ app: "other", v: 1, type: "lend_request" }), false);
  assert.equal(isOldRequestFile("lend_request"), false);
  // Read as an envelope, nothing of the request is kept or written back.
  const read = readEnvelope(JSON.parse(old("lend-request.json")))!;
  assert.equal(read.type, "lend_request");
  assert.equal(read.library, null);
  assert.equal(read.backup, null);
  assert.deepEqual(writeEnvelope(read), { app: "shelfmark", v: 1, type: "lend_request" });
});

test("only Shelfmark files are taken for envelopes", () => {
  assert.equal(readEnvelope({ type: "backup", backup: {} }), null);
  assert.equal(readEnvelope({ app: "other", v: 1, type: "backup" }), null);
  assert.equal(readEnvelope("text"), null);
  assert.equal(readEnvelope(null), null);
  assert.equal(looksLikeVault({ books: [], shelves: [], links: [], quotes: [] }), true);
  assert.equal(looksLikeVault({ books: [] }), false);
  assert.equal(looksLikeVault([]), false);
});
