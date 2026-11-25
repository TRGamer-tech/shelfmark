// Which books are away (src/lib/away.ts), case by case as "Books that are away" in
// supabase/README.md has them, and that the look can be read in every theme.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Away } from "../src/lib/away.ts";
import { awayOf, awayWords } from "../src/lib/away.ts";
import { followLoans, readLoan } from "../src/lib/loans.ts";
import type { Book, Ownership, ReadingStatus } from "../src/lib/model.ts";
import { emptyVault } from "../src/lib/model.ts";
import { utcZone } from "../src/lib/dates.ts";
import { THEME_PRESETS, contrast, mix, paletteOf, rgbOfCss } from "../src/lib/theme.ts";
import { book as bookOf } from "./helpers.ts";

/** A book with what a test says about it. */
const book = (fields: Partial<Book> = {}): Book => bookOf({ title: "Emma", ...fields });

const L1 = "3f2a9c1e-7b4d-4e8a-9c0d-112233445566";
const STATUSES: ReadingStatus[] = ["NONE", "WISHLIST", "READING", "READ", "ABANDONED"];
const OWNERSHIPS: Ownership[] = ["OWNED", "BORROWED", "NOT_OWNED"];

test("a book that is lent is away, by hand or by a loan, until it is back", () => {
  // Lent by hand, to somebody without Shelfmark.
  assert.deepEqual(awayOf(book({ lentTo: "Bo", lentSince: 20000 })), { kind: "lent", who: "Bo" });
  // Lent by a loan between friends: the rules write the borrower's name and the loan on the book.
  assert.deepEqual(awayOf(book({ lentTo: "Ben", lentSince: 20000, loanId: L1 })), { kind: "lent", who: "Ben" });
  // Whatever it is otherwise: read or not, on whatever list.
  for (const status of STATUSES) assert.equal(awayOf(book({ lentTo: "Bo", status }))?.kind, "lent", status);
  // Back: the name is gone, and the book is solid again.
  assert.equal(awayOf(book({ lentTo: "", lentSince: null })), null);
  assert.equal(awayOf(book({ lentTo: "   " })), null);
  // A name with spaces around it is the name.
  assert.deepEqual(awayOf(book({ lentTo: "  Bo " })), { kind: "lent", who: "Bo" });
});

test("a book given back unfinished is away, and marking it read makes it solid", () => {
  // Borrowed by a loan, given back: the copy stays, not mine, with the lender's name and the loan.
  const returned = (status: ReadingStatus) => book({ ownership: "NOT_OWNED", borrowedFrom: "Lena", loanId: L1, status });
  for (const status of ["NONE", "WISHLIST", "READING", "ABANDONED"] as ReadingStatus[]) {
    assert.deepEqual(awayOf(returned(status)), { kind: "returned", who: "Lena" }, status);
  }
  assert.equal(awayOf(returned("READ")), null);
  // Borrowed by hand and given back: the name alone says that it was borrowed.
  assert.deepEqual(awayOf(book({ ownership: "NOT_OWNED", borrowedFrom: "Lena", status: "READING" })), { kind: "returned", who: "Lena" });
  assert.equal(awayOf(book({ ownership: "NOT_OWNED", borrowedFrom: "Lena", status: "READ" })), null);
  // The loan alone says so as well, should the name be gone.
  assert.deepEqual(awayOf(book({ ownership: "NOT_OWNED", loanId: L1, status: "NONE" })), { kind: "returned", who: "" });
  // A status this website does not know is not "read".
  assert.equal(awayOf(book({ ownership: "NOT_OWNED", borrowedFrom: "Lena", status: "PAUSED" as ReadingStatus }))?.kind, "returned");
});

test("everything else is drawn as usual", () => {
  // A borrowed book while the reader has it, by a loan or by hand, in every status.
  for (const status of STATUSES) {
    assert.equal(awayOf(book({ ownership: "BORROWED", borrowedFrom: "Lena", loanId: L1, status })), null, `borrowed, ${status}`);
    assert.equal(awayOf(book({ ownership: "BORROWED", borrowedFrom: "Lena", status })), null, `borrowed by hand, ${status}`);
  }
  // A wish, or a copy from the public library, that was never borrowed from anybody.
  for (const status of STATUSES) assert.equal(awayOf(book({ ownership: "NOT_OWNED", status })), null, `never borrowed, ${status}`);
  // An own book at home, also one that carries the mark of a loan that is over or the name of somebody it once came from.
  for (const status of STATUSES) {
    assert.equal(awayOf(book({ ownership: "OWNED", status })), null, `own, ${status}`);
    assert.equal(awayOf(book({ ownership: "OWNED", borrowedFrom: "Lena", loanId: L1, status })), null, `own with old marks, ${status}`);
  }
  // Blank is not a name.
  assert.equal(awayOf(book({ ownership: "NOT_OWNED", borrowedFrom: "  ", loanId: " " })), null);
});

