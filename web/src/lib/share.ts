// What friends get of a library, and the messages friends send each other
// (ShareCodec in data/share/SharePayloads.kt).

import type { Book, BookShelf, Envelope, LendAnswerMsg, LendRequest, LendRequestMsg, Shelf, SharedBook, SharedLibrary, Vault } from "./model.ts";
import { TYPE_ANSWER, TYPE_LIBRARY, TYPE_REQUEST, makeEnvelope, prefsOf, sharedBookCodec, writeEnvelope } from "./model.ts";
import { availableToLend } from "./rules.ts";

/** Builds the snapshot friends receive. Private details are only included when the owner opted in. */
export function buildLibrary(
  ownerId: string,
  ownerName: string,
  books: Book[],
  shelves: Shelf[],
  links: BookShelf[],
  includeStatus: boolean,
  includeRatings: boolean,
  now: number,
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
        available: availableToLend(book),
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
export function libraryEnvelope(vault: Vault, ownerId: string, now: number): Envelope {
  const prefs = prefsOf(vault);
  return makeEnvelope(TYPE_LIBRARY, {
    library: buildLibrary(ownerId, prefs.profileName, vault.books, vault.shelves, vault.links, prefs.shareStatus, prefs.shareRatings, now),
  });
}

/** Two libraries with the same fingerprint are the same library: the time it was built is left out. */
export function libraryFingerprint(envelope: Envelope): string {
  const stable: Envelope = { ...envelope, library: envelope.library ? { ...envelope.library, createdAt: 0 } : null };
  return JSON.stringify(writeEnvelope(stable));
}

export function requestMessage(request: LendRequest, me: string, myName: string): LendRequestMsg {
  return {
    requestId: request.id,
    bookId: request.bookRemoteId,
    bookTitle: request.bookTitle,
    bookAuthors: request.bookAuthors,
    isbn: request.isbn,
    fromId: me,
    fromName: myName,
    toId: request.peerId,
    note: request.note,
    createdAt: request.createdAt,
  };
}

export function requestEnvelope(request: LendRequest, me: string, myName: string): Envelope {
  return makeEnvelope(TYPE_REQUEST, { request: requestMessage(request, me, myName) });
}

export function answerEnvelope(request: LendRequest, accepted: boolean, me: string, myName: string, now: number): Envelope {
  const answer: LendAnswerMsg = {
    requestId: request.id,
    accepted,
    bookTitle: request.bookTitle,
    fromId: me,
    fromName: myName,
    toId: request.peerId,
    answeredAt: now,
  };
  return makeEnvelope(TYPE_ANSWER, { answer });
}
