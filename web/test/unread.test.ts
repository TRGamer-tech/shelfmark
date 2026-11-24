// A library this website cannot read is never replaced (supabase/README.md). What counts
// as "cannot read", what passes through untouched instead, and what the store does when
// the server hands it such a document: at the first fetch, later on, and in the middle
// of a save.

import assert from "node:assert/strict";
import { test } from "node:test";
import { utcZone } from "../src/lib/dates.ts";
import { followLoans, readLoan } from "../src/lib/loans.ts";
import type { Vault } from "../src/lib/model.ts";
import { VAULT_FORMAT, emptyVault, inspectVault, prefsOf, readVault, writeVault } from "../src/lib/model.ts";
import { addBook, addOrnament, logSession, modifyBook, moveOrnament, restoreBackup, saveGoal, setOnShelf, setPrefs, setStatus } from "../src/lib/mutations.ts";
import { serverProblemKey } from "../src/lib/supabase/errors.ts";
import { ServerError, VaultStore } from "../src/lib/sync.ts";
import type { VaultApi } from "../src/lib/sync.ts";
import { book, fixture, old, sample, session } from "./helpers.ts";

const good = (): Record<string, any> => JSON.parse(sample("vault.json"));
const whyNot = (document: unknown) => {
  const read = inspectVault(document);
  return read.ok ? "ok" : `${read.why} at ${read.where}`;
};

// ---- what can be read ----

test("the libraries that are written today are read", () => {
  assert.equal(whyNot(good()), "ok");
  // A library from before the loans, a library with nothing in it yet, and what a real session of the website left.
  assert.equal(whyNot(JSON.parse(old("vault-with-requests.json"))), "ok");
  assert.equal(whyNot(writeVault(emptyVault())), "ok");
  assert.equal(whyNot(JSON.parse(fixture("../../e2e/fixtures/vault-from-web.json"))), "ok");
  // What is read is the library, with every default filled in.
  const read = inspectVault(good());
  assert.ok(read.ok);
  assert.deepEqual(read.vault, readVault(good()));
});

test("a library that names a format this website does not know is newer, and is not opened", () => {
  assert.equal(VAULT_FORMAT, 1);
  assert.equal(whyNot({ ...good(), format: 2 }), "newer at format");
  assert.equal(whyNot({ ...good(), format: 99 }), "newer at format");
  // No format is format 1, and so is everything written today. Format 1 written out is kept as it came.
  assert.equal(whyNot({ ...good(), format: 1 }), "ok");
  assert.equal(writeVault(readVault({ ...good(), format: 1 })).format, 1);
  assert.equal("format" in writeVault(readVault(good())), false);
  // A format that is no number is no format.
  assert.equal(whyNot({ ...good(), format: "2" }), "unreadable at format");
  // Newer counts before anything else: such a document may be shaped in ways nobody here knows.
  assert.equal(whyNot({ format: 2, volumes: [] }), "newer at format");
});

