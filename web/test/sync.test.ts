// Saving by revision: what the website does when somebody else saved in between.

import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyVault, readVault, writeVault } from "../src/lib/model.ts";
import { addBook, modifyBook } from "../src/lib/mutations.ts";
import { ServerError, VaultStore } from "../src/lib/sync.ts";
import type { VaultApi } from "../src/lib/sync.ts";
import { book } from "./helpers.ts";

/** A server in memory that behaves like shelfmark_vault_pull and shelfmark_vault_push. */
class FakeServer implements VaultApi {
  revision = 0;
  payload: Record<string, unknown> | null = null;
  pushes = 0;
  pulls = 0;
  /** Set to make the next calls fail as if there were no connection. */
  offline = false;
  /** Runs before a push is looked at, to let "somebody else" save first. */
  beforePush: (() => void) | null = null;
  /** The push goes through but its answer gets lost on the way back. */
  loseAnswer = false;

  async pull(known: number) {
    // A real answer never arrives in the same instant.
    await Promise.resolve();
    this.pulls++;
    if (this.offline) throw new TypeError("fetch failed");
    return { revision: this.revision, payload: this.revision === known || this.revision === 0 ? null : structuredClone(this.payload) };
  }

  async push(payload: Record<string, unknown>, expected: number) {
    await Promise.resolve();
    this.pushes++;
    if (this.offline) throw new TypeError("fetch failed");
    const hook = this.beforePush;
    this.beforePush = null;
    hook?.();
    if (expected !== this.revision) throw new ServerError("conflict");
    this.payload = structuredClone(payload);
    this.revision++;
    if (this.loseAnswer) {
      this.loseAnswer = false;
      throw new TypeError("fetch failed");
    }
    return { revision: this.revision };
  }

  /** What another device does: fetch, change, save. */
  saveFromElsewhere(change: (vault: ReturnType<typeof emptyVault>) => ReturnType<typeof emptyVault>) {
    const current = this.payload ? readVault(this.payload) : emptyVault();
    this.payload = writeVault(change(current));
    this.revision++;
  }

  titles(): string[] {
    return this.payload ? readVault(this.payload).books.map((b) => b.title) : [];
  }
}

const emma = book({ id: 1, title: "Emma" });
const dune = book({ id: 2, title: "Dune" });
const momo = book({ id: 3, title: "Momo" });

test("an account without a vault starts empty and the first save creates it", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server, { now: () => 42 });
  assert.equal(store.getState().status, "loading");
  await store.load();
  assert.equal(store.getState().status, "idle");
  assert.equal(store.getState().revision, 0);
  assert.equal(store.getState().vault.books.length, 0);

  await store.mutate(addBook(emma, [], 1));
  assert.equal(server.revision, 1);
  assert.deepEqual(server.titles(), ["Emma"]);
  assert.equal(server.payload!.exportedAt, 42);
  assert.equal(store.getState().revision, 1);
  assert.equal(store.getState().status, "saved");
  assert.equal(store.getState().pending, 0);
});

test("a change is shown at once, before the server has answered", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server);
  await store.load();
  const saving = store.mutate(addBook(emma, [], 1));
  assert.deepEqual(
    store.getState().vault.books.map((b) => b.title),
    ["Emma"],
  );
  assert.equal(store.getState().status, "saving");
  assert.equal(server.revision, 0);
  await saving;
  assert.equal(store.getState().status, "saved");
});

test("when somebody else saved first, the change is applied to their document", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server);
  await store.load();
  await store.mutate(addBook(emma, [], 1));

  // The phone adds a book and rates Emma while this tab still holds revision 1.
  server.beforePush = () => server.saveFromElsewhere((v) => modifyBook(1, (b) => ({ ...b, rating: 4 }), 5)(addBook(dune, [], 5)(v)));
  await store.mutate(modifyBook(1, (b) => ({ ...b, review: "Lovely." }), 6));

  assert.equal(server.revision, 3);
  const saved = readVault(server.payload);
  assert.deepEqual(saved.books.map((b) => b.title).sort(), ["Dune", "Emma"]);
  const savedEmma = saved.books.find((b) => b.id === 1)!;
  // Neither change is lost: the phone's stars and this tab's review are both there.
  assert.equal(savedEmma.rating, 4);
  assert.equal(savedEmma.review, "Lovely.");
  assert.equal(store.getState().revision, 3);
  assert.equal(store.getState().vault.books.length, 2);
  assert.equal(store.getState().status, "saved");
});

