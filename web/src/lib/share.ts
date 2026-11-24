// What friends get of a library (ShareCodec in data/share/SharePayloads.kt).

import type { Book, BookShelf, Envelope, Shelf, SharedBook, SharedLibrary, Vault } from "./model.ts";
import { TYPE_LIBRARY, makeEnvelope, prefsOf, sharedBookCodec, writeEnvelope } from "./model.ts";
import { availableToLend } from "./rules.ts";

const NONE: ReadonlySet<number> = new Set();

/**
 * Builds the snapshot friends receive. Private details are only included when the owner
 * opted in. [held] are the books a loan has reserved for a friend or in a friend's hands
 * (lib/loans.ts): nobody else can ask for those now.
 */
export function buildLibrary(
  ownerId: string,
  ownerName: string,
  books: Book[],
  shelves: Shelf[],
  links: BookShelf[],
  includeStatus: boolean,
  includeRatings: boolean,
  now: number,
  held: ReadonlySet<number> = NONE,
): SharedLibrary {
  const shelfNames = new Map(shelves.map((shelf) => [shelf.id, shelf.name]));
  const shelvesByBook = new Map<number, string[]>();
  for (const link of links) {
    const name = shelfNames.get(link.shelfId);
    const names = shelvesByBook.get(link.bookId) ?? [];
    if (name !== undefined) names.push(name);
    shelvesByBook.set(link.bookId, names);
  }
  const shared = books
    // Without status sharing the snapshot is "who owns what", so the wishlist stays private.
    .filter((book) => includeStatus || book.ownership !== "NOT_OWNED")
    .map(
      (book): SharedBook => ({
        ...sharedBookCodec.read({}),
        id: book.id,
        title: book.title,
        authors: book.authors,
        isbn: book.isbn,
        coverUrl: book.coverUrl,
        pages: book.pageCount,
        format: book.format,
        description: book.description,
        ownership: book.ownership,
        available: availableToLend(book) && !held.has(book.id),
        status: includeStatus ? book.status : null,
        shelves: includeStatus ? (shelvesByBook.get(book.id) ?? []) : [],
        rating: includeRatings ? book.rating : 0,
        spice: includeRatings ? book.spice : 0,
        review: includeRatings ? book.review : "",
        startedOn: includeRatings ? book.startedOn : null,
        finishedOn: includeRatings ? book.finishedOn : null,
      }),
    );
  return { ownerId, ownerName, createdAt: now, includesStatus: includeStatus, includesRatings: includeRatings, books: shared };
}

/** The envelope that is published for friends, built from the library and its sharing settings. */
export function libraryEnvelope(vault: Vault, ownerId: string, now: number, held: ReadonlySet<number> = NONE): Envelope {
  const prefs = prefsOf(vault);
  return makeEnvelope(TYPE_LIBRARY, {
    library: buildLibrary(ownerId, prefs.profileName, vault.books, vault.shelves, vault.links, prefs.shareStatus, prefs.shareRatings, now, held),
  });
}

/** Two libraries with the same fingerprint are the same library: the time it was built is left out. */
export function libraryFingerprint(envelope: Envelope): string {
  const stable: Envelope = { ...envelope, library: envelope.library ? { ...envelope.library, createdAt: 0 } : null };
  return JSON.stringify(writeEnvelope(stable));
}