test("a document that is damaged, or has a shape this website does not know, is not read", () => {
  const broken = (change: (document: Record<string, any>) => void) => {
    const document = good();
    change(document);
    return whyNot(document);
  };
  // Not a library at all.
  assert.equal(whyNot(null), "unreadable at the document");
  assert.equal(whyNot("a library"), "unreadable at the document");
  assert.equal(whyNot([]), "unreadable at the document");
  assert.equal(whyNot({}), "unreadable at exportedAt");
  assert.equal(whyNot({ exportedAt: 1, shelves: [], links: [], quotes: [] }), "unreadable at books");
  // A part that is no list, or holds something that is no entry.
  assert.equal(broken((d) => (d.books = { 1: "Dune" })), "unreadable at books");
  assert.equal(broken((d) => (d.books[1] = "Dune")), "unreadable at books[1]");
  assert.equal(broken((d) => (d.sessions = "none")), "unreadable at sessions");
  assert.equal(broken((d) => (d.prefs = "dark")), "unreadable at prefs");
  assert.equal(broken((d) => (d.prefs.customThemes = [7])), "unreadable at prefs.customThemes[0]");
  // A value of another kind than the field holds. Read forgivingly it would become the default, and be saved as that.
  assert.equal(broken((d) => (d.books[2].pageCount = "896")), "unreadable at books[2].pageCount");
  assert.equal(broken((d) => (d.books[0].favorite = "yes")), "unreadable at books[0].favorite");
  assert.equal(broken((d) => (d.books[0].status = 3)), "unreadable at books[0].status");
  assert.equal(broken((d) => (d.books[2].lentSince = "last week")), "unreadable at books[2].lentSince");
  assert.equal(broken((d) => (d.books[2].loanId = 7)), "unreadable at books[2].loanId");
  assert.equal(broken((d) => (d.quotes[0].page = [12])), "unreadable at quotes[0].page");
  assert.equal(broken((d) => (d.prefs.motion = 0)), "unreadable at prefs.motion");
  assert.equal(broken((d) => (d.prefs.customThemes[0].card = "#fff")), "unreadable at prefs.customThemes[0].card");
  // Something the app has no default for is missing: the app would refuse the document as well.
  assert.equal(broken((d) => delete d.books[3].title), "unreadable at books[3].title");
  assert.equal(broken((d) => delete d.links[0].shelfId), "unreadable at links[0].shelfId");
  assert.equal(broken((d) => delete d.goals[0].startDay), "unreadable at goals[0].startDay");
  assert.equal(broken((d) => delete d.ornaments[0].kind), "unreadable at ornaments[0].kind");
  assert.equal(broken((d) => delete d.exportedAt), "unreadable at exportedAt");
  assert.equal(broken((d) => (d.shelves = null)), "unreadable at shelves");
});

test("what is not there is not a fault, and neither is what this website does not know", () => {
  // Fields with a default may be missing, and a null says the same as nothing.
  const sparse = { exportedAt: 1, books: [{ title: "T", lentSince: null, rating: null }], shelves: [{ name: "L" }], links: [], quotes: [], sessions: null, prefs: null };
  assert.equal(whyNot(sparse), "ok");
  assert.deepEqual(writeVault(readVault(sparse)), { exportedAt: 1, books: [{ title: "T" }], shelves: [{ name: "L" }], links: [], quotes: [] });
  // Fields a newer version added are carried along at every level.
  const newer = { ...good(), shelfColour: "oak", books: good().books.map((b: object) => ({ ...b, mood: "bright", pressings: [1, 2] })) };
  assert.equal(whyNot(newer), "ok");
  assert.deepEqual(writeVault(readVault(newer)), newer);
});

// ---- words from a fixed set that this website does not know ----

/** A library as a newer version of the app could write it: with words nobody here has heard of, wherever a fixed set is expected. */
function fromTheFuture(): Record<string, any> {
  return {
    exportedAt: 5,
    books: [
      { id: 1, title: "Paused", status: "PAUSED", ownership: "LIBRARY", format: "COMIC", pageCount: 200 },
      { id: 2, title: "Plain" },
    ],
    shelves: [{ id: 3, name: "L" }],
    links: [{ bookId: 1, shelfId: 3 }],
    quotes: [],
    goals: [{ id: 4, kind: "CHAPTERS", target: 30, startDay: 100, endDay: 200, repeat: "QUARTERLY" }],
    ornaments: [
      { id: 5, shelfKey: "PAUSED", kind: "TEAPOT", position: 2 },
      { id: 6, shelfKey: "list_3", kind: "ROBOT" },
    ],
    prefs: { theme: "aurora", viewMode: "GRID", sort: "COLOUR" },
  };
}

test("a word this website does not know where it has a fixed set passes through untouched", () => {
  // A status, an ownership, a format, a kind and a rhythm of goal, a kind and a place of
  // ornament, a view, an order, a theme: each is a text, and is written back as the text it was.
  const future = fromTheFuture();
  assert.equal(whyNot(future), "ok");
  const vault = readVault(future);
  assert.equal(vault.books[0].status, "PAUSED");
  assert.equal(vault.books[0].ownership, "LIBRARY");
  assert.equal(vault.books[0].format, "COMIC");
  assert.equal(vault.goals[0].kind, "CHAPTERS");
  assert.equal(vault.goals[0].repeat, "QUARTERLY");
  assert.equal(vault.ornaments[0].kind, "TEAPOT");
  assert.equal(prefsOf(vault).viewMode, "GRID");
  assert.equal(prefsOf(vault).sort, "COLOUR");
  assert.equal(prefsOf(vault).theme, "aurora");
  assert.deepEqual(writeVault(vault), future);
});

