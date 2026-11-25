"use client";

// The book cart of the signed-in reader (lib/cart.ts): kept in memory for the pages and
// in the storage of the browser, so that it survives a reload. It does not go to the
// account. Signing out takes it along (components/auth.tsx).

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Cart, CartItem, CartSettings } from "@/lib/cart";
import { emptied, emptyCart, followForAll, onCart, putOnCart, readCart, setForAll, setOwn, shelveCart, takeOffCart, toShelve, toggleOnCart, wantAnyway, worthKeeping, writeCart } from "@/lib/cart";
import { today } from "@/lib/dates";
import { findCovers } from "@/lib/findCovers";
import { newId } from "@/lib/ids";
import type { Book } from "@/lib/model";
import { fillCovers } from "@/lib/mutations";
import { droppedCoverFiles, removeCoverFiles } from "@/lib/supabase/covers";
import { useAuth } from "./auth";
import { Icon } from "./icons";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";

interface CartContext {
  cart: Cart;
  /** How many books wait on the cart. */
  count: number;
  /** The entry of a book on the cart, if it is there (the same ISBN, or the same title and first author). */
  entryOf: (book: Pick<Book, "title" | "authors" | "isbn">) => CartItem | undefined;
  /** Puts a book on the cart. [own] sets it apart from the rest at once, with what it names. */
  put: (book: Book, own?: Partial<CartSettings> | null) => void;
  /** The one button of a search result: on the cart, or off it again. */
  toggle: (book: Book) => void;
  takeOff: (key: string) => void;
  forAll: (patch: Partial<CartSettings>) => void;
  forOne: (key: string, patch: Partial<CartSettings>) => void;
  /** Lets a book that was set apart go with the rest again. */
  likeTheRest: (key: string) => void;
  anyway: (key: string, wanted: boolean) => void;
  clear: () => void;
  /** How many books shelving would put on the shelf: all but those that stand there already and are not wanted twice. */
  shelving: number;
  /** Shelves the cart with one change to the library, empties it, and says how many books went onto the shelf. */
  shelve: () => number;
}

const Context = createContext<CartContext | null>(null);

export function useCart(): CartContext {
  const value = useContext(Context);
  if (!value) throw new Error("useCart needs a CartProvider above it");
  return value;
}

function stored(key: string): Cart {
  try {
    return readCart(window.localStorage.getItem(key));
  } catch {
    // A browser that keeps nothing: the cart lives as long as the page does.
    return emptyCart();
  }
}

/** So many covers are looked for at the same time once a cart is shelved. The catalogues are asked politely. */
const COVER_SEARCHES = 3;

