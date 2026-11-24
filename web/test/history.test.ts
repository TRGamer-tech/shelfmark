// The earlier versions of a library that the server keeps (src/lib/history.ts), and how
// the page takes over one that was brought back (VaultStore.reread).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readVersions, restoreProblemKey } from "../src/lib/history.ts";
import { readVault } from "../src/lib/model.ts";
import { addBook } from "../src/lib/mutations.ts";
import { ServerError, VaultStore } from "../src/lib/sync.ts";
import type { VaultApi } from "../src/lib/sync.ts";
import { book, sample } from "./helpers.ts";

test("the list of versions is read as the server answers it, the newest first", () => {
  const answer = { versions: [{ revision: 3, at: 1795313600000, books: 5 }, { revision: 7, at: 1795400000000, books: 6 }, { revision: 5, at: 1795350000000, books: 0 }] };
  assert.deepEqual(readVersions(answer), [
    { revision: 7, at: 1795400000000, books: 6 },
    { revision: 5, at: 1795350000000, books: 0 },
    { revision: 3, at: 1795313600000, books: 5 },
  ]);
  // None kept yet.
  assert.deepEqual(readVersions({ versions: [] }), []);
  // What is no version is left out, and what is missing of one is nothing.
  assert.deepEqual(readVersions({ versions: [null, "seven", { at: 5 }, { revision: 0 }, { revision: "9" }, { revision: 2 }, { revision: 4, at: "then", books: -3 }] }), [
    { revision: 4, at: 0, books: 0 },
    { revision: 2, at: 0, books: 0 },
  ]);
  // Anything else than the answer is an empty list, not a fault.
  for (const odd of [null, undefined, [], "versions", { versions: "none" }, {}]) assert.deepEqual(readVersions(odd), []);
});

test("why a version was not brought back has its own words", () => {
  // The reader's last changes could not be saved: nothing is brought back over them.
  assert.equal(restoreProblemKey("unsaved"), "web_history_unsaved");
  // Tidied away since the list was shown.
  assert.equal(restoreProblemKey("unknown_version"), "history_gone");
  // A server from before earlier versions were kept.
  assert.equal(restoreProblemKey("setup"), "history_unavailable");
  // Everything else is said as for any call.
  assert.equal(restoreProblemKey("network"), null);
});

/** A server in memory that keeps a library by revision, and earlier versions of it as the real one does on bringing one back. */
class Server implements VaultApi {
  revision = 0;
  payload: unknown = null;
  kept = new Map<number, unknown>();
  pushes = 0;
  offline = false;

  async pull(known: number) {
    await Promise.resolve();
    if (this.offline) throw new ServerError("network");
    return { revision: this.revision, payload: this.revision === known || this.revision === 0 ? null : structuredClone(this.payload) };
  }

  async push(payload: Record<string, unknown>, expected: number) {
    await Promise.resolve();
    if (this.offline) throw new ServerError("network");
    this.pushes++;
    if (expected !== this.revision) throw new ServerError("conflict");
    this.payload = structuredClone(payload);
    this.revision++;
    return { revision: this.revision };
  }

  put(document: unknown) {
    this.payload = structuredClone(document);
    this.revision++;
  }

  /** shelfmark_vault_restore: the earlier version becomes a new revision, and what it replaces is kept in turn. */
  restore(revision: number) {
    this.kept.set(this.revision, this.payload);
    this.payload = structuredClone(this.kept.get(revision));
    this.revision++;
  }
}

const good = (): Record<string, any> => JSON.parse(sample("vault.json"));
const titles = (store: VaultStore) => store.getState().vault.books.map((b) => b.title);

test("an earlier version that was brought back is read at once, and the page shows it", async () => {
  const server = new Server();
  server.put(good());
  const store = new VaultStore(server);
  await store.load();
  await store.mutate(addBook(book({ id: 77, title: "Added since" }), [], 1));
  assert.equal(titles(store).includes("Added since"), true);
  // The version from before that change is brought back, as shelfmark_vault_restore does.
  server.kept.set(1, good());
  server.restore(1);
  await store.reread();
  assert.equal(titles(store).includes("Added since"), false);
  assert.equal(store.getState().revision, 3);
  assert.equal(store.getState().status, "idle");
  // What it replaced is kept on the server, with the book that was added: it can be brought back in turn.
  assert.equal(readVault(server.kept.get(2)).books.some((b) => b.title === "Added since"), true);
  server.restore(2);
  await store.reread();
  assert.equal(titles(store).includes("Added since"), true);
  // The next change builds on what was brought back, with no conflict on the way.
  const before = server.pushes;
  await store.mutate(addBook(book({ id: 78, title: "After" }), [], 2));
  assert.equal(server.pushes, before + 1);
  assert.equal(readVault(server.payload).books.some((b) => b.title === "Added since"), true);
});

test("reading again waits for a save that is on its way, and says so when it does not work", async () => {
  const server = new Server();
  server.put(good());
  const store = new VaultStore(server);
  await store.load();
  // A change is being saved when the reading starts: it is saved first, and nothing of it is lost.
  const saving = store.mutate(addBook(book({ id: 77, title: "Just typed" }), [], 1));
  await store.reread();
  await saving;
  assert.equal(readVault(server.payload).books.some((b) => b.title === "Just typed"), true);
  assert.equal(store.getState().pending, 0);
  // Without a connection the page must not go on as if it showed the library that is on the server now.
  server.offline = true;
  await assert.rejects(() => store.reread(), (error) => error instanceof ServerError && error.reason === "network");
  server.offline = false;
  // A version that this website cannot read closes the library, as any other such document would.
  server.put({ ...good(), format: 2 });
  await store.reread();
  assert.equal(store.getState().status, "failed");
  assert.equal(store.getState().problem, "newer");
});
