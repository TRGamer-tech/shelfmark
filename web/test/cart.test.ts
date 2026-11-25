// The book cart as data (src/lib/cart.ts): putting books on it and taking them off, the
// settings for all and for one, books that are on the shelf already, shelving as one
// change, and what the browser keeps of it.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cart, CartSettings } from "../src/lib/cart.ts";
import { USUAL_SETTINGS, alreadyHere, cartKeyOf, chosenWhereFound, emptied, emptyCart, followForAll, onCart, worthKeeping, putOnCart, readCart, sameBook, setForAll, setOwn, settingsOf, shelveCart, shelvedBook, takeOffCart, toShelve, toggleOnCart, wantAnyway, writeCart } from "../src/lib/cart.ts";
import { sameBook as sameForTheImport } from "../src/lib/csvImport.ts";
import type { Book, Vault } from "../src/lib/model.ts";
import { emptyVault, writeVault } from "../src/lib/model.ts";
import { createShelf } from "../src/lib/mutations.ts";
import { book as bookOf } from "./helpers.ts";

const book = (title: string, more: Partial<Book> = {}): Book => bookOf({ title, authors: "J. K. Rowling", ...more });
const stone = book("Harry Potter and the Philosopher's Stone", { isbn: "9780747532699", pageCount: 223 });
const chamber = book("Harry Potter and the Chamber of Secrets", { isbn: "9780747538493", pageCount: 251 });
const prisoner = book("Harry Potter and the Prisoner of Azkaban", { pageCount: 317 });
const three = (): Cart => [stone, chamber, prisoner].reduce((cart, each) => putOnCart(cart, each), emptyCart());
const titles = (cart: Cart) => cart.items.map((item) => item.book.title.replace("Harry Potter and the ", ""));
/** Ids as the page hands them out, one after the other. */
const counter = (from: number) => () => from++;

test("books are put on the cart in the order they were found, and taken off again", () => {
  const cart = three();
  assert.deepEqual(titles(cart), ["Philosopher's Stone", "Chamber of Secrets", "Prisoner of Azkaban"]);
  // A book on the cart has no id yet, goes with the rest, and is not wanted twice.
  assert.deepEqual(cart.items.map((item) => [item.book.id, item.own, item.anyway]), [[0, null, false], [0, null, false], [0, null, false]]);
  assert.ok(onCart(cart, chamber));
  const without = takeOffCart(cart, cartKeyOf(chamber));
  assert.deepEqual(titles(without), ["Philosopher's Stone", "Prisoner of Azkaban"]);
  assert.equal(onCart(without, chamber), undefined);
  // Taking off what is not there changes nothing, and neither is the cart a new one.
  assert.equal(takeOffCart(without, cartKeyOf(chamber)), without);
  // A book without a title is no book.
  assert.equal(putOnCart(cart, book("  ")), cart);
  // The cart that was changed is a new one: the old one is as it was.
  assert.equal(cart.items.length, 3);
});

test("the same book is not on the cart twice, however it was found", () => {
  const cart = three();
  assert.equal(putOnCart(cart, stone), cart);
  // The same edition from another catalogue: the same ISBN under another spelling of the title.
  assert.equal(putOnCart(cart, book("Harry Potter und der Stein der Weisen", { isbn: "9780747532699" })), cart);
  // No ISBN: the same title and first author, whatever the case and the punctuation, whoever else is named.
  assert.equal(putOnCart(cart, book("HARRY POTTER and the prisoner of Azkaban!", { authors: "j.k. rowling, Mary GrandPré" })), cart);
  // Another volume, or the same title by somebody else, is another book.
  assert.equal(putOnCart(cart, book("Harry Potter and the Goblet of Fire")).items.length, 4);
  assert.equal(putOnCart(cart, book("Harry Potter and the Prisoner of Azkaban", { authors: "Somebody Else" })).items.length, 4);
  // The one button of a search result: on, and off again.
  const on = toggleOnCart(emptyCart(), stone);
  assert.deepEqual(titles(on), ["Philosopher's Stone"]);
  assert.deepEqual(titles(toggleOnCart(on, book("Harry Potter und der Stein der Weisen", { isbn: "9780747532699" }))), []);
  assert.equal(sameBook(stone, chamber), false);
  assert.equal(cartKeyOf(stone), "isbn:9780747532699");
  assert.equal(cartKeyOf(prisoner), "name:harrypotterandtheprisonerofazkaban|jkrowling");
});

