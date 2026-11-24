// The short notices at the foot of the page (src/lib/notices.ts): nothing stands there
// twice, and a notice about something goes when that thing is dealt with.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Notice } from "../src/lib/notices.ts";
import { aboutLoan } from "../src/lib/news.ts";
import { NOTICES_AT_ONCE, NOTICE_MS, stayOf, withNotice, withoutAbout, withoutNotice } from "../src/lib/notices.ts";

const texts = (shown: Notice[]) => shown.map((notice) => notice.text);

test("a notice about something takes the place of the one before about the same thing", () => {
  const momo = aboutLoan("3f2a9c1e-7b4d-4e8a-9c0d-112233445566");
  const emma = aboutLoan("0000000a-bcde-4f01-8234-56789abcdef0");
  let shown: Notice[] = [];
  shown = withNotice(shown, { id: 1, text: "Ben says Momo was handed over to you", about: momo });
  shown = withNotice(shown, { id: 2, text: "Carl would like to borrow Emma", about: emma });
  // The same loan again, with the same words: the handover was taken back and said again.
  shown = withNotice(shown, { id: 3, text: "Ben says Momo was handed over to you", about: momo });
  assert.deepEqual(texts(shown), ["Carl would like to borrow Emma", "Ben says Momo was handed over to you"]);
  assert.deepEqual(shown.map((notice) => notice.id), [2, 3]);
  // The next step of that loan.
  shown = withNotice(shown, { id: 4, text: "Ben changed the date for Momo", about: momo });
  assert.deepEqual(texts(shown), ["Carl would like to borrow Emma", "Ben changed the date for Momo"]);
  // Two loans have two names, however alike their ids begin.
  assert.notEqual(momo, emma);
});

test("the very same words never stand on the page twice, whatever they are about", () => {
  let shown: Notice[] = [];
  shown = withNotice(shown, { id: 1, text: "That is no longer possible, the loan has moved on." });
  shown = withNotice(shown, { id: 2, text: "Saved" });
  shown = withNotice(shown, { id: 3, text: "That is no longer possible, the loan has moved on." });
  assert.deepEqual(texts(shown), ["Saved", "That is no longer possible, the loan has moved on."]);
  // Notices that are about nothing in particular stand next to each other.
  shown = withNotice(shown, { id: 4, text: "Copied" });
  assert.deepEqual(texts(shown), ["Saved", "That is no longer possible, the loan has moved on.", "Copied"]);
});

test("the oldest notice makes room when there are too many", () => {
  let shown: Notice[] = [];
  for (let id = 1; id <= NOTICES_AT_ONCE + 2; id++) shown = withNotice(shown, { id, text: `notice ${id}`, about: `thing ${id}` });
  assert.equal(shown.length, NOTICES_AT_ONCE);
  assert.deepEqual(texts(shown), ["notice 3", "notice 4", "notice 5"]);
});

test("a notice goes when what it is about is dealt with, and when its time is up", () => {
  const momo = aboutLoan("3f2a9c1e-7b4d-4e8a-9c0d-112233445566");
  const shown: Notice[] = [
    { id: 1, text: "Ben says Momo was handed over to you", about: momo },
    { id: 2, text: "Saved" },
  ];
  assert.deepEqual(texts(withoutAbout(shown, momo)), ["Saved"]);
  assert.deepEqual(texts(withoutNotice(shown, 2)), ["Ben says Momo was handed over to you"]);
  // Nothing to take away: the list is the very same one, so that a page has nothing to draw again.
  assert.equal(withoutAbout(shown, aboutLoan("another")), shown);
  assert.equal(withoutNotice(shown, 9), shown);
  // The time is up after a few seconds, long enough to read a sentence.
  assert.ok(NOTICE_MS >= 4000 && NOTICE_MS <= 10000);
  // Two lines take longer to read than one.
  assert.equal(stayOf({}), NOTICE_MS);
  assert.ok(stayOf({ detail: "If you do not know them, remove them under Friends." }) > NOTICE_MS);
});
