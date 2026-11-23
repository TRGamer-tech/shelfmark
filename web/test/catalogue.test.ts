// The cases of CatalogueTest.kt: parsers run against responses recorded from the real services.

import assert from "node:assert/strict";
import { test } from "node:test";
import { googleBooks } from "../src/lib/catalogue/googleBooks.ts";
import type { HttpFetcher } from "../src/lib/catalogue/http.ts";
import { enc } from "../src/lib/catalogue/http.ts";
import { BookLookup, CataloguesFailed, merge } from "../src/lib/catalogue/lookup.ts";
import { buildQuery, openLibrary } from "../src/lib/catalogue/openLibrary.ts";
import { authorLine, parseFormat, remoteBook, stripHtml, toBook } from "../src/lib/catalogue/remoteBook.ts";
import type { BookSource } from "../src/lib/catalogue/source.ts";
import { fixture } from "./helpers.ts";

/** Serves fixtures by URL fragment, "not found" (null) for everything else. */
function fakeHttp(routes: [string, string][], seen: string[] = []): HttpFetcher {
  return async (url) => {
    seen.push(url);
    const route = routes.find(([fragment]) => url.includes(fragment));
    return route ? fixture(route[1]) : null;
  };
}

const failing: HttpFetcher = async () => {
  throw new Error("HTTP 429");
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("Open Library search prefers the edition in the user's language", async () => {
  const seen: string[] = [];
  const api = openLibrary(fakeHttp([["search.json", "ol_search.json"]], seen));
  const results = await api.search("der vorleser schlink", 5, "de", false);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("q=der+vorleser+schlink"));
  assert.ok(seen[0].includes("lang=de"));
  const first = results[0];
  assert.equal(first.title, "Der Vorleser");
  assert.deepEqual(first.authors, ["Bernhard Schlink"]);
  assert.equal(first.isbn, "9783257229530");
  assert.equal(first.publisher, "Diogenes");
  assert.equal(first.year, "1997");
  assert.equal(first.pageCount, 206);
  assert.equal(first.coverUrl, "https://covers.openlibrary.org/b/id/8782586-L.jpg");
  assert.equal(results.length, 2);
});

test("Open Library by ISBN combines edition, data and the blurb of the work", async () => {
  const api = openLibrary(
    fakeHttp([
      ["api/books", "ol_data.json"],
      ["/isbn/", "ol_isbn.json"],
      ["/works/OL14871157W.json", "ol_work.json"],
    ]),
  );
  const book = (await api.byIsbn("9783257229530", "de"))!;
  assert.equal(book.title, "Der Vorleser");
  assert.deepEqual(book.authors, ["Bernhard Schlink"]);
  assert.equal(book.pageCount, 206);
  assert.equal(book.publisher, "Diogenes");
  assert.equal(book.year, "2000");
  assert.equal(book.format, "PAPERBACK");
  assert.equal(book.language, "ger");
  assert.ok(book.description.startsWith("Sie ist reizbar"));
  assert.ok(book.coverUrl.startsWith("https://covers.openlibrary.org/"));
});

test("a slow extra of Open Library does not cost the record that is already there", async () => {
  // The edition record never arrives. What the other view of the edition knows is still returned.
  const http: HttpFetcher = (url) => (url.includes("api/books") ? Promise.resolve(fixture("ol_data.json")) : new Promise(() => undefined));
  const started = Date.now();
  const book = (await openLibrary(http, 100).byIsbn("9783257229530", "de"))!;
  assert.equal(book.title, "Der Vorleser");
  assert.deepEqual(book.authors, ["Bernhard Schlink"]);
  assert.equal(book.format, "UNKNOWN");
  assert.ok(Date.now() - started < 1_000);
});

test("Open Library answers null for an unknown ISBN", async () => {
  const api = openLibrary(async (url) => (url.includes("api/books") ? "{}" : null));
  assert.equal(await api.byIsbn("9780000000002", "en"), null);
});

test("Google volumes are parsed and cleaned", async () => {
  const api = googleBooks(fakeHttp([["volumes", "google_volumes.json"]]));
  const results = await api.search("vorleser", 10, "de", false);
  const first = results[0];
  assert.equal(first.title, "Der Vorleser");
  assert.equal(first.subtitle, "Roman");
  assert.equal(first.isbn, "9783257229530");
  assert.equal(first.year, "1997");
  assert.equal(first.pageCount, 208);
  assert.equal(first.description, "Sie ist reizbar, rätselhaft und viel älter als er.\n\nEin Roman über Schuld & Scham.");
  assert.ok(first.coverUrl.startsWith("https://"));
  assert.ok(!first.coverUrl.includes("edge=curl"));
  // Old editions without a code still come through, that is what the title search is for.
  assert.equal(results[1].isbn, "");
  assert.equal(authorLine(results[1]), "Erika Muster, Hans Beispiel");
  assert.equal(results[1].year, "1953");
});

test("the Google key is appended only when set", async () => {
  const seen: string[] = [];
  await googleBooks(fakeHttp([], seen), () => "").byIsbn("9783257229530", "de");
  await googleBooks(fakeHttp([], seen), () => "my key").byIsbn("9783257229530", "de");
  assert.ok(!seen[0].includes("key="));
  assert.ok(seen[1].endsWith("&key=my+key"));
});