test("what is set for all counts for every book that was not set apart", () => {
  let cart = three();
  assert.deepEqual(cart.forAll, USUAL_SETTINGS);
  cart = setForAll(cart, { status: "READ", listIds: [5, 6] });
  for (const item of cart.items) assert.deepEqual(settingsOf(cart, item), { status: "READ", ownership: "OWNED", listIds: [5, 6] });
  // One book is set apart: borrowed, on one list only.
  cart = setOwn(cart, cartKeyOf(chamber), { ownership: "BORROWED", listIds: [6] });
  assert.deepEqual(settingsOf(cart, onCart(cart, chamber)!), { status: "READ", ownership: "BORROWED", listIds: [6] });
  // What is set for all afterwards reaches the others, and the book that was set apart keeps what it has.
  cart = setForAll(cart, { status: "READING", ownership: "NOT_OWNED", listIds: [] });
  assert.deepEqual(settingsOf(cart, onCart(cart, stone)!), { status: "READING", ownership: "NOT_OWNED", listIds: [] });
  assert.deepEqual(settingsOf(cart, onCart(cart, prisoner)!), { status: "READING", ownership: "NOT_OWNED", listIds: [] });
  assert.deepEqual(settingsOf(cart, onCart(cart, chamber)!), { status: "READ", ownership: "BORROWED", listIds: [6] });
  // Its own settings can be changed again, one at a time.
  cart = setOwn(cart, cartKeyOf(chamber), { status: "ABANDONED" });
  assert.deepEqual(settingsOf(cart, onCart(cart, chamber)!), { status: "ABANDONED", ownership: "BORROWED", listIds: [6] });
  // A list is on the list of lists once.
  assert.deepEqual(setForAll(cart, { listIds: [5, 5, 6] }).forAll.listIds, [5, 6]);
});

test("a book that was set apart can go with the rest again", () => {
  let cart = setOwn(setForAll(three(), { status: "READ" }), cartKeyOf(chamber), { ownership: "BORROWED", listIds: [6] });
  cart = followForAll(cart, cartKeyOf(chamber));
  assert.equal(onCart(cart, chamber)!.own, null);
  assert.deepEqual(settingsOf(cart, onCart(cart, chamber)!), cart.forAll);
  // From here on what is set for all reaches it again.
  cart = setForAll(cart, { status: "WISHLIST" });
  assert.equal(settingsOf(cart, onCart(cart, chamber)!).status, "WISHLIST");
  // A book that goes with the rest already, or one that is not there, changes nothing.
  assert.equal(followForAll(cart, cartKeyOf(chamber)), cart);
  assert.equal(followForAll(cart, "isbn:0000000000000"), cart);
});

test("a book whose list was chosen where it was found takes that choice onto the cart, and the rest from the settings for all", () => {
  let cart = setForAll(three(), { ownership: "BORROWED", listIds: [5] });
  // Chosen in the preview of a search result, or in the form for typing a book in: a status and the lists.
  const goblet = book("Harry Potter and the Goblet of Fire", { isbn: "9780747546245" });
  cart = putOnCart(cart, goblet, { status: "READING", listIds: [6] });
  assert.deepEqual(onCart(cart, goblet)!.own, { status: "READING", ownership: "BORROWED", listIds: [6] });
  // Set apart: what is set for all afterwards does not reach it.
  cart = setForAll(cart, { ownership: "OWNED", listIds: [] });
  assert.deepEqual(settingsOf(cart, onCart(cart, goblet)!), { status: "READING", ownership: "BORROWED", listIds: [6] });
  // The wishlist proposes "not mine" there as well, as adding a single book to it does.
  const phoenix = book("Harry Potter and the Order of the Phoenix");
  cart = putOnCart(cart, phoenix, { status: "WISHLIST", listIds: [] });
  assert.deepEqual(onCart(cart, phoenix)!.own, { status: "WISHLIST", ownership: "NOT_OWNED", listIds: [] });
  // Nothing chosen: it goes with the rest.
  const prince = book("Harry Potter and the Half-Blood Prince");
  assert.equal(onCart(putOnCart(cart, prince), prince)!.own, null);
});