test("whatever the reader does elsewhere, the unknown words are still there when the library is saved", () => {
  const future = fromTheFuture();
  const loan = readLoan({ id: "3f2a9c1e-7b4d-4e8a-9c0d-112233445566", role: "lender", peer: "p", peerName: "Ben", bookId: 2, book: { title: "Plain" }, state: "on_loan", receivedAt: 8_640_000_000, askedAt: 1, updatedAt: 2, byMe: false })!;
  const changes = [
    // Stars for the book with the unknown status, and a list for it.
    modifyBook(1, (b) => ({ ...b, rating: 4, review: "Fine." }), 10),
    setOnShelf(1, 3, true),
    // The other book is read, lent on a loan, and a third one is added.
    setStatus(2, "READ", 300, 11),
    followLoans([loan], () => undefined, utcZone, 12),
    addBook(book({ id: 7, title: "New" }), [3], 13),
    // The goal gets another target, in the form that also shows its kind.
    saveGoal({ ...readVault(future).goals[0], target: 40 }),
    // The ornaments are moved, and one is added next to them.
    moveOrnament(5, 4),
    moveOrnament(6, 1),
    addOrnament(8, "READ", "CAT", 0),
    // Another name, which is a setting like the view and the order.
    setPrefs({ profileName: "Anna", motion: false }),
  ];
  const written = writeVault(changes.reduce((doc, change) => change(doc), readVault(future))) as Record<string, any>;
  assert.equal(written.books[0].status, "PAUSED");
  assert.equal(written.books[0].ownership, "LIBRARY");
  assert.equal(written.books[0].format, "COMIC");
  assert.equal(written.books[0].rating, 4);
  assert.equal(written.books[1].lentTo, "Ben");
  assert.deepEqual([written.goals[0].kind, written.goals[0].repeat, written.goals[0].target], ["CHAPTERS", "QUARTERLY", 40]);
  assert.deepEqual(written.ornaments.slice(0, 2), [
    { id: 5, shelfKey: "PAUSED", kind: "TEAPOT", position: 4 },
    { id: 6, shelfKey: "list_3", kind: "ROBOT", position: 1 },
  ]);
  assert.deepEqual([written.prefs.theme, written.prefs.viewMode, written.prefs.sort, written.prefs.profileName], ["aurora", "GRID", "COLOUR", "Anna"]);
  // Restored from a backup, the words come back as they were saved.
  assert.deepEqual(writeVault(restoreBackup(readVault(future))(emptyVault())), future);
  // Only the reader's own choice replaces such a word: a status they pick.
  assert.equal(setStatus(1, "READ", 300, 14)(readVault(future)).books[0].status, "READ");
  // A reading session moves the bookmark, and puts a book that was not started on "Reading".
  // A status nobody here knows is no "not started": it stays, also at the last page.
  const logged = logSession(session({ id: 9, bookId: 1, endPage: 20 }), 300, 15)(readVault(future));
  assert.deepEqual([logged.books[0].status, logged.books[0].currentPage, logged.sessions.length], ["PAUSED", 20, 1]);
  const toTheEnd = logSession(session({ id: 10, bookId: 1, endPage: 200 }), 300, 16)(readVault(future));
  assert.deepEqual([toTheEnd.books[0].status, toTheEnd.books[0].currentPage, toTheEnd.books[0].readCount], ["PAUSED", 200, 0]);
  assert.equal((writeVault(logged) as Record<string, any>).books[0].status, "PAUSED");
  // The statuses this website knows move as they always did.
  for (const status of ["NONE", "WISHLIST", "ABANDONED"]) {
    const known = { ...future, books: [{ id: 1, title: "Known", status, pageCount: 200 }] };
    assert.equal(logSession(session({ id: 9, bookId: 1, endPage: 20 }), 300, 15)(readVault(known)).books[0].status, "READING", status);
  }
});

// ---- the store ----

/** A server in memory that keeps a document by revision, whatever the document is. */
class Server implements VaultApi {
  revision = 0;
  payload: unknown = null;
  pushes = 0;
  /** Runs before a save is looked at, to let another device save first. */
  beforePush: (() => void) | null = null;

