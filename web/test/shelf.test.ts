// The cases of ShelfBitsTest in PortedFeaturesTest.kt: small pieces of the shelf and
// the theme builder.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ORNAMENT_KINDS, customThemeCodec, readVault } from "../src/lib/model.ts";
import type { ShelfThing } from "../src/lib/shelf.ts";
import { BOOK_COLORS, arrange, bookColor, javaHash, leanOf, ornamentSize, spineHeight, spineWidth, thingWidth } from "../src/lib/shelf.ts";
import { THEME_PRESETS, argbOfRgb, contrast, hexOf, hsvOfRgb, isDark, paletteOf, parseHex, presetFor, rgbOfArgb, rgbOfCss, rgbOfHsv } from "../src/lib/theme.ts";
import { sample } from "./helpers.ts";

test("ornaments stand behind the book they follow", () => {
  const kinds: [number, string][] = [
    [3, "PLANT"],
    [0, "MUG"],
    [1, "CANDLE"],
    [99, "GLOBE"],
  ];
  const order = arrange(
    3,
    kinds.map((k) => k[0]),
  )
    .map(([isBook, index]) => (isBook ? `b${index}` : kinds[index][1].toLowerCase()))
    .join(" ");
  assert.equal(order, "mug b0 candle b1 b2 plant globe");
  // An empty shelf can still hold ornaments.
  assert.deepEqual(arrange(0, [5]), [[false, 0]]);
  assert.deepEqual(arrange(2, []), [
    [true, 0],
    [true, 1],
  ]);
});

test("the last book leans when there is room and something to lean on", () => {
  const spine = (title: string, pages = 300): ShelfThing => ({ type: "spine", index: 0, title, pageCount: pages, format: "UNKNOWN" });
  const deco: ShelfThing = { type: "deco", index: 0, kind: "PLANT" };
  const row = [spine("Emma"), spine("Dune"), spine("Momo")];
  const numbers = Array.from({ length: 40 }, (_, i) => i);
  // On a shelf that is not full the last book leans, at an angle that differs from shelf to shelf.
  const leans = numbers.map((i) => leanOf("READ", i, row, 300));
  assert.ok(leans.every((lean) => lean !== null));
  assert.ok(new Set(leans.map((lean) => lean!.angle)).size >= 3);
  for (const lean of leans) {
    assert.ok(lean!.angle >= 5 && lean!.angle <= 9);
    // The foot stands out just far enough for the edge to touch the neighbour.
    assert.ok(lean!.offset > 5 && lean!.offset < 40);
  }
  // No room, nobody to lean on, or an ornament in the way: the book stands straight.
  const full = row.reduce((sum, thing) => sum + thingWidth(thing), 0) + 6;
  assert.ok(numbers.every((i) => leanOf("READ", i, row, full) === null));
  assert.ok(numbers.every((i) => leanOf("READ", i, [spine("Emma")], 300) === null));
  assert.ok(numbers.every((i) => leanOf("READ", i, [...row, deco], 300) === null));
  assert.ok(numbers.every((i) => leanOf("READ", i, [deco, spine("Emma")], 300) === null));
});

test("every ornament has a size", () => {
  for (const kind of ORNAMENT_KINDS) {
    const [width, height] = ornamentSize(kind);
    assert.ok(width >= 20 && width <= 80 && height >= 30 && height <= 95, kind);
  }
  assert.equal(ORNAMENT_KINDS.length, 14);
});

test("a book has the same colour and size here as in the app", () => {
  // String.hashCode of the JVM, which the app derives colour and height from.
  assert.equal(javaHash(""), 0);
  assert.equal(javaHash("Dune"), 2141736);
  assert.equal(javaHash("Der Vorleser"), -1194361219);
  assert.equal(javaHash("Äpfel"), 184447969);
  assert.equal(bookColor("Dune"), BOOK_COLORS[2141736 % 12]);
  assert.equal(bookColor("Der Vorleser"), BOOK_COLORS[1194361219 % 12]);
  assert.equal(spineWidth(0), 34);
  assert.equal(spineWidth(30), 24 + 0.06 * 36);
  assert.equal(spineWidth(500), 42);
  assert.equal(spineWidth(5000), 60);
  assert.equal(spineHeight("Dune", "PAPERBACK"), 146 + (2141736 % 5) * 6);
  assert.equal(spineHeight("Dune", "HARDCOVER"), 146 + (2141736 % 5) * 6 + 12);
});

test("colours are written and read as hex", () => {
  assert.equal(hexOf(0xff1f1a17 | 0), "#1F1A17");
  assert.equal(parseHex("#1f1a17"), 0xff1f1a17 | 0);
  assert.equal(parseHex(" E5873F "), 0xffe5873f | 0);
  assert.equal(parseHex("#12345"), null);
  assert.equal(parseHex("#12345G"), null);
  assert.equal(parseHex(""), null);
});

