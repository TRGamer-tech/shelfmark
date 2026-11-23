// The cases of MoreCataloguesTest.kt: the library catalogues and Apple Books, against
// answers recorded from the real services.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CoverFinder, isbnAddresses } from "../src/lib/catalogue/coverFinder.ts";
import type { HttpFetcher } from "../src/lib/catalogue/http.ts";
import { cleanLang, countryOf } from "../src/lib/catalogue/index.ts";
import { dnb, iTunes, k10plus, lobid, swisscovery } from "../src/lib/catalogue/libraryCatalogues.ts";
import { BookLookup, rank } from "../src/lib/catalogue/lookup.ts";
import { cleanTitle, parseMarc, personName } from "../src/lib/catalogue/marcXml.ts";
import type { RemoteBook } from "../src/lib/catalogue/remoteBook.ts";
import { remoteBook } from "../src/lib/catalogue/remoteBook.ts";
import type { BookSource } from "../src/lib/catalogue/source.ts";
import { parseXml } from "../src/lib/catalogue/xml.ts";
import { fixture } from "./helpers.ts";

function serving(name: string, seen: string[] = []): HttpFetcher {
  return async (url) => {
    seen.push(url);
    return fixture(name);
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a K10plus record is read from MARC", async () => {
  const seen: string[] = [];
  const book = (await k10plus(serving("k10plus_isbn.xml", seen)).byIsbn("9783257229530", "de"))!;
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("query=pica.isb%3D9783257229530"));
  assert.equal(book.title, "Der Vorleser");
  assert.equal(book.subtitle, "Roman");
  assert.deepEqual(book.authors, ["Bernhard Schlink"]);
  assert.equal(book.publisher, "Diogenes");
  assert.equal(book.pageCount, 206);
  assert.equal(book.language, "ger");
  assert.match(book.year, /^(19|20)\d\d$/);
  // Among several editions the one that carries the wanted ISBN comes first.
  assert.equal(book.isbn, "9783257229530");
});

test("a swisscovery record is read from MARC", async () => {
  const book = (await swisscovery(serving("swisscovery_isbn.xml")).byIsbn("9783257229530", "de"))!;
  // The Swiss catalogue wraps the article in marks so it can be skipped when sorting.
  assert.equal(book.title, "Der Vorleser");
  assert.equal(book.subtitle, "Roman");
  assert.deepEqual(book.authors, ["Bernhard Schlink"]);
  assert.equal(book.publisher, "Diogenes");
  assert.equal(book.pageCount, 206);
  assert.equal(book.isbn, "9783257229530");
});

test("an SRU search spells each catalogue its own way", async () => {
  const seen: string[] = [];
  await k10plus(serving("k10plus_isbn.xml", seen)).search("Der Vorleser: Schlink!", 20, "de", false);
  await swisscovery(serving("swisscovery_isbn.xml", seen)).search("vorleser schlink", 20, "de", false);
  await dnb(serving("k10plus_isbn.xml", seen)).search("vorleser schlink", 20, "de", false);
  await dnb(serving("k10plus_isbn.xml", seen)).byIsbn("9783257229530", "de");
  const query = (url: string) => decodeURIComponent(url.split("&query=")[1].split("&maximumRecords")[0].replace(/\+/g, " "));
  assert.equal(query(seen[0]), "(pica.tit=Der or pica.per=Der) and (pica.tit=Vorleser or pica.per=Vorleser) and (pica.tit=Schlink or pica.per=Schlink)");
  assert.ok(seen[0].endsWith("maximumRecords=15"));
  assert.equal(query(seen[1]), "(alma.title=vorleser or alma.creator=vorleser) and (alma.title=schlink or alma.creator=schlink) and alma.mms_material_type=BK");
  assert.equal(query(seen[2]), "(tit=vorleser or per=vorleser) and (tit=schlink or per=schlink) and mat=books");
  assert.ok(seen[3].includes("services.dnb.de/sru/dnb") && seen[3].includes("query=num%3D9783257229530"));
});

test("MARC helpers tidy names and titles", () => {
  assert.equal(personName("Schlink, Bernhard"), "Bernhard Schlink");
  assert.equal(personName("Goethe, Johann Wolfgang von,"), "Johann Wolfgang von Goethe");
  assert.equal(personName("Homer"), "Homer");
  assert.equal(cleanTitle("<<Der>> Vorleser /"), "Der Vorleser");
  assert.equal(cleanTitle("\u0098Die\u009C Wand :"), "Die Wand");
  assert.deepEqual(parseMarc("<html>not a catalogue answer</html>", "x"), []);
  assert.deepEqual(parseMarc("garbage", "x"), []);
});

test("the XML reader keeps to what catalogue answers need", () => {
  const root = parseXml('<?xml version="1.0"?><a:r xmlns:a="urn:x"><!-- note --><b code="1 &amp; 2">x &lt; y<c/>z</b><d><![CDATA[<raw>]]></d></a:r>')!;
  assert.equal(root.name, "r");
  assert.equal(root.children[0].attributes.code, "1 & 2");
  assert.equal(root.children[0].text, "x < yz");
  assert.equal(root.children[1].text, "<raw>");
  // A DOCTYPE is refused, so nothing can be pulled in from elsewhere.
  assert.equal(parseXml('<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>'), null);
  assert.equal(parseXml("<a><b></a></b>"), null);
  assert.equal(parseXml("<a>"), null);
  assert.equal(parseXml(""), null);
});