test("the lookup merges both catalogues for an ISBN", async () => {
  const ol = openLibrary(
    fakeHttp([
      ["api/books", "ol_data.json"],
      ["/isbn/", "ol_isbn.json"],
    ]),
  );
  const google = googleBooks(fakeHttp([["volumes", "google_volumes.json"]]));
  const book = (await new BookLookup([ol, google]).byIsbn("9783257229530", "de"))!;
  assert.equal(book.title, "Der Vorleser");
  // The first catalogue wins where both know, the second fills the gaps.
  assert.equal(book.pageCount, 206);
  assert.equal(book.subtitle, "Roman");
  assert.ok(book.description.startsWith("Sie ist reizbar"));
  assert.equal(book.format, "PAPERBACK");
  assert.ok(book.coverUrl.includes("openlibrary"));
});

test("the lookup survives one catalogue being down", async () => {
  const google = googleBooks(failing);
  const ol = openLibrary(fakeHttp([["search.json", "ol_search.json"]]));
  const results = await new BookLookup([ol, google]).search("der vorleser", 20, "de");
  assert.equal(results[0].title, "Der Vorleser");
});

test("the lookup fails only when every catalogue fails", async () => {
  const lookup = new BookLookup([openLibrary(failing), googleBooks(failing)]);
  await assert.rejects(lookup.search("anything"), CataloguesFailed);
  await assert.rejects(lookup.byIsbn("9783257229530"), CataloguesFailed);
});

test("a slow catalogue does not block the others", async () => {
  let aborted = false;
  const slow: BookSource = {
    name: "slow",
    suggests: true,
    async search(_q, _l, _lang, _p, signal) {
      signal?.addEventListener("abort", () => (aborted = true));
      await wait(1_500);
      return [];
    },
    async byIsbn() {
      await wait(1_500);
      return null;
    },
  };
  const ol = openLibrary(fakeHttp([["search.json", "ol_search.json"]]));
  const started = Date.now();
  const results = await new BookLookup([slow, ol], { timeoutMs: 200 }).search("der vorleser", 20, "de");
  assert.equal(results.length, 2);
  assert.ok(Date.now() - started < 1_000);
  // The request that took too long is cut off, not left running.
  assert.equal(aborted, true);
});

test("search results are interleaved and deduplicated", () => {
  const a = [remoteBook({ title: "Der Vorleser", authors: ["Bernhard Schlink"], isbn: "9783257229530" }), remoteBook({ title: "Homo faber", authors: ["Max Frisch"] })];
  const b = [remoteBook({ title: "DER VORLESER.", authors: ["Bernhard Schlink"], description: "Blurb" }), remoteBook({ title: "Stiller", authors: ["Max Frisch"] })];
  const merged = merge([a, b]);
  assert.deepEqual(
    merged.map((book) => book.title),
    ["Der Vorleser", "Homo faber", "Stiller"],
  );
  assert.equal(merged[0].description, "Blurb");
  assert.equal(merged[0].isbn, "9783257229530");
});

test("typing adds a prefix wildcard to the last word", () => {
  assert.equal(buildQuery("der vorl", true), "der vorl*");
  assert.equal(buildQuery("Grimm märch", true).toLowerCase(), "grimm märch*");
  // A finished word (trailing space), a one letter stub, or a submitted search stay literal.
  assert.equal(buildQuery("der vorleser ", true), "der vorleser");
  assert.equal(buildQuery("der v", true), "der v");
  assert.equal(buildQuery("der vorl", false), "der vorl");
  // Search syntax characters cannot break the query.
  assert.equal(buildQuery('title:(foo) "bar', true), "title foo bar*");
  assert.equal(buildQuery(" :) ", true), "");
});

test("suggest mode sends the wildcard", async () => {
  const seen: string[] = [];
  await new BookLookup([openLibrary(fakeHttp([["search.json", "ol_search.json"]], seen))]).search("der vorl", 6, "de", true);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("q=der+vorl*") || seen[0].includes("q=der+vorl%2A"));
});

test("a blank query does not hit the network", async () => {
  assert.deepEqual(await new BookLookup([openLibrary(failing)]).search("   "), []);
});

test("queries are encoded the way the catalogues were tried with", () => {
  assert.equal(enc("der vorleser"), "der+vorleser");
  assert.equal(enc("pica.isb=978"), "pica.isb%3D978");
  assert.equal(enc("(a or b)"), "%28a+or+b%29");
  assert.equal(enc("type:Book"), "type%3ABook");
  assert.equal(enc("märchen"), "m%C3%A4rchen");
  assert.equal(enc("vorl*"), "vorl*");
});

test("bindings and blurbs are tidied", () => {
  assert.equal(parseFormat("Taschenbuch"), "PAPERBACK");
  assert.equal(parseFormat("gebunden : EUR 22.00"), "HARDCOVER");
  assert.equal(parseFormat("Audio CD"), "AUDIOBOOK");
  assert.equal(parseFormat("Kindle Edition"), "EBOOK");
  assert.equal(parseFormat(""), "UNKNOWN");
  assert.equal(parseFormat("something else"), "UNKNOWN");
  assert.equal(stripHtml("<p>One</p><p>Two &amp; three</p>"), "One\n\nTwo & three");
  assert.equal(stripHtml("  plain  "), "plain");
});

test("a catalogue record becomes a book of the library", () => {
  const book = toBook(remoteBook({ title: "Momo", authors: ["Michael Ende", "Someone Else"], isbn: "9783522202558", year: "1973", pageCount: 304, format: "HARDCOVER", language: "de", publisher: "Thienemann", coverUrl: "https://example.org/m.jpg", description: "Zeit." }));
  assert.equal(book.title, "Momo");
  assert.equal(book.authors, "Michael Ende, Someone Else");
  assert.equal(book.publishedYear, "1973");
  assert.equal(book.pageCount, 304);
  assert.equal(book.format, "HARDCOVER");
  assert.equal(book.status, "NONE");
  assert.equal(book.lendable, true);
});
