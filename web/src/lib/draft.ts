// Hands a book from the search to the form for typing one in, without squeezing it
// through the address of the page.

import type { Book } from "./model.ts";

let draft: Book | null = null;

export function setDraft(book: Book | null): void {
  draft = book;
}

/** The book that was left for the form, if any. It is handed out once. */
export function takeDraft(): Book | null {
  const book = draft;
  draft = null;
  return book;
}
