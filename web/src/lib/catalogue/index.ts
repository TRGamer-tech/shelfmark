// The catalogues the website asks, wired to the network. Used by the route handlers.

import { CoverFinder, networkProbe } from "./coverFinder.ts";
import { googleBooks } from "./googleBooks.ts";
import { networkFetcher } from "./http.ts";
import { dnb, iTunes, k10plus, lobid, swisscovery } from "./libraryCatalogues.ts";
import { BookLookup } from "./lookup.ts";
import { openLibrary } from "./openLibrary.ts";

/**
 * [country] is the two letter code of the reader's country, for the Apple Books store
 * to look in. Empty leaves the choice to Apple.
 */
export function makeLookup(country = ""): BookLookup {
  const http = networkFetcher();
  // Ordered by how much a hit is worth: full records with covers first,
  // then the library catalogues that fill in what those do not know.
  return new BookLookup([
    openLibrary(http),
    googleBooks(http, () => process.env.GOOGLE_BOOKS_API_KEY ?? ""),
    iTunes(http, () => country),
    lobid(http),
    dnb(http),
    k10plus(http),
    swisscovery(http),
  ]);
}

export function makeCoverFinder(country = ""): CoverFinder {
  return new CoverFinder(makeLookup(country), networkProbe);
}

/** "de-CH,de;q=0.9" names Switzerland. Empty when the header names no country. */
export function countryOf(acceptLanguage: string | null): string {
  const match = /^[a-zA-Z]{2,3}-([a-zA-Z]{2})\b/.exec((acceptLanguage ?? "").trim());
  return match ? match[1].toLowerCase() : "";
}

/** Only two letters are passed on to the catalogues, whatever was sent. */
export function cleanLang(lang: string | null): string {
  const match = /^[a-zA-Z]{2}/.exec((lang ?? "").trim());
  return match ? match[0].toLowerCase() : "en";
}
