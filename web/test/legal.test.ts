// The imprint and the privacy notice: who is named on them, that both languages say the
// same things, and that what they say about the code is what the code says.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Block, LegalPage, LegalTexts } from "../src/i18n/legal.ts";
import { LEGAL } from "../src/i18n/legal.ts";
import { catalogueCount } from "../src/lib/catalogue/index.ts";
import { LEGAL_PATHS, PRIVACY_AS_OF, legalLangOf } from "../src/lib/legal.ts";
import { OPERATOR, operatorBlock } from "../src/lib/operator.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** Every string in a tree of texts, with the path that leads to it. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => strings(item, path === "" ? key : `${path}.${key}`));
  return [];
}

const textOf = (page: LegalPage) =>
  strings(page)
    .map(([, text]) => text)
    .join("\n");

test("the name and the postal address of whoever runs the site appear only when they are filled in", () => {
  // Nothing filled in: the e-mail address alone.
  assert.deepEqual(operatorBlock({ name: "", address: [], email: "desk@shelf.example" }), { lines: [], email: "desk@shelf.example" });
  assert.deepEqual(operatorBlock({ name: "  ", address: ["", "   "], email: " desk@shelf.example " }), { lines: [], email: "desk@shelf.example" });
  // A name without an address, and the other way round.
  assert.deepEqual(operatorBlock({ name: "Ada Example", address: [], email: "desk@shelf.example" }).lines, ["Ada Example"]);
  assert.deepEqual(operatorBlock({ name: "", address: ["Shelf Lane 1", "1234 Booktown"], email: "desk@shelf.example" }).lines, ["Shelf Lane 1", "1234 Booktown"]);
  // Both: the name first, then the address line by line, and empty lines left out.
  assert.deepEqual(operatorBlock({ name: "Ada Example", address: ["Shelf Lane 1", "", " 1234 Booktown "], email: "desk@shelf.example" }), {
    lines: ["Ada Example", "Shelf Lane 1", "1234 Booktown"],
    email: "desk@shelf.example",
  });
});

test("as it stands the site names an e-mail address and nothing that was made up", () => {
  assert.equal(OPERATOR.email, "martin@schmidtbit.ch");
  assert.equal(OPERATOR.name, "");
  assert.deepEqual(OPERATOR.address, []);
  assert.deepEqual(operatorBlock(), { lines: [], email: "martin@schmidtbit.ch" });
});

test("each of the two pages has an address in each language, and they are told apart by it", () => {
  assert.deepEqual(LEGAL_PATHS, { en: { imprint: "/imprint", privacy: "/privacy" }, de: { imprint: "/de/impressum", privacy: "/de/datenschutz" } });
  assert.equal(legalLangOf("/imprint"), "en");
  assert.equal(legalLangOf("/privacy/"), "en");
  assert.equal(legalLangOf("/de/impressum"), "de");
  assert.equal(legalLangOf("/de/datenschutz"), "de");
  for (const path of ["/", "/de", "/login", "/confirmed", "/de/privacy", "/impressum", "/privacy/more"]) assert.equal(legalLangOf(path), null, path);
});

test("both languages say the same things, section by section", () => {
  const shape = (texts: LegalTexts) =>
    (["imprint", "privacy"] as const).map((kind) =>
      texts[kind].sections.map((section) => [section.id, section.blocks.map((block: Block) => ("operator" in block ? "operator" : "list" in block ? `list of ${block.list.length}` : "p"))]),
    );
  assert.deepEqual(shape(LEGAL.de), shape(LEGAL.en));
  const paths = (texts: LegalTexts) =>
    strings(texts)
      .map(([path]) => path)
      .sort();
  assert.deepEqual(paths(LEGAL.de), paths(LEGAL.en));
  for (const [path, text] of [...strings(LEGAL.en), ...strings(LEGAL.de)]) assert.notEqual(text.trim(), "", `${path} is empty`);
  // The same marks in the same places: a link or a number must not get lost in translation.
  const marks = (text: string) => (text.match(/\{\w+/g) ?? []).sort().join(" ");
  const english = strings(LEGAL.en);
  for (const [index, [path, text]] of strings(LEGAL.de).entries()) assert.equal(marks(text), marks(english[index][1]), path);
  // Section ids are what the list of questions links to.
  for (const lang of ["en", "de"] as const) {
    for (const kind of ["imprint", "privacy"] as const) {
      const ids = LEGAL[lang][kind].sections.map((section) => section.id);
      assert.equal(new Set(ids).size, ids.length, `${lang} ${kind}: every section has its own id`);
      for (const id of ids) assert.match(id, /^[a-z]+$/);
    }
  }
});

test("only marks the page knows are used, and whoever answers is named through the one place that holds them", () => {
  for (const lang of ["en", "de"] as const) {
    for (const [path, text] of strings(LEGAL[lang])) {
      for (const mark of text.match(/\{[^}]*\}/g) ?? []) assert.match(mark, /^\{(email|repository|count|privacy\|[^}]+|imprint\|[^}]+)\}$/, `${lang} ${path}`);
      // The address is never written into a text: it comes from lib/operator.ts.
      assert.ok(!text.includes("@"), `${lang} ${path} holds an address`);
    }
    for (const kind of ["imprint", "privacy"] as const) {
      const blocks = LEGAL[lang][kind].sections.flatMap((section) => section.blocks);
      assert.ok(blocks.some((block) => "operator" in block), `${lang} ${kind} says who answers`);
    }
  }
});