test("a lobid record is read", async () => {
  const seen: string[] = [];
  const book = (await lobid(serving("lobid_isbn.json", seen)).byIsbn("9783257229530", "de"))!;
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("q=isbn%3A9783257229530"));
  assert.equal(book.title, "Der Vorleser");
  assert.equal(book.subtitle, "Roman");
  assert.deepEqual(book.authors, ["Bernhard Schlink"]);
  assert.equal(book.publisher, "Diogenes");
  assert.equal(book.year, "1997");
  assert.equal(book.pageCount, 206);
  assert.equal(book.language, "ger");
  assert.equal(book.isbn, "9783257229530");
});

test("lobid suggests with a wildcard", async () => {
  const seen: string[] = [];
  await lobid(serving("lobid_search.json", seen)).search("der vorl", 6, "de", true);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("q=der+AND+vorl*") || seen[0].includes("q=der+AND+vorl%2A"));
  assert.ok(seen[0].includes("filter=type%3ABook"));
});

test("Apple Books gives a blurb and a large cover", async () => {
  const seen: string[] = [];
  const results = await iTunes(serving("itunes_search.json", seen), () => "CH").search("der vorleser schlink", 5, "de", false);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("country=ch"));
  const first = results[0];
  assert.equal(first.title, "Der Vorleser");
  assert.deepEqual(first.authors, ["Bernhard Schlink"]);
  assert.ok(first.description.startsWith("Sie ist reizbar"));
  assert.ok(first.coverUrl.includes("600x600bb"));
  assert.equal(first.format, "UNKNOWN");
  // Without a country the choice of store is left to Apple.
  const plain: string[] = [];
  await iTunes(serving("itunes_search.json", plain)).search("momo", 5, "de", false);
  assert.ok(!plain[0].includes("country="));
});

test("the novel ranks above books about it", () => {
  const books = [
    remoteBook({ title: "Erläuterungen zu Bernhard Schlink, Der Vorleser", authors: ["Magret Möckel"], isbn: "9783804417557" }),
    remoteBook({ title: "Bernhard Schlink: Der Vorleser", authors: ["Sascha Feuchert"] }),
    remoteBook({ title: "Der Vorleser", authors: ["Bernhard Schlink"], isbn: "9783257229530", coverUrl: "https://example.org/c.jpg" }),
  ];
  assert.equal(rank("der vorleser schlink", books)[0].title, "Der Vorleser");
  assert.equal(rank("vorleser", books)[0].title, "Der Vorleser");
});

function canned(name: string, suggests: boolean, book: RemoteBook | null, delayMs = 0): BookSource & { searches: number } {
  const source = {
    name,
    suggests,
    searches: 0,
    async search() {
      source.searches++;
      await wait(delayMs);
      return book ? [book] : [];
    },
    async byIsbn() {
      await wait(delayMs);
      return book;
    },
  };
  return source;
}

test("slow catalogues are not asked on every keystroke", async () => {
  const quick = canned("quick", true, remoteBook({ title: "Momo", authors: ["Michael Ende"] }));
  const thorough = canned("thorough", false, remoteBook({ title: "Momo", authors: ["Michael Ende"], pageCount: 304 }));
  const lookup = new BookLookup([quick, thorough]);
  const suggested = await lookup.search("mom", 6, "de", true);
  assert.equal(suggested.length, 1);
  assert.equal(suggested[0].pageCount, 0);
  assert.equal(thorough.searches, 0);
  // The full search asks everyone and merges what they know.
  const full = await lookup.search("momo", 20, "de");
  assert.equal(full.length, 1);
  assert.equal(full[0].pageCount, 304);
});

test("a found book does not wait long for stragglers", async () => {
  const quick = canned("quick", true, remoteBook({ title: "Momo", isbn: "9783522202558" }));
  const straggler = canned("straggler", true, remoteBook({ title: "Momo", description: "late" }), 3_000);
  const started = Date.now();
  const book = (await new BookLookup([quick, straggler], { timeoutMs: 60_000, graceMs: 150 }).byIsbn("9783522202558"))!;
  assert.equal(book.description, "");
  assert.ok(Date.now() - started < 2_000);
});

test("the cover finder checks ISBN services and matching titles", async () => {
  const catalogue: BookSource = {
    name: "c",
    suggests: true,
    async search() {
      return [
        remoteBook({ title: "Momo", authors: ["Michael Ende"], coverUrl: "https://example.org/momo.jpg" }),
        remoteBook({ title: "Momos Welt", coverUrl: "https://example.org/other.jpg" }),
        remoteBook({ title: "Der Zauberberg", coverUrl: "https://example.org/wrong.jpg" }),
      ];
    },
    async byIsbn() {
      return null;
    },
  };
  // Only the German National Library has a picture for this ISBN.
  const probe = async (url: string) => url.includes("portal.dnb.de");
  const found = await new CoverFinder(new BookLookup([catalogue]), probe).candidates("Momo", "Michael Ende", "9783522202558", "de");
  assert.deepEqual(found, ["https://portal.dnb.de/opac/mvb/cover?isbn=9783522202558", "https://example.org/momo.jpg", "https://example.org/other.jpg"]);
  // Without an ISBN and without a matching title there is nothing to offer.
  assert.equal(await new CoverFinder(new BookLookup([catalogue]), probe).best("Etwas ganz anderes", "", "", "de"), null);
  assert.equal(isbnAddresses("9783522202558")[0], "https://covers.openlibrary.org/b/isbn/9783522202558-L.jpg?default=false");
});

test("the route handlers pass on only a language and a country", () => {
  assert.equal(countryOf("de-CH,de;q=0.9,en;q=0.8"), "ch");
  assert.equal(countryOf("en-GB"), "gb");
  assert.equal(countryOf("de"), "");
  assert.equal(countryOf(null), "");
  assert.equal(cleanLang("de-CH"), "de");
  assert.equal(cleanLang("EN"), "en");
  assert.equal(cleanLang(""), "en");
  assert.equal(cleanLang(null), "en");
  assert.equal(cleanLang("../x"), "en");
});
