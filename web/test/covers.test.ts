// Covers: what changing one does to a book, and the requests for the pictures a reader
// uploads ("Cover photos" in supabase/README.md).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Vault } from "../src/lib/model.ts";
import { emptyVault, readVault, writeVault } from "../src/lib/model.ts";
import type { BookFields } from "../src/lib/mutations.ts";
import { editBook, fillCover, modifyBook, withCover } from "../src/lib/mutations.ts";
import { coverAddress, ownCoverFile, ownCoverFiles, removeCovers, uploadCover } from "../src/lib/supabase/covers.ts";
import { ServerError } from "../src/lib/sync.ts";
import { book as makeBook } from "./helpers.ts";

const config = { url: "https://example.supabase.co", key: "sb_publishable_test" };
const ME = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const mine = (file: string) => `${config.url}/storage/v1/object/public/shelfmark-covers/${ME}/${file}`;

// A book as a phone left it: a photo was taken there and uploaded.
const photographed = makeBook({ id: 7, title: "Emma", authors: "Jane Austen", rating: 4, coverPath: "a1b2.jpg", coverUrl: mine("a1b2.jpg"), updatedAt: 10 });

function vaultWith(...books: ReturnType<typeof makeBook>[]): Vault {
  return { ...emptyVault(), books };
}

function fieldsOf(book: ReturnType<typeof makeBook>, change: Partial<BookFields> = {}): BookFields {
  const { title, subtitle, authors, isbn, publisher, publishedYear, language, pageCount, format, description, genres, tags, series, seriesPosition } = book;
  return { title, subtitle, authors, isbn, publisher, publishedYear, language, pageCount, format, description, genres, tags, series, seriesPosition, ...change };
}

test("another cover takes the name of the photo on the phone with it", () => {
  const changed = withCover(photographed, "  https://covers.example.org/emma.jpg ");
  assert.equal(changed.coverUrl, "https://covers.example.org/emma.jpg");
  assert.equal(changed.coverPath, "");
  // Nothing else about the book moves.
  assert.deepEqual({ ...changed, coverUrl: "", coverPath: "" }, { ...photographed, coverUrl: "", coverPath: "" });
});

test("removing the cover clears the address and the photo", () => {
  const bare = withCover(photographed, "");
  assert.equal(bare.coverUrl, "");
  assert.equal(bare.coverPath, "");
});

test("saving the form with a new cover clears coverPath in the same change", () => {
  const after = editBook(7, fieldsOf(photographed), mine("new.jpg"), 500)(vaultWith(photographed));
  assert.equal(after.books[0].coverUrl, mine("new.jpg"));
  assert.equal(after.books[0].coverPath, "");
  assert.equal(after.books[0].updatedAt, 500);
  assert.equal(after.books[0].rating, 4);
  // An empty coverPath is a default, so the document that goes to the server does not carry the field at all.
  const written = writeVault(after) as { books: Record<string, unknown>[] };
  assert.equal("coverPath" in written.books[0], false);
  assert.equal(written.books[0].coverUrl, mine("new.jpg"));
  assert.equal(readVault(written).books[0].coverPath, "");
});

test("a cover from the catalogues or a pasted address does the same", () => {
  const after = editBook(7, fieldsOf(photographed), "https://covers.openlibrary.org/b/id/5-L.jpg", 500)(vaultWith(photographed));
  assert.equal(after.books[0].coverUrl, "https://covers.openlibrary.org/b/id/5-L.jpg");
  assert.equal(after.books[0].coverPath, "");
});

test("saving the form without touching the cover leaves coverPath and coverUrl alone", () => {
  const after = editBook(7, fieldsOf(photographed, { title: "Emma, corrected", pageCount: 474 }), null, 500)(vaultWith(photographed));
  assert.equal(after.books[0].title, "Emma, corrected");
  assert.equal(after.books[0].pageCount, 474);
  assert.equal(after.books[0].coverPath, "a1b2.jpg");
  assert.equal(after.books[0].coverUrl, mine("a1b2.jpg"));
  const written = writeVault(after) as { books: Record<string, unknown>[] };
  assert.equal(written.books[0].coverPath, "a1b2.jpg");
});

test("a photo taken on the phone while the form was open survives the save", () => {
  // The form was opened on a book without a cover. Meanwhile the phone photographed one.
  const opened = makeBook({ id: 7, title: "Emma" });
  const change = editBook(7, fieldsOf(opened, { authors: "Jane Austen" }), null, 500);
  const after = change(vaultWith(photographed));
  assert.equal(after.books[0].authors, "Jane Austen");
  assert.equal(after.books[0].coverPath, "a1b2.jpg");
  assert.equal(after.books[0].coverUrl, mine("a1b2.jpg"));
});

test("other changes to a book never touch its photo", () => {
  const after = modifyBook(7, (b) => ({ ...b, rating: 5, review: "Again and again." }), 500)(vaultWith(photographed));
  assert.equal(after.books[0].coverPath, "a1b2.jpg");
  assert.equal(after.books[0].coverUrl, mine("a1b2.jpg"));
});

test("a cover that was looked up fills a gap and never replaces a cover or a photo", () => {
  const found = "https://covers.openlibrary.org/b/id/9-L.jpg";
  const bare = makeBook({ id: 1, title: "Momo" });
  assert.equal(fillCover(1, found, 5)(vaultWith(bare)).books[0].coverUrl, found);
  const withAddress = makeBook({ id: 1, title: "Momo", coverUrl: "https://example.org/momo.jpg" });
  assert.equal(fillCover(1, found, 5)(vaultWith(withAddress)).books[0].coverUrl, "https://example.org/momo.jpg");
  // A photo that only exists on a phone so far: the phone will upload it, the lookup must not win.
  const onPhone = makeBook({ id: 1, title: "Momo", coverPath: "only-here.jpg" });
  const kept = fillCover(1, found, 5)(vaultWith(onPhone)).books[0];
  assert.equal(kept.coverUrl, "");
  assert.equal(kept.coverPath, "only-here.jpg");
});

