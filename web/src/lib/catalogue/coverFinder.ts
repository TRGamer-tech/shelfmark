// Collects cover pictures for a book from every place that might have one: what the
// catalogues returned, cover services that answer by ISBN, and a title search
// (data/remote/CoverFinder.kt).

import { USER_AGENT, throughGateway } from "./http.ts";
import type { BookLookup } from "./lookup.ts";
import { normalise } from "./remoteBook.ts";

/** Answers whether an address really serves a picture (and not a "no cover" page). */
export type ImageProbe = (url: string) => Promise<boolean>;

export const networkProbe: ImageProbe = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(throughGateway(url), { headers: { "User-Agent": USER_AGENT }, signal: controller.signal, cache: "no-store" });
    const type = response.headers.get("content-type") ?? "";
    const length = Number(response.headers.get("content-length") ?? NaN);
    await response.body?.cancel().catch(() => undefined);
    // Placeholders for "no cover" are tiny, a real cover is at least a few kilobytes.
    return response.ok && type.startsWith("image") && (Number.isNaN(length) || length > 1_500);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/** Cover services that answer directly by ISBN, and say "not found" honestly when they have none. */
export function isbnAddresses(isbn: string): string[] {
  return [`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, `https://portal.dnb.de/opac/mvb/cover?isbn=${isbn}`];
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export class CoverFinder {
  private lookup: BookLookup;
  private probe: ImageProbe;

  constructor(lookup: BookLookup, probe: ImageProbe) {
    this.lookup = lookup;
    this.probe = probe;
  }

  /** All covers found, best guesses first, without duplicates. */
  async candidates(title: string, authors: string, isbn: string, lang = "en"): Promise<string[]> {
    const byIsbn =
      isbn.trim() === ""
        ? Promise.resolve<string[]>([])
        : Promise.all(
            isbnAddresses(isbn).map(async (url) =>
              (await this.probe(url).catch(() => false)) ? url : null,
            ),
          ).then((urls) => urls.filter((url): url is string => url !== null));
    const fromLookup = isbn.trim() === "" ? Promise.resolve(null) : within(this.lookup.byIsbn(isbn, lang), 10_000).then((book) => book?.coverUrl ?? null);
    const fromSearch = (async () => {
      if (title.trim() === "") return [];
      const query = (title + " " + authors.split(",")[0]).trim();
      const wanted = normalise(title);
      const found = (await within(this.lookup.search(query, 12, lang), 12_000)) ?? [];
      return (
        found
          // Only books that are plausibly the same one, a cover of a different book is worse than none.
          .filter((book) => {
            if (book.coverUrl.trim() === "") return false;
            const t = normalise(book.title);
            return t === wanted || t.startsWith(wanted) || wanted.startsWith(t);
          })
          .map((book) => book.coverUrl)
      );
    })();
    const [a, b, c] = await Promise.all([byIsbn, fromLookup, fromSearch]);
    const all = [...a, ...(b ? [b] : []), ...c].filter((url) => url.trim() !== "");
    return Array.from(new Set(all));
  }

  async best(title: string, authors: string, isbn: string, lang = "en"): Promise<string | null> {
    return (await this.candidates(title, authors, isbn, lang))[0] ?? null;
  }
}