test("every catalogue the code asks is named, on both pages and in both languages", () => {
  const named = {
    en: ["Open Library", "Google Books", "Apple Books", "lobid", "German National Library", "K10plus", "swisscovery"],
    de: ["Open Library", "Google Books", "Apple Books", "lobid", "Deutsche Nationalbibliothek", "K10plus", "swisscovery"],
  };
  for (const lang of ["en", "de"] as const) {
    // As many names as the code has catalogues: one more of them means one more name here and on the pages.
    assert.equal(named[lang].length, catalogueCount());
    for (const name of named[lang]) {
      assert.ok(textOf(LEGAL[lang].imprint).includes(name), `${lang} imprint names ${name}`);
      assert.ok(textOf(LEGAL[lang].privacy).includes(name), `${lang} privacy notice names ${name}`);
    }
    // The number itself is filled in from the code, not written out.
    assert.ok(textOf(LEGAL[lang].privacy).includes("{count} "));
    assert.ok(!/\b(seven|sieben|7)\b/.test(textOf(LEGAL[lang].privacy)));
  }
});

test("the privacy notice keeps to what was asked of it", () => {
  for (const lang of ["en", "de"] as const) {
    const text = textOf(LEGAL[lang].privacy);
    // The three companies, and where they are.
    for (const name of ["Vercel Inc., USA", "Supabase Inc., USA", "GitHub Inc., USA"]) assert.ok(text.includes(name), `${lang}: ${name}`);
    // No region of a server is named: it is not known.
    assert.ok(!/Frankfurt|Ireland|Irland|Zurich|Zürich|eu-|us-east|us-west|region|Region/.test(text), `${lang}: a region`);
    // No certificates, contracts or safeguards are claimed.
    assert.ok(!/certif|zertifi|Standard Contractual|Standardvertrags|adequacy|Angemessenheit|Privacy Framework|ISO 27|SOC 2/i.test(text), `${lang}: a safeguard`);
    // The laws are named, without paragraph numbers.
    assert.ok(!/§|\bArt\.|\bArticle \d|\bArtikel \d/.test(text), `${lang}: a paragraph number`);
    assert.ok(text.includes(lang === "de" ? "EDÖB" : "FDPIC"));
    assert.ok(text.includes(lang === "de" ? "DSGVO" : "GDPR"));
  }
  assert.ok(textOf(LEGAL.en.privacy).includes("According to Google, ML Kit sends usage and diagnostic figures about itself to Google."));
  assert.equal(PRIVACY_AS_OF, "2026-11-24");
});

test("the notice says what a loan between friends keeps, and nothing of the borrow requests that are gone", () => {
  for (const lang of ["en", "de"] as const) {
    const privacy = LEGAL[lang].privacy;
    const loans = privacy.sections.find((section) => section.id === "loans");
    assert.ok(loans, `${lang}: a section about loans`);
    const said = strings(loans).map(([, text]) => text).join("\n");
    // What the record on the server holds (the table shelfmark.loans), and how long.
    for (const word of lang === "de" ? ["ISBN", "Cover-Adresse", "Nachricht", "Zeitpunkt jedes Schritts", "Grund", "weglegen", "eines der beiden Konten gelöscht"] : ["ISBN", "cover address", "note", "moment of each step", "reason", "put away", "one of the two accounts is deleted"]) {
      assert.ok(said.includes(word), `${lang}: ${word}`);
    }
    // A book on loan appears in the borrower's library.
    assert.ok(said.includes(lang === "de" ? "in der eigenen Bibliothek der Person, die es ausleiht" : "in the borrower's own library"), lang);
    // Borrow requests were messages that were deleted once fetched. No sentence says that any more.
    const whole = textOf(privacy);
    assert.ok(!/borrow request|Ausleih-Anfrage|as soon as the receiving device|sobald das empfangende Gerät|90/.test(whole), `${lang}: a sentence about borrow requests`);
  }
});

