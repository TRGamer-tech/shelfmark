// The cases of IsbnTest.kt.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as Isbn from "../src/lib/isbn.ts";

test("valid ISBN-13", () => {
  assert.equal(Isbn.isValid("978-3-257-22953-0"), true);
  assert.equal(Isbn.isValid13("9780441172719"), true);
  assert.equal(Isbn.isValid13("9780441172718"), false);
});

test("valid ISBN-10 including X", () => {
  assert.equal(Isbn.isValid("3257229534"), true);
  assert.equal(Isbn.isValid("0-8044-2957-X"), true);
  assert.equal(Isbn.isValid("3257229535"), false);
});

test("converts ISBN-10 to 13", () => {
  assert.equal(Isbn.to13("3-257-22953-4"), "9783257229530");
  assert.equal(Isbn.to13("080442957X"), "9780804429573");
  assert.equal(Isbn.to13("9780441172719"), "9780441172719");
  assert.equal(Isbn.to13("12345"), null);
});

test("a book EAN needs the Bookland prefix", () => {
  assert.equal(Isbn.isBookEan("9783257229530"), true);
  assert.equal(Isbn.isBookEan("9791032305690"), true);
  // A valid EAN-13 from a cereal box is not a book.
  assert.equal(Isbn.isBookEan("4006381333931"), false);
});