test("what counts as chosen where a book was found or typed in is what the phone counts, and the lists", () => {
  // The list left at "unread" and no list of one's own: nothing was chosen.
  assert.equal(chosenWhereFound("NONE", []), null);
  // A list: that list, and the reader's own lists and the ownership as for all at this moment.
  assert.deepEqual(chosenWhereFound("READ", []), { status: "READ" });
  const cart = setForAll(three(), { ownership: "BORROWED", listIds: [5] });
  const deathly = book("Harry Potter and the Deathly Hallows");
  assert.deepEqual(onCart(putOnCart(cart, deathly, chosenWhereFound("READ", [])), deathly)!.own, { status: "READ", ownership: "BORROWED", listIds: [5] });
  // Lists of one's own: those lists, and the status as for all.
  assert.deepEqual(chosenWhereFound("NONE", [6]), { listIds: [6] });
  assert.deepEqual(onCart(putOnCart(cart, deathly, chosenWhereFound("NONE", [6])), deathly)!.own, { status: "NONE", ownership: "BORROWED", listIds: [6] });
  assert.deepEqual(chosenWhereFound("WISHLIST", [5, 6]), { status: "WISHLIST", listIds: [5, 6] });
});

test("an emptied cart keeps how the reader shelves, and is kept only while it holds something", () => {
  let cart = setForAll(three(), { status: "READ", listIds: [6] });
  cart = setOwn(cart, cartKeyOf(chamber), { ownership: "BORROWED" });
  const empty = emptied(cart);
  assert.deepEqual(empty, { forAll: { status: "READ", ownership: "OWNED", listIds: [6] }, items: [] });
  assert.equal(emptied(empty), empty);
  // Kept in the browser: books, or settings of one's own. An empty cart as it came is not.
  assert.equal(worthKeeping(cart), true);
  assert.equal(worthKeeping(empty), true);
  assert.equal(worthKeeping(emptyCart()), false);
  assert.equal(worthKeeping(setForAll(emptyCart(), { ownership: "NOT_OWNED" })), true);
  assert.deepEqual(readCart(writeCart(empty)), empty);
});

test("the cart and the import of lists from other apps agree on what is the same book", () => {
  // One rule in one place (csvImport.ts): what the cart calls "already on your shelf" the import calls "already here".
  assert.equal(sameBook, sameForTheImport);
  const pairs: [Book, Book][] = [
    [stone, book("Der Stein der Weisen", { isbn: "9780747532699", authors: "Somebody" })],
    [prisoner, book("harry potter AND the prisoner of azkaban", { authors: "J.K. Rowling, Jim Kay" })],
    [prisoner, book("Harry Potter and the Prisoner of Azkaban", { authors: "Stephen Fry" })],
    [stone, chamber],
  ];
  for (const [a, b] of pairs) assert.equal(alreadyHere({ key: cartKeyOf(a), book: a, own: null, anyway: false }, [b]), sameForTheImport(a, b), `${a.title} / ${b.title}`);
  assert.deepEqual(pairs.map(([a, b]) => sameBook(a, b)), [true, true, false, false]);
});

test("choosing the wishlist proposes that the book is not one's own, and the reader has the last word", () => {
  let cart = setForAll(three(), { status: "WISHLIST" });
  assert.deepEqual(cart.forAll, { status: "WISHLIST", ownership: "NOT_OWNED", listIds: [] });
  // Said otherwise: it stays that way.
  cart = setForAll(cart, { ownership: "OWNED" });
  assert.deepEqual(cart.forAll, { status: "WISHLIST", ownership: "OWNED", listIds: [] });
  // Another list does not turn the ownership back by itself: the reader chose it.
  assert.equal(setForAll(setForAll(three(), { status: "WISHLIST" }), { status: "READ" }).forAll.ownership, "NOT_OWNED");
  // A borrowed book on the wishlist stays borrowed.
  assert.equal(setForAll(setForAll(three(), { ownership: "BORROWED" }), { status: "WISHLIST" }).forAll.ownership, "BORROWED");
  // The same for one book.
  const apart = setOwn(three(), cartKeyOf(stone), { status: "WISHLIST" });
  assert.deepEqual(settingsOf(apart, onCart(apart, stone)!), { status: "WISHLIST", ownership: "NOT_OWNED", listIds: [] });
});

