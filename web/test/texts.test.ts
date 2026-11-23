// The texts of the website: every text exists in both languages, every text a page asks
// for exists, and nothing breaks the writing rules of the project.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PLURALS, STRINGS, format, langOf, localeOf, pluralise, translate } from "../src/i18n/index.ts";
// @ts-expect-error A plain script without types of its own.
import { findProblems } from "../scripts/check-style.mjs";

const source = fileURLToPath(new URL("../src", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const placeholders = (text: string) => (text.match(/%(?:\d+\$)?[sd]/g) ?? []).slice().sort().join(" ");

test("every text exists in English and in German, with the same placeholders", () => {
  assert.deepEqual(Object.keys(STRINGS.de).sort(), Object.keys(STRINGS.en).sort());
  assert.deepEqual(Object.keys(PLURALS.de).sort(), Object.keys(PLURALS.en).sort());
  for (const key of Object.keys(STRINGS.en)) {
    assert.equal(placeholders(STRINGS.de[key]), placeholders(STRINGS.en[key]), key);
    assert.notEqual(STRINGS.de[key].trim(), "", key);
  }
  for (const key of Object.keys(PLURALS.en)) {
    for (const form of ["one", "other"] as const) assert.equal(placeholders(PLURALS.de[key][form]), placeholders(PLURALS.en[key][form]), key);
  }
});

test("every text a page asks for exists", () => {
  const missing: string[] = [];
  for (const path of files(source)) {
    const code = readFileSync(path, "utf8");
    // t("key"...) and plural("key"...) with the key written out. Keys that are put together are checked below.
    for (const match of code.matchAll(/\bt\(\s*"([a-z0-9_]+)"/g)) if (!(match[1] in STRINGS.en)) missing.push(`${path}: ${match[1]}`);
    for (const match of code.matchAll(/\bplural\(\s*"([a-z0-9_]+)"/g)) if (!(match[1] in PLURALS.en)) missing.push(`${path}: plural ${match[1]}`);
    // Keys named in a table or returned by a helper: any quoted word that looks like one.
    for (const match of code.matchAll(/"((?:status|format|ownership|request|sort|view|goal_repeat|reader|time|milestone|server_error|account_error|theme|friend|web)_[a-z0-9_]+)"/g)) {
      if (!(match[1] in STRINGS.en) && !(match[1] in PLURALS.en)) missing.push(`${path}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
  // Keys that are put together from parts.
  for (const time of ["morning", "day", "evening", "night"]) {
    assert.ok(`greeting_${time}` in STRINGS.en && `greeting_${time}_name` in STRINGS.en, time);
  }
  for (const kind of ["plant", "cactus", "candle", "mug", "vase", "lamp", "globe", "clock", "trophy", "frame", "pumpkin", "bookend", "cat", "bookstack"]) {
    assert.ok(`ornament_${kind}` in STRINGS.en, kind);
  }
  for (const reader of ["quiet", "weekend", "early", "afternoon", "evening", "night"]) assert.ok(`reader_${reader}_text` in STRINGS.en, reader);
  for (const unit of ["unit_books", "unit_pages_plural", "unit_minutes_plural"]) assert.ok(unit in PLURALS.en, unit);
  for (const lang of ["en", "de"]) assert.ok(`web_language_${lang}` in STRINGS.en, lang);
});

test("placeholders of the app's texts are filled", () => {
  assert.equal(format("Page %1$d of %2$d", [120, 256]), "Page 120 of 256");
  assert.equal(format("%2$s then %1$s", ["a", "b"]), "b then a");
  assert.equal(format("%d books", [3]), "3 books");
  assert.equal(format("100 %% of %s", ["it"]), "100 % of it");
  assert.equal(translate("en", "continue_page", 120, 256), "Page 120 of 256");
  assert.equal(translate("de", "continue_page", 120, 256), "Seite 120 von 256");
  assert.equal(translate("de", "greeting_evening_name", "Anna"), "Guten Abend, Anna");
  assert.equal(pluralise("en", "book_count", 1), "1 book");
  assert.equal(pluralise("en", "book_count", 0), "0 books");
  assert.equal(pluralise("de", "book_count", 3), "3 Bücher");
  assert.equal(pluralise("de", "unit_books", 1), "Buch");
  assert.equal(translate("en", "no_such_text"), "no_such_text");
});

test("the language follows the browser until the reader chooses", () => {
  assert.equal(langOf("de-CH"), "de");
  assert.equal(langOf("de"), "de");
  assert.equal(langOf("en-US"), "en");
  assert.equal(langOf("fr-FR"), "en");
  assert.equal(langOf(null), "en");
  assert.equal(localeOf("de", "de-AT"), "de-AT");
  assert.equal(localeOf("de", "en-US"), "de-CH");
  assert.equal(localeOf("en", "en-US"), "en-US");
  assert.equal(localeOf("en", "de-CH"), "en-GB");
});

test("the website's own German keeps to Swiss spelling and both languages avoid the long dash", () => {
  assert.deepEqual(findProblems(), []);
});