test("the notice says when an uploaded picture goes, and what the end of a friendship does to loans", () => {
  const sentences = {
    en: [
      // Pictures go with their books (lib/supabase/covers.ts, droppedCoverFiles), and all of them with the account.
      "A picture is removed when its book is deleted or gets another cover, unless another book of yours still shows it.",
      "every cover photo you uploaded",
      // A removal that fails is not reported to the reader, so the notice has to say that it can happen.
      "Should a cover photo not let itself be removed, with its book or with the account, nothing tells you",
      // shelfmark_remove_friend ends the open questions and deletes no record.
      "Removing a friend deletes no loan: questions nobody answered yet end with it, and a book that is reserved or out stays a loan until it is back.",
    ],
    de: [
      "Ein Bild wird entfernt, wenn sein Buch gelöscht wird oder ein anderes Cover bekommt, es sei denn, ein anderes deiner Bücher zeigt es noch.",
      "alle Cover-Fotos, die du hochgeladen hast",
      "Lässt sich ein Cover-Foto einmal nicht entfernen, mit seinem Buch oder mit dem Konto, sagt dir das niemand",
      "Wer eine Freundschaft beendet, löscht damit keine Ausleihe: Fragen, auf die noch niemand geantwortet hat, enden damit, und ein Buch, das reserviert oder unterwegs ist, bleibt eine Ausleihe, bis es zurück ist.",
    ],
  };
  for (const lang of ["en", "de"] as const) {
    const whole = textOf(LEGAL[lang].privacy);
    for (const sentence of sentences[lang]) assert.ok(whole.includes(sentence), `${lang}: ${sentence}`);
  }
});

test("what the notice says about the browser is what the code keeps there", () => {
  // Every key the website writes into the storage of the browser, found in its own code.
  const sources = ["../src/lib/supabase/api.ts", "../src/components/i18n.tsx", "../src/components/Providers.tsx", "../src/components/theme.tsx", "../src/components/timer.tsx", "../src/components/library.tsx", "../src/components/auth.tsx", "../src/app/login/page.tsx", "../src/app/settings/page.tsx"];
  const keys = new Set<string>();
  for (const path of sources) for (const match of read(path).matchAll(/["`](shelfmark\.[a-z]+)/g)) keys.add(match[1]);
  // One entry of the notice for each of them. A new key means a new sentence there.
  assert.deepEqual([...keys].sort(), ["shelfmark.auth", "shelfmark.lang", "shelfmark.loans", "shelfmark.name", "shelfmark.notice", "shelfmark.palette", "shelfmark.ping", "shelfmark.published", "shelfmark.theme", "shelfmark.timer"]);
  const section = LEGAL.en.privacy.sections.find((s) => s.id === "browser");
  const list = section?.blocks.find((block): block is { list: string[] } => "list" in block);
  // Language, daily check, sign-in, theme (two keys), timer, loans, shared copy, name: eight entries, and the note for the next page as a sentence.
  assert.equal(list?.list.length, 8);
  // What goes with the sign-in when the reader signs out is what the notice says goes.
  const signOut = /const signOut = [\s\S]*?\}, \[client\]\);/.exec(read("../src/components/auth.tsx"))?.[0] ?? "";
  for (const key of ["shelfmark.published", "shelfmark.timer", "shelfmark.loans"]) assert.ok(signOut.includes(key), `signing out removes ${key}`);
  assert.equal(list?.list.filter((entry) => entry.includes("Signing out removes")).length, 4);
  // No cookie is set anywhere in the code of the website.
  for (const path of [...sources, "../src/lib/visitor.ts", "../src/app/layout.tsx", "../src/app/download/route.ts", "../src/app/api/keepalive/route.ts", "../src/app/api/books/search/route.ts"]) {
    assert.ok(!/cookie/i.test(read(path)), `${path} speaks of cookies`);
  }
  // Cover pictures are asked for without saying which page they are for.
  for (const path of ["../src/components/BookCover.tsx", "../src/components/BookForm.tsx"]) {
    for (const tag of read(path).match(/<img [^>]*>/g) ?? []) assert.ok(tag.includes('referrerPolicy="no-referrer"'), `${path}: ${tag}`);
  }
});

test("the texts follow the writing rules of the project", () => {
  // Written as numbers, so that this file does not hold the characters it forbids.
  const forbidden = new RegExp(`[${String.fromCharCode(0xdf, 0x2014)}]`);
  for (const [path, text] of [...strings(LEGAL.en), ...strings(LEGAL.de)]) assert.ok(!forbidden.test(text), path);
  // German is written with its umlauts, and the Swiss way where the sharp s would stand.
  const german = textOf(LEGAL.de.privacy);
  for (const word of ["gelöscht", "Bücher", "für", "ausser", "aussen"]) assert.ok(german.includes(word), word);
});
