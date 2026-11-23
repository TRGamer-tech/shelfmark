// The Android app reads a vault strictly (kotlinx.serialization without leniency): a
// null, a missing field that has no default, a number where a text belongs or a word
// it does not know as a list or format, and it refuses the whole document. This checks
// what the website writes against the classes of the app, field by field. The file
// e2e/fixtures/vault-from-web.json is written by the end to end tests from a real
// session, and read by a test of the app as well.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { emptyVault, prefsOf, readVault, writeVault } from "../src/lib/model.ts";
import { addBook, addOrnament, addRequest, answerRequest, createShelf, logSession, saveCustomTheme, saveGoal, saveNote, savePurchase, saveQuote, setOnShelf, setPrefs, setStatus } from "../src/lib/mutations.ts";
import { scaledSize } from "../src/lib/picture.ts";
import { book, goal, purchase, session } from "./helpers.ts";

type Kind = "long" | "int" | "float" | "string" | "boolean" | string[] | { list: Shape } | { object: Shape };
/** Field name to [kind, required]. A field that is not required has a default in the app. */
type Shape = Record<string, [Kind, boolean]>;

const STATUS = ["NONE", "WISHLIST", "READING", "READ", "ABANDONED"];
const FORMAT = ["UNKNOWN", "HARDCOVER", "PAPERBACK", "EBOOK", "AUDIOBOOK", "OTHER"];
const ORNAMENTS = ["PLANT", "CACTUS", "CANDLE", "MUG", "VASE", "LAMP", "GLOBE", "CLOCK", "TROPHY", "FRAME", "PUMPKIN", "BOOKEND", "CAT", "BOOKSTACK"];

const BOOK: Shape = {
  id: ["long", false], title: ["string", true], subtitle: ["string", false], authors: ["string", false], isbn: ["string", false],
  publisher: ["string", false], publishedYear: ["string", false], language: ["string", false], pageCount: ["int", false],
  format: [FORMAT, false], description: ["string", false], coverUrl: ["string", false], coverPath: ["string", false],
  status: [STATUS, false], ownership: [["OWNED", "BORROWED", "NOT_OWNED"], false], borrowedFrom: ["string", false],
  lendable: ["boolean", false], lentTo: ["string", false], lentSince: ["long", false], rating: ["float", false], spice: ["int", false],
  review: ["string", false], startedOn: ["long", false], finishedOn: ["long", false], currentPage: ["int", false],
  readCount: ["int", false], favorite: ["boolean", false], genres: ["string", false], tags: ["string", false],
  series: ["string", false], seriesPosition: ["float", false], addedAt: ["long", false], updatedAt: ["long", false],
};
const THEME: Shape = { id: ["string", true], name: ["string", true], background: ["int", true], card: ["int", true], accent: ["int", true], text: ["int", true] };
const VAULT: Shape = {
  exportedAt: ["long", true],
  books: [{ list: BOOK }, true],
  shelves: [{ list: { id: ["long", false], name: ["string", true], position: ["int", false], createdAt: ["long", false] } }, true],
  links: [{ list: { bookId: ["long", true], shelfId: ["long", true] } }, true],
  quotes: [{ list: { id: ["long", false], bookId: ["long", true], text: ["string", true], page: ["int", false], note: ["string", false], fromOcr: ["boolean", false], createdAt: ["long", false] } }, true],
  sessions: [{ list: { id: ["long", false], bookId: ["long", true], startedAt: ["long", false], startPage: ["int", false], endPage: ["int", false], minutes: ["float", false], note: ["string", false] } }, false],
  notes: [{ list: { id: ["long", false], bookId: ["long", true], title: ["string", false], text: ["string", true], page: ["int", false], createdAt: ["long", false] } }, false],
  goals: [{ list: { id: ["long", false], name: ["string", false], kind: [["BOOKS", "PAGES", "MINUTES"], false], target: ["int", true], startDay: ["long", true], endDay: ["long", true], repeat: [["ONCE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"], false], archived: ["boolean", false], createdAt: ["long", false] } }, false],
  purchases: [{ list: { id: ["long", false], bookId: ["long", true], day: ["long", true], price: ["float", false], currency: ["string", false], store: ["string", false], note: ["string", false] } }, false],
  ornaments: [{ list: { id: ["long", false], shelfKey: ["string", true], kind: [ORNAMENTS, true], position: ["int", false] } }, false],
  requests: [{ list: { id: ["string", true], incoming: ["boolean", true], bookRemoteId: ["long", true], bookTitle: ["string", true], bookAuthors: ["string", false], isbn: ["string", false], peerId: ["string", true], peerName: ["string", true], note: ["string", false], status: [["PENDING", "ACCEPTED", "DECLINED"], false], createdAt: ["long", false], answeredAt: ["long", false] } }, false],
  prefs: [{ object: { profileName: ["string", false], shareStatus: ["boolean", false], shareRatings: ["boolean", false], minutesPerPage: ["float", false], theme: ["string", false], customThemes: [{ list: THEME }, false], viewMode: ["string", false], sort: ["string", false], motion: ["boolean", false] } }, false],
};

