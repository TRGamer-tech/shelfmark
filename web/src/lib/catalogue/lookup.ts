// Asks every catalogue at once and merges the answers, so a book missing from one (or a
// catalogue that is down) does not leave the user empty handed (data/remote/BookLookup.kt).
//
// Once the first catalogue has found something the others get a little more time to add
// their part. That keeps a lookup quick even when one catalogue is having a slow day.

import type { RemoteBook } from "./remoteBook.ts";
import { authorLine, fillFrom, normalise, searchWords } from "./remoteBook.ts";
import type { BookSource } from "./source.ts";

/** Thrown only when every catalogue failed. */
export class CataloguesFailed extends Error {
  constructor(cause?: unknown) {
    super("All catalogues failed");
    this.name = "CataloguesFailed";
    this.cause = cause;
  }
}

export interface LookupOptions {
  timeoutMs?: number;
  /** Extra time for the others after the first hit, when one book is looked up by ISBN. */
  graceMs?: number;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Round-robin over the catalogues. Records with the same title and first author are
 * treated as the same book and merged, so the list shows each book once.
 */
export function merge(perSource: RemoteBook[][]): RemoteBook[] {
  const merged = new Map<string, RemoteBook>();
  const longest = perSource.reduce((max, list) => Math.max(max, list.length), 0);
  for (let i = 0; i < longest; i++) {
    for (const list of perSource) {
      const book = list[i];
      if (!book) continue;
      const key = normalise(book.title) + "|" + normalise(book.authors[0] ?? "");
      const known = merged.get(key);
      merged.set(key, known ? fillFrom(known, book) : book);
    }
  }
  return Array.from(merged.values());
}

/**
 * Puts the books that best fit what was typed first. Library catalogues like to answer
 * "der vorleser" with study guides about it, the novel itself should win.
 */
export function rank(query: string, books: RemoteBook[]): RemoteBook[] {
  const words = searchWords(query)
    .map(normalise)
    .filter((word) => word !== "");
  if (words.length === 0) return books;
  const score = (book: RemoteBook): number => {
    const title = normalise(book.title);
    const people = normalise(authorLine(book));
    const inTitle = words.filter((w) => title.includes(w)).length;
    const inPeople = words.filter((w) => !title.includes(w) && people.includes(w)).length;
    let points = ((inTitle + inPeople) / words.length) * 10;
    // Every query word accounted for by the title alone, and little else in the title.
    const titleWords = words.filter((w) => title.includes(w)).reduce((sum, w) => sum + w.length, 0);
    if (title !== "") points += (4.0 * titleWords) / Math.max(title.length, titleWords);
    if (book.coverUrl.trim() !== "") points += 1.0;
    if (book.isbn.trim() !== "") points += 0.5;
    if (book.authors.length > 0) points += 0.5;
    return points;
  };
  return books
    .map((book, index) => ({ book, index, points: score(book) }))
    .sort((a, b) => b.points - a.points || a.index - b.index)
    .map((entry) => entry.book);
}

export class BookLookup {
  private sources: BookSource[];
  private timeoutMs: number;
  private graceMs: number;

  constructor(sources: BookSource[], options: LookupOptions = {}) {
    this.sources = sources;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.graceMs = options.graceMs ?? 3_500;
  }

  async search(query: string, limit = 20, lang = "en", partial = false): Promise<RemoteBook[]> {
    const trimmed = query.trim();
    if (trimmed === "") return [];
    const asked = partial ? this.sources.filter((s) => s.suggests) : this.sources;
    // Suggestions have to feel instant. A search the user asked for may take its time to be complete.
    const grace = partial ? this.graceMs / 2 : this.graceMs * 2;
    const perSource = await this.askAll<RemoteBook[]>(
      asked,
      grace,
      (value) => value === null || value.length === 0,
      (source, signal) => source.search(trimmed, limit, lang, partial, signal),
    );
    return rank(trimmed, merge(perSource.map((list) => list ?? []))).slice(0, limit);
  }

  async byIsbn(isbn: string, lang = "en"): Promise<RemoteBook | null> {
    const answers = await this.askAll<RemoteBook | null>(
      this.sources,
      this.graceMs,
      (value) => value === null,
      (source, signal) => source.byIsbn(isbn, lang, signal),
    );
    const found = answers.filter((book): book is RemoteBook => book !== null);
    if (found.length === 0) return null;
    // The first catalogue that knows the book sets the base, the others fill the gaps.
    const merged = found.slice(1).reduce((acc, other) => fillFrom(acc, other), found[0]);
    return { ...merged, isbn: merged.isbn.trim() === "" ? isbn : merged.isbn };
  }

  private askAll<T>(
    asked: BookSource[],
    grace: number,
    isEmpty: (value: T | null) => boolean,
    block: (source: BookSource, signal: AbortSignal) => Promise<T>,
  ): Promise<(T | null)[]> {
    return new Promise((resolve, reject) => {
      const outcomes: (Outcome<T> | null)[] = asked.map(() => null);
      const controllers = asked.map(() => new AbortController());
      const timers: ReturnType<typeof setTimeout>[] = [];
      let open = asked.length;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        if (deadline) clearTimeout(deadline);
        // Whoever is still on the way is not waited for any longer.
        controllers.forEach((controller) => controller.abort());
        const answered = outcomes.filter((o): o is Outcome<T> => o !== null);
        if (answered.length > 0 && answered.every((o) => !o.ok)) {
          const first = answered.find((o) => !o.ok);
          reject(new CataloguesFailed(first && !first.ok ? first.error : undefined));
          return;
        }
        resolve(outcomes.map((o) => (o && o.ok ? o.value : null)));
      };

      if (open === 0) {
        finish();
        return;
      }

      asked.forEach((source, index) => {
        const settle = (outcome: Outcome<T>) => {
          if (finished || outcomes[index] !== null) return;
          outcomes[index] = outcome;
          open--;
          if (deadline === null && outcome.ok && !isEmpty(outcome.value)) {
            deadline = setTimeout(finish, grace);
          }
          if (open === 0) finish();
        };
        // A timeout of one catalogue must not hold up the others.
        timers.push(
          setTimeout(() => {
            controllers[index].abort();
            settle({ ok: false, error: new Error("timeout") });
          }, this.timeoutMs),
        );
        let call: Promise<T>;
        try {
          call = block(source, controllers[index].signal);
        } catch (error) {
          call = Promise.reject(error);
        }
        call.then(
          (value) => settle({ ok: true, value }),
          (error) => settle({ ok: false, error }),
        );
      });
    });
  }
}
