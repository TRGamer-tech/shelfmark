"use client";

// The book cart of the signed-in reader (lib/cart.ts): kept in memory for the pages and
// in the storage of the browser, so that it survives a reload. It does not go to the
// account. Signing out takes it along (components/auth.tsx).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Cart, CartItem, CartSettings } from "@/lib/cart";
import { emptyCart, onCart, putOnCart, readCart, setForAll, setOwn, shelveCart, takeOffCart, toShelve, wantAnyway, writeCart } from "@/lib/cart";
import { today } from "@/lib/dates";
import { findCovers } from "@/lib/findCovers";
import { newId } from "@/lib/ids";
import type { Book } from "@/lib/model";
import { fillCovers } from "@/lib/mutations";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";

interface CartContext {
  cart: Cart;
  /** How many books wait on the cart. */
  count: number;
  /** The entry of a book on the cart, if it is there (the same ISBN, or the same title and first author). */
  entryOf: (book: Pick<Book, "title" | "authors" | "isbn">) => CartItem | undefined;
  /** Puts a book on the cart. [own] sets it apart from the rest at once. */
  put: (book: Book, own?: CartSettings | null) => void;
  takeOff: (key: string) => void;
  forAll: (patch: Partial<CartSettings>) => void;
  forOne: (key: string, patch: Partial<CartSettings>) => void;
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

export function CartProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { lang } = useI18n();
  const { vault, mutate } = useLibrary();
  const key = `shelfmark.cart.${userId}`;
  const [cart, setCart] = useState<Cart>(emptyCart);
  // Nothing is written before the cart was read: an empty cart must not replace the one that waits in the browser.
  const loaded = useRef(false);

  useEffect(() => {
    try {
      setCart(readCart(window.localStorage.getItem(key)));
    } catch {
      // A browser that keeps nothing: the cart lives as long as the page does.
    }
    loaded.current = true;
    // Another window of this browser changed the cart: this one follows.
    const follow = (event: StorageEvent) => {
      if (event.key === key) setCart(readCart(event.newValue));
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, [key]);

  const change = useCallback(
    (edit: (cart: Cart) => Cart) => {
      setCart((current) => {
        const next = edit(current);
        if (next !== current && loaded.current) {
          try {
            if (next.items.length === 0) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, writeCart(next));
          } catch {
            // Not kept then. The cart is still there until the page is closed.
          }
        }
        return next;
      });
    },
    [key],
  );

  const latest = useRef({ cart, vault, mutate, lang });
  latest.current = { cart, vault, mutate, lang };

  const shelve = useCallback(() => {
    const now = Date.now();
    const { cart: full, vault: library } = latest.current;
    const { change: shelved, books } = shelveCart(full, library.books, () => newId(now), today(), now);
    if (books.length > 0) void latest.current.mutate(shelved);
    change(() => emptyCart());
    // Covers are looked for afterwards, as for a single book that came without one, and
    // what is found is saved together: one more save, not one for each book.
    const bare = books.filter((book) => book.coverUrl.trim() === "");
    if (bare.length > 0) {
      void (async () => {
        const found: { bookId: number; url: string }[] = [];
        for (const book of bare) {
          const [url] = await findCovers(book.title, book.authors, book.isbn, latest.current.lang).catch(() => []);
          if (url) found.push({ bookId: book.id, url });
        }
        if (found.length > 0) void latest.current.mutate(fillCovers(found, Date.now()));
      })();
    }
    return books.length;
  }, [change]);

  const value = useMemo<CartContext>(
    () => ({
      cart,
      count: cart.items.length,
      entryOf: (book) => onCart(cart, book),
      put: (book, own = null) => change((current) => putOnCart(current, book, own)),
      takeOff: (itemKey) => change((current) => takeOffCart(current, itemKey)),
      forAll: (patch) => change((current) => setForAll(current, patch)),
      forOne: (itemKey, patch) => change((current) => setOwn(current, itemKey, patch)),
      anyway: (itemKey, wanted) => change((current) => wantAnyway(current, itemKey, wanted)),
      clear: () => change(() => emptyCart()),
      shelving: toShelve(cart, vault.books).length,
      shelve,
    }),
    [cart, vault.books, change, shelve],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