/** Everything the app would trip over, or would silently drop because it has no field for it. */
function problemsOf(value: unknown, shape: Shape, where: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${where}: not an object`];
  const found: string[] = [];
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!(key in shape)) found.push(`${where}.${key}: a field the app has no place for`);
  for (const [key, [kind, required]] of Object.entries(shape)) {
    const at = `${where}.${key}`;
    const v = object[key];
    if (v === undefined) {
      if (required) found.push(`${at}: missing, and the app has no default for it`);
      continue;
    }
    if (v === null) {
      found.push(`${at}: null`);
    } else if (kind === "string") {
      if (typeof v !== "string") found.push(`${at}: not a text`);
    } else if (kind === "boolean") {
      if (typeof v !== "boolean") found.push(`${at}: not true or false`);
    } else if (kind === "long") {
      if (!Number.isSafeInteger(v)) found.push(`${at}: not a whole number that survives JavaScript`);
    } else if (kind === "int") {
      if (!Number.isInteger(v) || Math.abs(v as number) > 2147483647) found.push(`${at}: not a 32 bit whole number`);
    } else if (kind === "float") {
      if (typeof v !== "number" || !Number.isFinite(v)) found.push(`${at}: not a number`);
    } else if (Array.isArray(kind)) {
      if (typeof v !== "string" || !kind.includes(v)) found.push(`${at}: ${JSON.stringify(v)} is not one of ${kind.join(", ")}`);
    } else if ("list" in kind) {
      if (!Array.isArray(v)) found.push(`${at}: not a list`);
      else v.forEach((item, index) => found.push(...problemsOf(item, kind.list, `${at}[${index}]`)));
    } else {
      found.push(...problemsOf(v, kind.object, at));
    }
  }
  return found;
}

test("the checker itself knows what the app would refuse", () => {
  const good = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/samples/vault.json", import.meta.url)), "utf8"));
  assert.deepEqual(problemsOf(good, VAULT, "vault"), []);
  const bad = structuredClone(good);
  bad.books[0].lentSince = null;
  bad.books[1].status = "PAUSED";
  bad.books[2].pageCount = 12.5;
  delete bad.goals[0].startDay;
  bad.requests[0].incoming = "yes";
  bad.prefs.customThemes[0].card = "#fff";
  const found = problemsOf(bad, VAULT, "vault");
  assert.equal(found.length, 6, found.join("\n"));
});

test("whatever the website does to a library, the app can read the result", () => {
  // A session as busy as a person can make it, on an account that starts with nothing.
  const novel = book({ id: 1795400000000001, title: "Emma", authors: "Jane Austen", pageCount: 474, format: "PAPERBACK", isbn: "9780141439587" });
  const changes = [
    setPrefs({ profileName: "Anna", theme: "ember", viewMode: "SPINES", sort: "RATING", motion: false, minutesPerPage: 1.7, shareRatings: false }),
    saveCustomTheme({ id: "moor", name: "Moor", background: -15723248, card: -14932964, accent: -8665985, text: -1511192 }),
    createShelf(1795400000000002, "Holiday", 1795400000000),
    addBook(novel, [1795400000000002], 1795400000000),
    addBook(book({ id: 1795400000000003, title: "Wish", status: "WISHLIST", ownership: "NOT_OWNED", lendable: false }), [], 1795400000001),
    setStatus(novel.id, "READING", 20780, 1795400000002),
    logSession(session({ id: 1795400000000004, bookId: novel.id, startedAt: 1795400000003, startPage: 0, endPage: 474, minutes: 312.5, note: "In one go" }), 20781, 1795400000004),
    setOnShelf(1795400000000003, 1795400000000002, true),
    saveQuote({ id: 1795400000000005, bookId: novel.id, text: "Badly done, Emma!", page: 351, note: "", fromOcr: false, createdAt: 1795400000005 }),
    saveNote({ id: 1795400000000006, bookId: novel.id, title: "", text: "Box Hill.", page: 0, createdAt: 1795400000006 }),
    saveGoal(goal({ id: 1795400000000007, kind: "PAGES", target: 30, repeat: "DAILY", createdAt: 1795400000007 })),
    savePurchase(purchase({ id: 1795400000000008, bookId: novel.id, day: 20770, price: 9.95, currency: "GBP", store: "Shop" })),
    addOrnament(1795400000000009, "list_1795400000000002", "CAT", 2),
    addOrnament(1795400000000010, "READ", "CANDLE", 0),
    addRequest({ id: "0b0e1c1e-5d6f-4a7b-8c9d-0e1f2a3b4c5d", incoming: true, bookRemoteId: novel.id, bookTitle: "Emma", bookAuthors: "Jane Austen", isbn: "9780141439587", peerId: "22222222-2222-4222-8222-222222222222", peerName: "Ben", note: "", status: "PENDING", createdAt: 1795400000008, answeredAt: null }),
    answerRequest("0b0e1c1e-5d6f-4a7b-8c9d-0e1f2a3b4c5d", true, 20782, 1795400000009),
  ];
  const vault = changes.reduce((doc, change) => change(doc), emptyVault());
  const written = JSON.parse(JSON.stringify(writeVault({ ...vault, exportedAt: 1795400000010 })));
  assert.deepEqual(problemsOf(written, VAULT, "vault"), []);
  // And it says what was meant.
  const back = readVault(written);
  assert.equal(back.books[0].status, "READ");
  assert.equal(back.books[0].lentTo, "Ben");
  assert.equal(back.books[0].lentSince, 20782);
  assert.equal(back.sessions[0].minutes, 312.5);
  assert.equal(prefsOf(back).sort, "RATING");
  assert.equal(prefsOf(back).motion, false);
  assert.deepEqual(writeVault(back), written);
  // An empty library is a document too.
  assert.deepEqual(problemsOf(JSON.parse(JSON.stringify(writeVault(emptyVault()))), VAULT, "vault"), []);
});

test("the vault a real session of the website left on the server is one the app can read", (t) => {
  const path = fileURLToPath(new URL("../e2e/fixtures/vault-from-web.json", import.meta.url));
  if (!existsSync(path)) {
    t.skip("e2e/fixtures/vault-from-web.json is written by npm run e2e");
    return;
  }
  const text = readFileSync(path, "utf8");
  const vault = JSON.parse(text);
  assert.deepEqual(problemsOf(vault, VAULT, "vault"), []);
  // What the fixture is meant to hold, so that the test of the app has something to chew on.
  assert.ok(vault.books.length >= 2);
  assert.ok(vault.books.some((b: Record<string, unknown>) => b.rating && b.review && b.startedOn && b.finishedOn));
  assert.ok(vault.shelves.length >= 1 && vault.links.length >= 1);
  for (const part of ["quotes", "sessions", "notes", "purchases", "goals", "ornaments", "requests"]) assert.ok(vault[part].length >= 1, part);
  assert.equal(typeof vault.prefs.profileName, "string");
  // Reading it here and writing it back changes nothing.
  assert.deepEqual(writeVault(readVault(vault)), vault);
});

test("a cover picture is scaled to at most 1000 pixels on the longer side", () => {
  assert.deepEqual(scaledSize(1600, 2400), [667, 1000]);
  assert.deepEqual(scaledSize(4000, 3000), [1000, 750]);
  assert.deepEqual(scaledSize(1000, 1000), [1000, 1000]);
  // Small pictures are not blown up.
  assert.deepEqual(scaledSize(300, 450), [300, 450]);
  assert.deepEqual(scaledSize(5000, 3), [1000, 1]);
});