test("an own picture is told from every other address", () => {
  assert.equal(coverAddress(config, ME, "x.jpg"), mine("x.jpg"));
  assert.equal(ownCoverFile(config, ME, mine("0b9c-4f.jpg")), "0b9c-4f.jpg");
  assert.equal(ownCoverFile(config, ME, `${config.url}/storage/v1/object/public/shelfmark-covers/${OTHER}/x.jpg`), null);
  assert.equal(ownCoverFile(config, ME, `https://elsewhere.supabase.co/storage/v1/object/public/shelfmark-covers/${ME}/x.jpg`), null);
  assert.equal(ownCoverFile(config, ME, "https://covers.openlibrary.org/b/id/5-L.jpg"), null);
  assert.equal(ownCoverFile(config, ME, ""), null);
  // Nothing that could point out of the folder is taken for a file name.
  assert.equal(ownCoverFile(config, ME, mine("../" + OTHER + "/x.jpg")), null);
  assert.equal(ownCoverFile(config, ME, mine("x.jpg?download=1")), null);
});

test("the pictures of a library are listed once each", () => {
  const books = [
    { coverUrl: mine("a.jpg") },
    { coverUrl: "https://covers.openlibrary.org/b/id/5-L.jpg" },
    { coverUrl: "" },
    { coverUrl: mine("b.jpg") },
    { coverUrl: mine("a.jpg") },
    { coverUrl: `${config.url}/storage/v1/object/public/shelfmark-covers/${OTHER}/c.jpg` },
  ];
  assert.deepEqual(ownCoverFiles(config, ME, books), ["a.jpg", "b.jpg"]);
  assert.deepEqual(ownCoverFiles(config, ME, []), []);
});

// ---- the requests themselves, against a server that is played here ----

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function playServer(answer: (request: Seen) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Seen = { url: String(input), method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>) }, body: init?.body };
    seen.push(request);
    return answer(request);
  }) as typeof fetch;
  return seen;
}

test("before an account is deleted its own pictures are removed, and only those", async () => {
  const seen = playServer(() => new Response('{"message":"Successfully deleted"}', { status: 200 }));
  await removeCovers(config, "token-1", ME, [
    { coverUrl: mine("a.jpg") },
    { coverUrl: "https://covers.openlibrary.org/b/id/5-L.jpg" },
    { coverUrl: `${config.url}/storage/v1/object/public/shelfmark-covers/${OTHER}/c.jpg` },
    { coverUrl: mine("b.jpg") },
  ]);
  assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`).sort(), [
    `DELETE ${config.url}/storage/v1/object/shelfmark-covers/${ME}/a.jpg`,
    `DELETE ${config.url}/storage/v1/object/shelfmark-covers/${ME}/b.jpg`,
  ]);
  for (const request of seen) {
    assert.equal(request.headers.apikey, "sb_publishable_test");
    assert.equal(request.headers.Authorization, "Bearer token-1");
  }
});

test("a picture that cannot be removed does not stop the others, or the deletion", async () => {
  const seen = playServer((request) => {
    if (request.url.endsWith("/a.jpg")) throw new TypeError("fetch failed");
    if (request.url.endsWith("/b.jpg")) return new Response('{"statusCode":"403"}', { status: 400 });
    return new Response("{}", { status: 200 });
  });
  // Twenty pictures, more than go out at once.
  const books = ["a", "b", ..."cdefghijklmnopqrst"].map((name) => ({ coverUrl: mine(`${name}.jpg`) }));
  await removeCovers(config, "token-1", ME, books);
  assert.equal(seen.length, 20);
  assert.equal(new Set(seen.map((r) => r.url)).size, 20);
});

test("a library without own pictures asks the server for nothing", async () => {
  const seen = playServer(() => new Response("{}", { status: 200 }));
  await removeCovers(config, "token-1", ME, [{ coverUrl: "" }, { coverUrl: "https://example.org/x.jpg" }]);
  assert.equal(seen.length, 0);
});

test("a picture is uploaded as the plain body, below the folder of the account", async () => {
  const seen = playServer(() => new Response('{"Key":"shelfmark-covers/x"}', { status: 200 }));
  const picture = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  const address = await uploadCover(config, "token-1", ME, picture);
  assert.equal(seen.length, 1);
  const [request] = seen;
  assert.equal(request.method, "POST");
  assert.match(request.url, new RegExp(`^${config.url}/storage/v1/object/shelfmark-covers/${ME}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(request.headers.apikey, "sb_publishable_test");
  assert.equal(request.headers.Authorization, "Bearer token-1");
  assert.equal(request.headers["Content-Type"], "image/jpeg");
  assert.equal(request.headers["x-upsert"], "true");
  assert.equal(request.body, picture);
  // The address everybody can show is the public one of the same file.
  assert.equal(address, request.url.replace("/object/shelfmark-covers/", "/object/public/shelfmark-covers/"));
  assert.equal(ownCoverFile(config, ME, address), request.url.split("/").pop());
});

test("a refused upload, or no connection, is an error and gives no address", async () => {
  playServer(() => new Response('{"statusCode":"413","error":"Payload too large"}', { status: 400 }));
  const picture = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  await assert.rejects(uploadCover(config, "token-1", ME, picture), (error: unknown) => error instanceof ServerError && error.reason === "http_400");
  playServer(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(uploadCover(config, "token-1", ME, picture), (error: unknown) => error instanceof ServerError && error.reason === "network");
});