test("Android's signed colour numbers are understood and written back the same", () => {
  // -15723248 is 0xFF101510.
  assert.deepEqual(rgbOfArgb(-15723248), [0x10, 0x15, 0x10]);
  assert.equal(argbOfRgb([0x10, 0x15, 0x10]), -15723248);
  assert.equal(hexOf(-15723248), "#101510");
  assert.equal(parseHex("#101510"), -15723248);
  const theme = readVault(JSON.parse(sample("vault.json"))).prefs!.customThemes[0];
  for (const colour of [theme.background, theme.card, theme.accent, theme.text]) {
    assert.ok(colour < 0);
    assert.equal(argbOfRgb(rgbOfArgb(colour)), colour);
    assert.equal(parseHex(hexOf(colour)), colour);
  }
  assert.deepEqual(rgbOfArgb(theme.accent), [0x7b, 0xc4, 0x7f]);
});

test("a theme of one's own is found by its key", () => {
  const mine = { ...customThemeCodec.read({}), id: "abc", name: "Moor", background: 0xff101510 | 0, card: 0xff1c241c | 0, accent: 0xff7bc47f | 0, text: 0xffe8f0e8 | 0 };
  const preset = presetFor("custom:abc", false, [mine]);
  assert.equal(preset.name, "Moor");
  assert.equal(isDark(preset), true);
  // A theme that was deleted falls back to the default for the system setting.
  assert.equal(presetFor("custom:abc", false).key, "paper");
  assert.equal(presetFor("custom:abc", true).key, "ember");
  // "system" follows the browser: Ember in the dark, Paper in the light.
  assert.equal(presetFor("system", true).key, "ember");
  assert.equal(presetFor("system", false).key, "paper");
  assert.equal(presetFor("plum", false).name, "Plum Night");
});

test("the 18 themes are the ones of the app", () => {
  assert.equal(THEME_PRESETS.length, 18);
  assert.deepEqual(
    THEME_PRESETS.map((p) => p.key),
    ["ember", "forest", "midnight", "plum", "deepsea", "ocean", "mocha", "cocoa", "graphite", "paper", "peach", "lavender", "rose", "slate", "sage", "sky", "sand", "mint"],
  );
  assert.equal(THEME_PRESETS.filter(isDark).length, 9);
  const ember = paletteOf(THEME_PRESETS[0]);
  assert.equal(ember["--bg"], "#1f1a17");
  assert.equal(ember["--card"], "#2c2622");
  assert.equal(ember["--accent"], "#e5873f");
  assert.equal(ember["--text"], "#f0eae4");
  assert.equal(ember["--wood"], "#9a6a48");
  assert.equal(ember["color-scheme"], "dark");
  const paper = paletteOf(THEME_PRESETS[9]);
  assert.equal(paper["--bg"], "#f5f1ea");
  assert.equal(paper["--wood"], "#bf9264");
  assert.equal(paper["color-scheme"], "light");
});

test("text can be read in every theme", () => {
  for (const preset of THEME_PRESETS) {
    const palette = paletteOf(preset);
    const c = (name: string) => rgbOfCss(palette[name]);
    const check = (ink: string, ground: string, wanted: number) => {
      const ratio = contrast(c(ink), c(ground));
      assert.ok(ratio >= wanted, `${preset.key}: ${ink} on ${ground} is ${ratio.toFixed(2)}`);
    };
    check("--text", "--bg", 7);
    check("--text", "--card", 7);
    check("--text", "--tile", 4.5);
    check("--muted", "--bg", 4.5);
    check("--muted", "--card", 4.5);
    check("--muted", "--tile", 4.5);
    check("--accent-text", "--bg", 4.5);
    check("--accent-text", "--card", 4.5);
    check("--on-primary", "--primary", 4.5);
    check("--on-primary-container", "--primary-container", 4.5);
    check("--text", "--secondary-container", 4.5);
    check("--danger-text", "--bg", 4.5);
    check("--danger-text", "--card", 4.5);
    check("--good-text", "--card", 4.5);
    // Focus rings and the outlines of fields only have to be seen, not read.
    check("--accent-text", "--bg", 3);
    check("--outline", "--card", 3);
  }
});

test("hue, saturation and brightness go there and back", () => {
  for (const rgb of [[229, 135, 63], [0, 0, 0], [255, 255, 255], [16, 21, 16], [52, 140, 210]] as [number, number, number][]) {
    const [h, s, v] = hsvOfRgb(rgb);
    assert.deepEqual(rgbOfHsv(h, s, v), rgb);
  }
  assert.deepEqual(rgbOfHsv(0, 1, 1), [255, 0, 0]);
  assert.deepEqual(rgbOfHsv(120, 1, 1), [0, 255, 0]);
  assert.deepEqual(rgbOfHsv(360, 1, 1), [255, 0, 0]);
});
