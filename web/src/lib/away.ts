// Books that are away, see "Books that are away" in supabase/README.md. A book that is
// not in the reader's hands is drawn see-through with a dashed outline, like the outline
// left where something used to stand. Whether a book is away is decided from the book
// alone, and the Android app decides it the same way.

import type { Book } from "./model.ts";

/**
 * Why a book is away:
 *
 * - "lent": somebody else has it. That is a book lent by hand and a book that is out on a
 *   loan between friends, which writes the borrower's name on it.
 * - "returned": it was borrowed, by a loan or by hand, is back with its owner, and the
 *   reader did not finish it. Marking it read makes it solid again.
 * - "notMine": it is not the reader's and never was (a wish, a copy from the library), or
 *   it is on the wishlist while it says it is owned.
 *
 * [who] is the other person as the book names them, or empty when it names nobody.
 */
export interface Away {
  kind: "lent" | "returned" | "notMine";
  who: string;
}

type AwayFields = Pick<Book, "lentTo" | "ownership" | "loanId" | "borrowedFrom" | "status">;

/**
 * Whether a book is away, or null for a book that is drawn as usual. In this order, as
 * the contract has it (and supabase/samples/away-cases.json for every combination):
 * lent in every list; read and not lent is solid, whoever owns it; not the reader's and
 * borrowed once is "returned", never borrowed is "notMine"; a wish that says it is owned
 * is "notMine" too. Everything else is here: an owned book in every list but the
 * wishlist, and a borrowed book in every list, since the reader has it.
 */
export function awayOf(book: AwayFields): Away | null {
  if (book.lentTo.trim() !== "") return { kind: "lent", who: book.lentTo.trim() };
  if (book.status === "READ") return null;
  if (book.ownership === "NOT_OWNED") {
    const borrowed = book.loanId.trim() !== "" || book.borrowedFrom.trim() !== "";
    return borrowed ? { kind: "returned", who: book.borrowedFrom.trim() } : { kind: "notMine", who: "" };
  }
  if (book.ownership === "OWNED" && book.status === "WISHLIST") return { kind: "notMine", who: "" };
  return null;
}

/**
 * The words for it, as the name of a text and the name that fills it: "Lent to Bo",
 * "Given back to Lena, not finished", "Not mine". A book that names nobody, or a friend
 * who never gave themselves a name (written as "?" on the book), is said with [someone].
 */
export function awayWords(away: Away, someone: string): { key: "book_away_lent" | "book_away_returned" | "ownership_not_owned"; who: string } {
  if (away.kind === "notMine") return { key: "ownership_not_owned", who: "" };
  return { key: away.kind === "lent" ? "book_away_lent" : "book_away_returned", who: away.who === "" || away.who === "?" ? someone : away.who };
}