test("a book that stands on the shelf already is left out, unless the reader wants it anyway", () => {
  const library = [book("Harry Potter and the Chamber of Secrets", { id: 40, isbn: "" }), book("Emma", { id: 41, authors: "Jane Austen" })];
  let cart = three();
  // By title and first author here, since the copy on the shelf has no ISBN.
  assert.deepEqual(cart.items.map((item) => alreadyHere(item, library)), [false, true, false]);
  assert.deepEqual(toShelve(cart, library).map((item) => item.book.title.replace("Harry Potter and the ", "")), ["Philosopher's Stone", "Prisoner of Azkaban"]);
  cart = wantAnyway(cart, cartKeyOf(chamber), true);
  assert.equal(toShelve(cart, library).length, 3);
  cart = wantAnyway(cart, cartKeyOf(chamber), false);
  assert.equal(toShelve(cart, library).length, 2);
  // By ISBN as well.
  assert.equal(alreadyHere(onCart(cart, stone)!, [book("Der Stein der Weisen", { isbn: "9780747532699" })]), true);
  // With an empty shelf everything is new.
  assert.equal(toShelve(cart, []).length, 3);
});

test("shelving is one change: every book with its status, ownership and lists, each with an id of its own", () => {
  let library: Vault = [createShelf(5, "Holiday", 1), createShelf(6, "Series", 2)].reduce((vault, change) => change(vault), emptyVault());
  let cart = setForAll(three(), { status: "READ", listIds: [6] });
  cart = setOwn(cart, cartKeyOf(prisoner), { status: "WISHLIST", listIds: [5, 6, 99] });
  const { change, books } = shelveCart(cart, library.books, counter(1000), 20800, 777);
  assert.deepEqual(books.map((b) => b.id), [1000, 1001, 1002]);
  const before = library;
  library = change(library);
  assert.notEqual(library, before);
  assert.deepEqual(library.books.map((b) => [b.id, b.title.replace("Harry Potter and the ", ""), b.status, b.ownership]), [
    [1000, "Philosopher's Stone", "READ", "OWNED"],
    [1001, "Chamber of Secrets", "READ", "OWNED"],
    [1002, "Prisoner of Azkaban", "WISHLIST", "NOT_OWNED"],
  ]);
  // A status does to a book from the cart what it does to any book: read means finished today, to the last page, once.
  assert.deepEqual([library.books[0].finishedOn, library.books[0].currentPage, library.books[0].readCount], [20800, 223, 1]);
  assert.deepEqual([library.books[2].finishedOn, library.books[2].readCount], [null, 0]);
  // Stamped with the moment of shelving.
  for (const shelved of library.books) assert.deepEqual([shelved.addedAt, shelved.updatedAt], [777, 777]);
  // On the lists that were chosen. A list that is gone by now is simply not there.
  assert.deepEqual(library.links, [
    { bookId: 1000, shelfId: 6 },
    { bookId: 1001, shelfId: 6 },
    { bookId: 1002, shelfId: 5 },
    { bookId: 1002, shelfId: 6 },
  ]);
  // Applied a second time, after another device saved in between, it changes nothing more.
  assert.deepEqual(writeVault(change(library)), writeVault(library));
  // What the catalogue said about the book is what stands on the shelf.
  assert.deepEqual([library.books[0].isbn, library.books[0].pageCount, library.books[0].authors], ["9780747532699", 223, "J. K. Rowling"]);
});