export function CartProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { lang, plural } = useI18n();
  const { config, client } = useAuth();
  const { vault, mutate } = useLibrary();
  // Every account its own: whoever signs in next on this browser has other books.
  const key = `shelfmark.cart.${userId}`;
  // Read at once, not after the first paint: a reload of the cart must not show an empty one first.
  const [cart, setCart] = useState<Cart>(() => stored(key));
  const current = useRef(cart);
  // What a screen reader is told about the cart: how many books are on it, after every change of the number.
  const [said, setSaid] = useState("");

  const latest = useRef({ vault, mutate, lang, plural });
  latest.current = { vault, mutate, lang, plural };

  // Another window of this browser changed the cart: this one follows.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== key) return;
      current.current = readCart(event.newValue);
      setCart(current.current);
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, [key]);

  /**
   * A picture that was uploaded for a book on the cart (one typed in by hand) belongs to
   * that book. When the book leaves the cart without going onto the shelf, nothing will
   * ever show the picture, so it is taken off the server, unless a book of the library or
   * another one on the cart shows it.
   */
  const letGo = useCallback(
    (gone: readonly Book[], kept: readonly Book[]) => {
      const files = droppedCoverFiles(config, userId, gone, [...latest.current.vault.books, ...kept]);
      if (files.length === 0) return;
      void client.auth.getSession().then(
        ({ data }) => (data.session ? removeCoverFiles(config, data.session.access_token, userId, files) : undefined),
        () => undefined,
      );
    },
    [client, config, userId],
  );

  const change = useCallback(
    (edit: (cart: Cart) => Cart, { quiet = false }: { quiet?: boolean } = {}) => {
      const before = current.current;
      const next = edit(before);
      if (next === before) return before;
      current.current = next;
      setCart(next);
      try {
        if (worthKeeping(next)) window.localStorage.setItem(key, writeCart(next));
        else window.localStorage.removeItem(key);
      } catch {
        // Not kept then. The cart is still there until the page is closed.
      }
      if (!quiet && next.items.length !== before.items.length) setSaid(latest.current.plural("cart_count", next.items.length));
      return before;
    },
    [key],
  );

  /** Changes the cart and lets go of the pictures of the books that left it. */
  const changeAndLetGo = useCallback(
    (edit: (cart: Cart) => Cart) => {
      const before = change(edit);
      const after = current.current;
      const stays = new Set(after.items.map((item) => item.key));
      const gone = before.items.filter((item) => !stays.has(item.key)).map((item) => item.book);
      if (gone.length > 0) letGo(gone, after.items.map((item) => item.book));
    },
    [change, letGo],
  );

  const shelve = useCallback(() => {
    const now = Date.now();
    const { vault: library, mutate: save } = latest.current;
    const full = current.current;
    const { change: shelved, books } = shelveCart(full, library.books, () => newId(now), today(), now);
    if (books.length > 0) void save(shelved);
    // Said by the notice that follows, not by the count going to nothing.
    change(emptied, { quiet: true });
    const shelvedKeys = new Set(toShelve(full, library.books).map((item) => item.key));
    const leftOut = full.items.filter((item) => !shelvedKeys.has(item.key)).map((item) => item.book);
    if (leftOut.length > 0) letGo(leftOut, books);
    // Covers are looked for afterwards, as for a single book that came without one, and
    // what is found is saved together: one more save, not one for each book.
    const bare = books.filter((book) => book.coverUrl.trim() === "" && book.coverPath.trim() === "");
    if (bare.length > 0) {
      void (async () => {
        const found: { bookId: number; url: string }[] = [];
        const queue = bare.slice();
        const worker = async () => {
          for (let book = queue.shift(); book; book = queue.shift()) {
            const [url] = await findCovers(book.title, book.authors, book.isbn, latest.current.lang);
            if (url) found.push({ bookId: book.id, url });
          }
        };
        await Promise.all(Array.from({ length: Math.min(COVER_SEARCHES, bare.length) }, worker));
        // A book that got a cover in the meantime keeps it: the change looks again.
        if (found.length > 0) void latest.current.mutate(fillCovers(found, Date.now()));
      })();
    }
    return books.length;
  }, [change, letGo]);

  const value = useMemo<CartContext>(
    () => ({
      cart,
      count: cart.items.length,
      entryOf: (book) => onCart(cart, book),
      put: (book, own = null) => change((now) => putOnCart(now, book, own)),
      toggle: (book) => changeAndLetGo((now) => toggleOnCart(now, book)),
      takeOff: (itemKey) => changeAndLetGo((now) => takeOffCart(now, itemKey)),
      forAll: (patch) => change((now) => setForAll(now, patch)),
      forOne: (itemKey, patch) => change((now) => setOwn(now, itemKey, patch)),
      likeTheRest: (itemKey) => change((now) => followForAll(now, itemKey)),
      anyway: (itemKey, wanted) => change((now) => wantAnyway(now, itemKey, wanted)),
      clear: () => changeAndLetGo(emptied),
      shelving: toShelve(cart, vault.books).length,
      shelve,
    }),
    [cart, vault.books, change, changeAndLetGo, shelve],
  );

  return (
    <Context.Provider value={value}>
      {/* One place that tells a screen reader how full the cart is, on whatever page it was changed. It is there before anything is said, or the first word would not be heard. */}
      <p className="sr-only" role="status" data-testid="cart-said">
        {said}
      </p>
      {children}
    </Context.Provider>
  );
}

/**
 * The bar of the add pages while books wait on the cart: how many, and the way to it.
 * The number is told to a screen reader by the provider above, wherever it changes.
 */
export function CartBar() {
  const { t, plural } = useI18n();
  const { count } = useCart();
  if (count === 0) return null;
  return (
    <div className="cart-bar" data-testid="cart-bar">
      <Icon name="cart" />
      <span className="grow" data-testid="cart-bar-count">
        {plural("cart_count", count)}
      </span>
      <Link href="/add/cart" className="btn btn-filled" data-testid="cart-open">
        <span>{t("cart_open")}</span>
      </Link>
    </div>
  );
}
