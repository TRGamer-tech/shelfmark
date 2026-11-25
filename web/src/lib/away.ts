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
 *
 * [who] is the other person as the book names them, or empty when it names nobody.
 */
export interface Away {
  kind: "lent" | "returned";
  who: string;
}

type AwayFields = Pick<Book, "lentTo" | "ownership" | "loanId" | "borrowedFrom" | "status">;

/**
 * Whether a book is away, or null for a book that is drawn as usual: a borrowed book
 * while the reader has it, a wish or a library copy that was never borrowed, and a book
 * given back that is read.
 */
export function awayOf(book: AwayFields): Away | null {
  if (book.lentTo.trim() !== "") return { kind: "lent", who: book.lentTo.trim() };
  const borrowed = book.loanId.trim() !== "" || book.borrowedFrom.trim() !== "";
  if (book.ownership === "NOT_OWNED" && borrowed && book.status !== "READ") return { kind: "returned", who: book.borrowedFrom.trim() };
  return null;
}

/**
 * The words for it, as the name of a text and the name that fills it: "Lent to Bo",
 * "Given back to Lena, not finished". A book that names nobody, or a friend who never
 * gave themselves a name (written as "?" on the book), is said with [someone].
 */
export function awayWords(away: Away, someone: string): { key: "book_away_lent" | "book_away_returned"; who: string } {
  return { key: away.kind === "lent" ? "book_away_lent" : "book_away_returned", who: away.who === "" || away.who === "?" ? someone : away.who };
}
