"use client";

// Looking up covers for every book that has none, e.g. after a list came in from another
// app (findMissingCovers in the app's AppContainer.kt). It goes on while the reader
// moves to other pages, so it lives above them.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { findCovers } from "@/lib/findCovers";
import { booksWithoutCover, fillCovers } from "@/lib/mutations";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";

interface CoverJob {
  /** How many books were looked up, of how many. Null when nothing is being searched. */
  progress: [number, number] | null;
  start: () => void;
}

const Context = createContext<CoverJob | null>(null);

export function useCoverJob(): CoverJob {
  const value = useContext(Context);
  if (!value) throw new Error("useCoverJob needs a CoverJobProvider above it");
  return value;
}

// So many found covers are saved together. One save per book would send the whole
// library to the server hundreds of times for a long list.
const SAVE_EVERY = 10;

export function CoverJobProvider({ children }: { children: ReactNode }) {
  const { t, plural, lang } = useI18n();
  const { vault, mutate, notify } = useLibrary();
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const running = useRef(false);
  const latest = useRef({ vault, mutate, notify, t, plural, lang });
  latest.current = { vault, mutate, notify, t, plural, lang };

  const start = useCallback(() => {
    if (running.current) return;
    running.current = true;
    const books = booksWithoutCover(latest.current.vault);
    setProgress([0, books.length]);
    void (async () => {
      let waiting: { bookId: number; url: string }[] = [];
      let found = 0;
      const save = () => {
        if (waiting.length === 0) return;
        // A book that got a cover or a photo in the meantime keeps it, the change looks again.
        void latest.current.mutate(fillCovers(waiting, Date.now()));
        waiting = [];
      };
      try {
        for (let index = 0; index < books.length; index++) {
          const book = books[index];
          const [url] = await findCovers(book.title, book.authors, book.isbn, latest.current.lang);
          if (url) {
            waiting.push({ bookId: book.id, url });
            found++;
            if (waiting.length >= SAVE_EVERY) save();
          }
          setProgress([index + 1, books.length]);
        }
      } finally {
        save();
        running.current = false;
        setProgress(null);
        const say = latest.current;
        say.notify(found > 0 ? say.plural("web_covers_found", found) : say.t("web_covers_none"));
      }
    })();
  }, []);

  const value = useMemo(() => ({ progress, start }), [progress, start]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