  async pull(known: number) {
    await Promise.resolve();
    return { revision: this.revision, payload: this.revision === known || this.revision === 0 ? null : structuredClone(this.payload) };
  }

  async push(payload: Record<string, unknown>, expected: number) {
    await Promise.resolve();
    this.pushes++;
    const hook = this.beforePush;
    this.beforePush = null;
    hook?.();
    if (expected !== this.revision) throw new ServerError("conflict");
    this.payload = structuredClone(payload);
    this.revision++;
    return { revision: this.revision };
  }

  /** What another device does: it saves whatever it likes. */
  put(document: unknown) {
    this.payload = structuredClone(document);
    this.revision++;
  }
}

const addOne = (id: number, title: string) => addBook(book({ id, title }), [], 1);

for (const [name, document, why] of [
  ["damaged", { ...good(), books: "gone" }, "unreadable"],
  ["of a shape nobody here knows", { volumes: [], cases: [] }, "unreadable"],
  ["no document at all", "library", "unreadable"],
  ["newer than this website", { ...good(), format: 2 }, "newer"],
] as const) {
  test(`a library that is ${name} is not opened, and nothing is written over it`, async () => {
    const server = new Server();
    server.put(document);
    const store = new VaultStore(server);
    await store.load();
    assert.equal(store.getState().status, "failed");
    assert.equal(store.getState().problem, why);
    assert.equal(store.getState().revision, 0, "nothing was taken from the server");
    // A change made all the same waits: it is not saved, not now and not by asking again.
    await store.mutate(addOne(1, "Typed anyway"));
    await store.flush();
    assert.equal(await store.settled(), false);
    await store.refresh();
    assert.equal(server.pushes, 0);
    assert.deepEqual(server.payload, document);
    assert.equal(server.revision, 1);
    assert.equal(store.getState().status, "failed");
    assert.equal(store.getState().pending, 1);
    // The reason has words in both languages.
    assert.equal(serverProblemKey(why), why === "newer" ? "web_library_newer" : "web_library_unreadable");
  });
}

test("once the library can be read again it is opened, and what waited is saved on top of it", async () => {
  const server = new Server();
  server.put({ ...good(), format: 2 });
  const store = new VaultStore(server);
  await store.load();
  await store.mutate(addOne(77, "Waited"));
  assert.equal(server.pushes, 0);
  // The other device saves a library this website reads. Reading again opens it.
  server.put(good());
  await store.load();
  assert.equal(await store.settled(), true);
  assert.equal(store.getState().status, "saved");
  assert.equal(store.getState().problem, null);
  const saved = readVault(server.payload);
  assert.equal(saved.books.length, 6);
  assert.equal(saved.books[5].title, "Waited");
  assert.equal(saved.books[0].title, "Der Vorleser");
});

test("a library that becomes unreadable while the site is open is left alone from then on", async () => {
  const server = new Server();
  server.put(good());
  const store = new VaultStore(server);
  await store.load();
  assert.equal(store.getState().status, "idle");
  await store.mutate(addOne(77, "Before"));
  assert.equal(server.revision, 2);
  // Another device, with a newer app, saves in a format this website does not know.
  const theirs = { ...good(), format: 2, volumes: [1, 2, 3] };
  server.put(theirs);
  await store.refresh();
  assert.equal(store.getState().status, "failed");
  assert.equal(store.getState().problem, "newer");
  await store.mutate(addOne(78, "After"));
  await store.flush();
  await store.refresh();
  assert.equal(server.pushes, 1, "only the save from before");
  assert.deepEqual(server.payload, theirs);
  // What the reader last saw is still what the page holds: it is not emptied either.
  assert.equal(store.getState().vault.books.some((b) => b.title === "Before"), true);
});

