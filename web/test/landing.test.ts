// The front page: its words in both languages, the numbers it names, and its colours.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { format } from "../src/i18n/index.ts";
import type { LandingTexts } from "../src/i18n/landing.ts";
import { LANDING } from "../src/i18n/landing.ts";
import { catalogueCount } from "../src/lib/catalogue/index.ts";
import { ORNAMENT_KINDS } from "../src/lib/model.ts";
import { MIN_ANDROID } from "../src/lib/release.ts";
import { spineHeight } from "../src/lib/shelf.ts";
import { THEME_PRESETS, contrast, isDark, paletteOf, rgbOfCss } from "../src/lib/theme.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** Every string in a tree of texts, with the path that leads to it. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => strings(item, path === "" ? key : `${path}.${key}`));
  return [];
}

test("both languages say the same things", () => {
  const paths = (texts: LandingTexts) =>
    strings(texts)
      .map(([path]) => path)
      .sort();
  assert.deepEqual(paths(LANDING.de), paths(LANDING.en));
  // The same books in the same places, whatever they are called.
  assert.deepEqual(
    LANDING.de.features.map((f) => [f.mark, f.pages, f.hardcover ?? false]),
    LANDING.en.features.map((f) => [f.mark, f.pages, f.hardcover ?? false]),
  );
  for (const [path, text] of [...strings(LANDING.en), ...strings(LANDING.de)]) assert.notEqual(text.trim(), "", `${path} is empty`);
});

test("the numbers on the page are the ones the code has", () => {
  // Counted, not remembered: seven catalogues, fourteen ornaments, eighteen themes.
  const dark = THEME_PRESETS.filter(isDark).length;
  const counts = [catalogueCount(), ORNAMENT_KINDS.length, THEME_PRESETS.length, dark, THEME_PRESETS.length - dark];
  assert.deepEqual(counts, [7, 14, 18, 9, 9]);
  for (const lang of ["en", "de"] as const) {
    const features = LANDING[lang].features;
    const catalogues = features.find((f) => f.mark === "A 2");
    const ornaments = features.find((f) => f.mark === "B 3");
    const themes = features.find((f) => f.mark === "B 4");
    assert.ok(catalogues && ornaments && themes);
    // The sentence that names the catalogues names as many as the code asks.
    const named = format(catalogues.text, counts).split(":")[1].split(".")[0].split(/,| and | und /).filter((name) => name.trim() !== "");
    assert.equal(named.length, catalogueCount(), `${lang}: ${named.join(" | ")}`);
    assert.ok(format(catalogues.title, counts).startsWith("7 "));
    assert.ok(format(ornaments.text, counts).startsWith("14 "));
    assert.ok(format(themes.text, counts).startsWith("18 "));
    assert.match(format(themes.text, counts), /\b9\b.*\b9\b/);
    // No number is written into a sentence by hand where the code could say it.
    for (const feature of features) assert.doesNotMatch(feature.text.replace(/%\d\$d/g, ""), /\b(7|14|18)\b/, `${lang} ${feature.mark}`);
  }
  // The oldest Android the app runs on is minSdk 26 of the app, which is Android 8.
  assert.equal(MIN_ANDROID, "8");
});

test("every book of the hero has a shelfmark of its own, and a title that fits its spine", () => {
  for (const lang of ["en", "de"] as const) {
    const features = LANDING[lang].features;
    assert.equal(features.length, 14);
    assert.equal(new Set(features.map((f) => f.mark)).size, features.length);
    for (const feature of features) {
      assert.match(feature.mark, /^[A-D] \d$/);
      const title = format(feature.title, [7]);
      // A spine holds one line, a little under six pixels a letter, less the label at its
      // foot. A thick book (from 556 pages) has room for two lines. The end to end test
      // measures the real thing, this catches a title that is far too long before that.
      const lines = feature.pages >= 556 ? 2 : 1;
      const room = spineHeight(title, feature.hardcover ? "HARDCOVER" : "PAPERBACK") - 52;
      assert.ok(title.length * 5.8 <= room * lines, `${lang} ${feature.mark} "${title}" is too long for its spine (${room}px, ${lines} line)`);
    }
  }
});

test("the page keeps to its own rules of writing", () => {
  for (const [path, text] of [...strings(LANDING.en), ...strings(LANDING.de)]) {
    assert.doesNotMatch(text, new RegExp(`[${String.fromCharCode(0xdf, 0x2014)}]`), `${path}: a character the project does not use`);
    assert.doesNotMatch(text, /\b(he|she|his|her|him)\b/i, `${path}: people are "they"`);
    // Claims without anything behind them, and the slogans that give a machine away.
    assert.doesNotMatch(text, /blazing|lightning|seamless|effortless|revolution|supercharge|game.chang|, everywhere|überall\./i, `${path}: ${text}`);
    assert.doesNotMatch(text, /\b(not|kein|nicht) (just |nur )?an? [^.]{3,40}[.,] (it's|it is|sondern)/i, `${path}: ${text}`);
  }
});

// ---- colours ----

function scope(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no rule for ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(Array.from(body.matchAll(/(--[a-z-]+):\s*([^;]+);/g), (match) => [match[1], match[2].trim()]));
}

test("the front pages wear two themes of the app, exactly", () => {
  const css = read("../src/app/front.css");
  for (const [selector, key] of [
    [".front", "cocoa"],
    [".front .paper", "paper"],
  ] as const) {
    const preset = THEME_PRESETS.find((p) => p.key === key);
    assert.ok(preset);
    const wanted = paletteOf(preset);
    const written = scope(css, selector);
    for (const [name, value] of Object.entries(wanted)) {
      if (!name.startsWith("--")) continue;
      assert.equal(written[name], value, `${selector} ${name}`);
    }
  }
});

test("what is written on the front pages can be read", () => {
  const css = read("../src/app/front.css");
  const room = scope(css, ".front");
  const paper = scope(css, ".front .paper");
  const ratio = (a: string, b: string) => contrast(rgbOfCss(a), rgbOfCss(b));
  // The room: text, quiet text and the lamp-coloured links on the dark wall, and on the darker one.
  for (const wall of [room["--bg"], "#201611"]) {
    assert.ok(ratio(room["--text"], wall) >= 7, "text on the wall");
    assert.ok(ratio(room["--muted"], wall) >= 4.5, "quiet text on the wall");
    assert.ok(ratio(room["--accent-text"], wall) >= 4.5, "links on the wall");
  }
  // The button of every section: dark words on the colour of the lamp, also while the pointer is on it.
  assert.ok(ratio(room["--on-primary"], room["--primary"]) >= 7);
  assert.ok(ratio(room["--on-primary"], "#f6b784") >= 7);
  // The wooden counter, at its lightest and at its darkest: the text and the notes on it.
  for (const wood of ["#775036", "#5f3e2a"]) {
    assert.ok(ratio(room["--text"], wood) >= 4.5, `text on the counter ${wood}`);
    assert.ok(ratio("#f0dfcf", wood) >= 4.5, `notes on the counter ${wood}`);
  }
  // Paper: text, quiet text, links and the stamp.
  assert.ok(ratio(paper["--text"], paper["--bg"]) >= 7);
  assert.ok(ratio(paper["--muted"], paper["--bg"]) >= 4.5);
  assert.ok(ratio(paper["--accent-text"], paper["--bg"]) >= 4.5);
  assert.ok(ratio(paper["--danger-text"], paper["--bg"]) >= 4.5);
  // The label on a spine.
  assert.ok(ratio("#2b2520", "#f1e7d2") >= 7);
});