test("changes made while a save is on its way are saved right after it", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server);
  await store.load();
  const first = store.mutate(addBook(emma, [], 1));
  const second = store.mutate(addBook(dune, [], 2));
  const third = store.mutate(addBook(momo, [], 3));
  await Promise.all([first, second, third]);
  assert.deepEqual(server.titles(), ["Emma", "Dune", "Momo"]);
  // Not one save per change: the two that came later went together.
  assert.equal(server.pushes, 2);
  assert.equal(store.getState().pending, 0);
});

test("without a connection nothing is lost and the save is tried again", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server);
  await store.load();
  server.offline = true;
  await store.mutate(addBook(emma, [], 1));
  assert.equal(store.getState().status, "error");
  assert.equal(store.getState().problem, "network");
  assert.equal(store.getState().pending, 1);
  // The reader still sees what they did.
  assert.equal(store.getState().vault.books.length, 1);
  await store.mutate(addBook(dune, [], 2));
  assert.equal(store.getState().pending, 2);

  server.offline = false;
  await store.flush();
  assert.deepEqual(server.titles(), ["Emma", "Dune"]);
  assert.equal(store.getState().status, "saved");
  assert.equal(store.getState().pending, 0);
});

test("a save whose answer got lost is not made twice", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server);
  await store.load();
  server.loseAnswer = true;
  await store.mutate(addBook(emma, [], 1));
  // The server has the book, this tab does not know it yet.
  assert.equal(server.revision, 1);
  assert.equal(store.getState().status, "error");
  await store.flush();
  // The retry met a conflict, fetched, applied the change again, and the book is there once.
  assert.deepEqual(server.titles(), ["Emma"]);
  assert.equal(store.getState().vault.books.length, 1);
  assert.equal(store.getState().pending, 0);
});

test("looking for news is cheap and brings the phone's changes", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server);
  await store.load();
  await store.mutate(addBook(emma, [], 1));
  let notified = 0;
  store.subscribe(() => notified++);

  await store.refresh();
  assert.equal(notified, 0);

  server.saveFromElsewhere((v) => addBook(dune, [], 5)(v));
  await store.refresh();
  assert.equal(notified, 1);
  assert.equal(store.getState().revision, 2);
  assert.deepEqual(
    store.getState().vault.books.map((b) => b.title),
    ["Emma", "Dune"],
  );

  // No connection while looking is not worth a word.
  server.offline = true;
  await store.refresh();
  assert.equal(store.getState().status, "saved");
});

test("a save that keeps meeting conflicts gives up for now and keeps the change", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server, { maxConflicts: 2 });
  await store.load();
  // Somebody saves before each of our attempts.
  const meddle = () => {
    server.saveFromElsewhere((v) => v);
    server.beforePush = meddle;
  };
  server.beforePush = meddle;
  await store.mutate(addBook(emma, [], 1));
  assert.equal(store.getState().status, "error");
  assert.equal(store.getState().problem, "conflict");
  assert.equal(store.getState().pending, 1);
  server.beforePush = null;
  await store.flush();
  assert.deepEqual(server.titles(), ["Emma"]);
});

test("a first fetch that fails is told apart from an empty library", async () => {
  const server = new FakeServer();
  server.offline = true;
  const store = new VaultStore(server);
  await store.load();
  assert.equal(store.getState().status, "failed");
  // What the reader does meanwhile waits, and is not saved over a library nobody has seen.
  await store.mutate(addBook(emma, [], 1));
  assert.equal(server.pushes, 0);
  server.offline = false;
  server.saveFromElsewhere((v) => addBook(dune, [], 5)(v));
  await store.load();
  await store.settled();
  assert.deepEqual(server.titles().sort(), ["Dune", "Emma"]);
});

test("saved tells the page what the server now holds", async () => {
  const server = new FakeServer();
  const seen: number[] = [];
  const store = new VaultStore(server, { onSaved: (vault) => seen.push(vault.books.length) });
  await store.load();
  await store.mutate(addBook(emma, [], 1));
  await store.mutate(addBook(dune, [], 2));
  assert.deepEqual(seen, [1, 2]);
});

test("an answer that was overtaken by a save is not taken for news", async () => {
  const server = new FakeServer();
  const store = new VaultStore(server);
  await store.load();
  await store.mutate(addBook(emma, [], 1));
  // The look goes out, and before its answer is back a change is made and saved.
  const looking = store.refresh();
  const saving = store.mutate(addBook(dune, [], 2));
  await Promise.all([looking, saving]);
  assert.equal(store.getState().revision, 2);
  assert.deepEqual(
    store.getState().vault.books.map((b) => b.title),
    ["Emma", "Dune"],
  );
  // The next change is saved without having to start over.
  const pullsBefore = server.pulls;
  await store.mutate(addBook(momo, [], 3));
  assert.equal(server.revision, 3);
  assert.equal(server.pulls, pullsBefore);
});