test("a save that meets an unreadable library in its way stops, and writes nothing", async () => {
  const server = new Server();
  server.put(good());
  const store = new VaultStore(server);
  await store.load();
  const theirs = { ...good(), books: [{ id: 1 }] };
  // While this website saves, another device saves something that cannot be read.
  server.beforePush = () => server.put(theirs);
  await store.mutate(addOne(77, "Mine"));
  assert.equal(await store.settled(), false);
  assert.equal(store.getState().status, "failed");
  assert.equal(store.getState().problem, "unreadable");
  assert.equal(server.pushes, 1, "the one save that was refused as a conflict");
  assert.deepEqual(server.payload, theirs);
  // Not by a later change either.
  await store.mutate(setPrefs({ profileName: "Still here" }));
  assert.equal(server.pushes, 1);
  assert.deepEqual(server.payload, theirs);
  assert.equal(store.getState().pending, 2);
});

test("a library the server holds and does not hand over was not read, and is not written over", async () => {
  // A server that names a revision and sends no document with it. The real one never
  // does, but a number is no library: without the document nothing is taken for read.
  const server = new Server();
  server.put(good());
  const silent: VaultApi = { pull: async () => ({ revision: server.revision, payload: null }), push: (payload, expected) => server.push(payload, expected) };
  const store = new VaultStore(silent);
  await store.load();
  assert.equal(store.getState().status, "failed");
  assert.equal(store.getState().problem, "unreadable");
  await store.mutate(addOne(77, "Mine"));
  assert.equal(server.pushes, 0);
  assert.deepEqual(server.payload, good());
  // The revision this tab holds already, without its document, is the usual answer to a look, and no fault.
  const usual = new VaultStore(server);
  await usual.load();
  await usual.refresh();
  assert.equal(usual.getState().status, "idle");
});

test("reading again quietly leaves the message where it is until the library can be read", async () => {
  const server = new Server();
  server.put({ ...good(), format: 2 });
  const store = new VaultStore(server);
  await store.load();
  const seen: string[] = [];
  store.subscribe(() => seen.push(`${store.getState().status} ${store.getState().problem}`));
  // The look that is taken every minute: the page never says "loading" in between.
  await store.load(true);
  assert.deepEqual(Array.from(new Set(seen)), ["failed newer"]);
  // Damaged now instead of newer: the message follows.
  server.put({ ...good(), books: 7 });
  await store.load(true);
  assert.equal(seen.at(-1), "failed unreadable");
  assert.equal(seen.some((state) => state.startsWith("loading")), false);
  // Readable again: it opens by itself.
  server.put(good());
  await store.load(true);
  assert.equal(seen.at(-1), "idle null");
  assert.equal(seen.some((state) => state.startsWith("loading")), false);
  assert.equal(server.pushes, 0);
  // Asked for by the reader, a try shows that something happens.
  server.put({ ...good(), format: 3 });
  await store.refresh();
  seen.length = 0;
  await store.load();
  assert.deepEqual(seen, ["loading null", "failed newer"]);
  // A first fetch is never quiet, whatever it was asked to be.
  const fresh = new VaultStore(server);
  const first: string[] = [];
  fresh.subscribe(() => first.push(fresh.getState().status));
  server.put(good());
  await fresh.load(true);
  assert.deepEqual(first, ["loading", "idle"]);
});

test("no document yet is the one case in which the website writes without having read", async () => {
  const server = new Server();
  const store = new VaultStore(server);
  await store.load();
  assert.equal(store.getState().status, "idle");
  await store.mutate(addOne(1, "First"));
  assert.equal(await store.settled(), true);
  assert.equal(server.revision, 1);
  assert.equal(readVault(server.payload).books[0].title, "First");
  assert.equal(whyNot(server.payload), "ok");
});

test("the document a save was built on is handed on with it, for what follows from the difference", async () => {
  const server = new Server();
  server.put(writeVault({ ...emptyVault(), exportedAt: 1, books: [book({ id: 1, title: "One" })] } as Vault));
  const seen: [string[], string[]][] = [];
  const store = new VaultStore(server, { onSaved: (vault, before) => seen.push([before.books.map((b) => b.title), vault.books.map((b) => b.title)]) });
  await store.load();
  // Another device adds a book while this one saves: "before" is what the save was really built on.
  server.beforePush = () => server.put(writeVault({ ...emptyVault(), exportedAt: 2, books: [book({ id: 1, title: "One" }), book({ id: 2, title: "Two" })] } as Vault));
  await store.mutate(addOne(3, "Three"));
  assert.equal(await store.settled(), true);
  assert.deepEqual(seen, [[["One", "Two"], ["One", "Two", "Three"]]]);
});