test("shelving leaves out what is on the shelf already, and an empty cart shelves nothing", () => {
  const library = { ...emptyVault(), books: [book("Harry Potter and the Chamber of Secrets", { id: 40 })] };
  const some = shelveCart(three(), library.books, counter(1000), 20800, 777);
  assert.deepEqual(some.books.map((b) => b.title.replace("Harry Potter and the ", "")), ["Philosopher's Stone", "Prisoner of Azkaban"]);
  assert.equal(some.change(library).books.length, 3);
  // Wanted anyway: a second copy, with an id of its own.
  const all = shelveCart(wantAnyway(three(), cartKeyOf(chamber), true), library.books, counter(1000), 20800, 777);
  assert.equal(all.change(library).books.filter((b) => b.title.endsWith("Chamber of Secrets")).length, 2);
  const none = shelveCart(emptyCart(), library.books, counter(1000), 20800, 777);
  assert.deepEqual(none.books, []);
  assert.equal(none.change(library), library);
});

test("an e-book or an audiobook from the cart cannot be lent, like any that is added", () => {
  const settings: CartSettings = { status: "NONE", ownership: "OWNED", listIds: [] };
  assert.equal(shelvedBook(book("Paper", { format: "PAPERBACK" }), settings, 1, 20800).lendable, true);
  assert.equal(shelvedBook(book("File", { format: "EBOOK" }), settings, 1, 20800).lendable, false);
  assert.equal(shelvedBook(book("Voice", { format: "AUDIOBOOK" }), settings, 1, 20800).lendable, false);
  // Reading starts today.
  assert.equal(shelvedBook(book("Now"), { ...settings, status: "READING" }, 1, 20800).startedOn, 20800);
});

test("the cart survives a reload: what was written is read back as it was", () => {
  let cart = setForAll(three(), { status: "READING", listIds: [6] });
  cart = setOwn(cart, cartKeyOf(chamber), { ownership: "BORROWED" });
  cart = wantAnyway(cart, cartKeyOf(prisoner), true);
  const back = readCart(writeCart(cart));
  assert.deepEqual(back, cart);
  // Nothing remembered, or an empty cart: an empty cart.
  assert.deepEqual(readCart(null), emptyCart());
  assert.deepEqual(readCart(writeCart(emptyCart())), emptyCart());
  // What the browser keeps is text, with the books as the library writes them: defaults are left out.
  const kept = JSON.parse(writeCart(cart));
  assert.deepEqual(Object.keys(kept), ["forAll", "items"]);
  assert.deepEqual(kept.items[0].book, { title: stone.title, authors: "J. K. Rowling", isbn: "9780747532699", pageCount: 223 });
});

test("a damaged entry is left out and the rest of the cart is kept", () => {
  const good = JSON.parse(writeCart(three()));
  const damaged = {
    forAll: { status: "LOST", ownership: 7, listIds: [6, "seven", null] },
    items: [good.items[0], null, "a book", { book: null }, { book: { title: "" } }, { book: { authors: "Nobody" } }, { book: { title: 12 } }, { ...good.items[1], own: { status: "READ", ownership: "STOLEN", listIds: "all" }, anyway: "yes" }, good.items[0]],
  };
  const cart = readCart(JSON.stringify(damaged));
  // The two books that can be read, each once.
  assert.deepEqual(titles(cart), ["Philosopher's Stone", "Chamber of Secrets"]);
  // A setting nobody knows falls back to the usual one: nothing is shelved by a word that means nothing.
  assert.deepEqual(cart.forAll, { status: "NONE", ownership: "OWNED", listIds: [6] });
  assert.deepEqual(cart.items[1].own, { status: "READ", ownership: "OWNED", listIds: [] });
  assert.equal(cart.items[1].anyway, false);
  // Not text, not a cart, or cut off in the middle: an empty cart, and no error.
  for (const text of ["", "not json", "[1,2]", "null", '{"items":"many"}', writeCart(three()).slice(0, 60)]) assert.deepEqual(readCart(text), emptyCart(), text);
  // A book that is half there is read with what is there.
  const half = readCart(JSON.stringify({ items: [{ book: { title: "Half", pageCount: "many", isbn: 5 } }] }));
  assert.deepEqual([half.items[0].book.title, half.items[0].book.pageCount, half.items[0].book.isbn], ["Half", 0, ""]);
});