test("every combination is decided, and lent comes first", () => {
  let away = 0;
  for (const ownership of OWNERSHIPS) {
    for (const status of STATUSES) {
      for (const lentTo of ["", "Bo"]) {
        for (const borrowedFrom of ["", "Lena"]) {
          for (const loanId of ["", L1]) {
            const found = awayOf(book({ ownership, status, lentTo, borrowedFrom, loanId }));
            const expected: Away | null =
              lentTo !== "" ? { kind: "lent", who: "Bo" } : ownership === "NOT_OWNED" && (borrowedFrom !== "" || loanId !== "") && status !== "READ" ? { kind: "returned", who: borrowedFrom } : null;
            assert.deepEqual(found, expected, `${ownership} ${status} lent:${lentTo} from:${borrowedFrom} loan:${loanId}`);
            if (found) away++;
          }
        }
      }
    }
  }
  // 60 lent (every ownership, status, name and loan), and 12 given back unfinished.
  assert.equal(away, 72);
});

test("the books follow the loans into and out of being away", () => {
  const loan = (role: string, state: string) => readLoan({ id: L1, role, peer: "p", peerName: role === "lender" ? "Ben" : "Anna", bookId: 7, book: { title: "Emma" }, state, receivedAt: 8_640_000_000, askedAt: 1, updatedAt: 2, byMe: false })!;
  const library = { ...emptyVault(), books: [book({ id: 7, title: "Emma" })] };
  const after = (role: string, state: string, from = library) => followLoans([loan(role, state)], () => undefined, utcZone, 5)(from);
  // The lender's book: here until the borrower has it, away while it is out, here again when it is back.
  assert.equal(awayOf(after("lender", "handed").books[0]), null);
  const out = after("lender", "on_loan");
  assert.deepEqual(awayOf(out.books[0]), { kind: "lent", who: "Ben" });
  assert.equal(awayOf(after("lender", "given_back", out).books[0])?.kind, "lent");
  assert.equal(awayOf(after("lender", "returned", out).books[0]), null);
  // The borrower's copy: solid while they have it, away once it is given back, unless they read it.
  const mine = after("borrower", "on_loan", emptyVault());
  assert.equal(awayOf(mine.books[0]), null);
  const back = after("borrower", "returned", mine);
  assert.deepEqual(awayOf(back.books[0]), { kind: "returned", who: "Anna" });
  assert.equal(awayOf({ ...back.books[0], status: "READING" })?.kind, "returned");
  assert.equal(awayOf({ ...back.books[0], status: "READ" }), null);
});

test("the words name the other person, or somebody when the book names nobody", () => {
  assert.deepEqual(awayWords({ kind: "lent", who: "Bo" }, "Someone"), { key: "book_away_lent", who: "Bo" });
  assert.deepEqual(awayWords({ kind: "returned", who: "Lena" }, "Someone"), { key: "book_away_returned", who: "Lena" });
  // A friend who never gave themselves a name stands on the book as "?", and a book can name nobody at all.
  assert.deepEqual(awayWords({ kind: "lent", who: "?" }, "Someone"), { key: "book_away_lent", who: "Someone" });
  assert.deepEqual(awayWords({ kind: "returned", who: "" }, "Jemand"), { key: "book_away_returned", who: "Jemand" });
});

test("the dashed outline can be seen in every theme, on every ground a book stands on", () => {
  for (const preset of THEME_PRESETS) {
    const palette = paletteOf(preset);
    const c = (name: string) => rgbOfCss(palette[name]);
    const line = c("--away");
    // The page, a card (the book that is being read), a row under the pointer, the back of a shelf,
    // and the foot of a shelf row, which lies in the shadow of the board (16 percent black over the back).
    const grounds: [string, ReturnType<typeof c>][] = [
      ["--bg", c("--bg")],
      ["--card", c("--card")],
      ["--surface-low", c("--surface-low")],
      ["--shelf-back", c("--shelf-back")],
      ["the foot of a shelf", mix(c("--shelf-back"), [0, 0, 0], 0.16)],
    ];
    for (const [name, ground] of grounds) {
      const ratio = contrast(line, ground);
      // What is drawn, not print: three to one is what has to be seen.
      assert.ok(ratio >= 3, `${preset.key}: the outline on ${name} is ${ratio.toFixed(2)}`);
    }
  }
});

test("only the picture of an away book is see-through: its words keep their full contrast", () => {
  // The stylesheet without its comments: they speak of these things in whole sentences.
  const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // Every rule that makes something see-through for an away book names the picture: a cover, or the body of a spine.
  const faded = Array.from(css.matchAll(/([^{}]*\.away[^{}]*)\{([^}]*)\}/g)).filter(([, , body]) => /(^|[;\s])opacity\s*:/.test(body));
  assert.ok(faded.length > 0, "a rule that makes an away book see-through");
  for (const [, selector] of faded) {
    for (const part of selector.split(",")) {
      assert.match(part.trim(), /(\.cover|\.spine-body)$/, `see-through: ${part.trim()}`);
    }
  }
  // About 45 percent see-through, as the contract has it, in one place.
  assert.match(css, /--away-opacity:\s*0\.45;/);
  // The list row itself, its title and its author are never made see-through.
  assert.ok(!/\.book-row(\.away)?\s*\{[^}]*opacity/.test(css));
  assert.ok(!/\.book-row-(title|authors)[^{]*\{[^}]*opacity/.test(css));
  // The change fades only where motion is wanted.
  const moving = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.match(moving, /html\[data-motion="on"\] \.spine-body,[\s\S]*?transition:[^;]*opacity/);
});
