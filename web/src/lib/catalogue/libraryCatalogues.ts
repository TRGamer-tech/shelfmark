// Library catalogues and Apple Books (data/remote/LibraryCatalogues.kt).

import * as Isbn from "../isbn.ts";
import type { BookFormat } from "../model.ts";
import type { HttpFetcher } from "./http.ts";
import { enc } from "./http.ts";
import { array, asObject, parseObject, str, strings } from "./json.ts";
import { cleanTitle, parseMarc, personName } from "./marcXml.ts";
import type { RemoteBook } from "./remoteBook.ts";
import { extractYear, remoteBook, searchWords, stripHtml } from "./remoteBook.ts";
import type { BookSource } from "./source.ts";

/**
 * A library catalogue reachable over SRU that answers with MARC records. The catalogues
 * differ only in their address and in how a query is spelled.
 */
function sruCatalogue(name: string, http: HttpFetcher, baseUrl: string, isbnQuery: (isbn: string) => string, wordsQuery: (words: string[]) => string): BookSource {
  const fetchRecords = async (query: string, max: number, wantedIsbn: string | null, signal?: AbortSignal) => {
    const body = await http(`${baseUrl}&query=${enc(query)}&maximumRecords=${max}`, signal);
    return body === null ? [] : parseMarc(body, name, wantedIsbn);
  };
  return {
    name,
    // Union catalogues are thorough but slow, and they only match whole words.
    suggests: false,
    async search(query, limit, _lang, _partial, signal) {
      const words = searchWords(query);
      if (words.length === 0) return [];
      // These catalogues do not sort by relevance, so a few more records are fetched and ranked afterwards.
      return fetchRecords(wordsQuery(words), Math.min(15, Math.max(5, limit)), null, signal);
    },
    async byIsbn(isbn, _lang, signal) {
      return (await fetchRecords(isbnQuery(isbn), 5, isbn, signal))[0] ?? null;
    },
  };
}

/** K10plus: the union catalogue of most German university and state libraries. */
export function k10plus(http: HttpFetcher): BookSource {
  return sruCatalogue(
    "k10plus",
    http,
    "https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&recordSchema=marcxml",
    (isbn) => `pica.isb=${isbn}`,
    // Each word has to be in the title or be a person's name. Searching all fields
    // would also match notes and subjects and bury the book under books about it.
    (words) => words.map((w) => `(pica.tit=${w} or pica.per=${w})`).join(" and "),
  );
}

/** swisscovery: the shared catalogue of Swiss academic libraries. */
export function swisscovery(http: HttpFetcher): BookSource {
  return sruCatalogue(
    "swisscovery",
    http,
    "https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK?version=1.2&operation=searchRetrieve&recordSchema=marcxml",
    (isbn) => `alma.isbn=${isbn}`,
    (words) => words.map((w) => `(alma.title=${w} or alma.creator=${w})`).join(" and ") + " and alma.mms_material_type=BK",
  );
}

/** The German National Library, which receives a copy of everything published in German. */
export function dnb(http: HttpFetcher): BookSource {
  return sruCatalogue(
    "dnb",
    http,
    "https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml",
    (isbn) => `num=${isbn}`,
    (words) => words.map((w) => `(tit=${w} or per=${w})`).join(" and ") + " and mat=books",
  );
}

export function parseLobid(body: string, wantedIsbn: string | null = null): RemoteBook[] {
  const members = array(parseObject(body), "member");
  if (!members) return [];
  const out: RemoteBook[] = [];
  for (const element of members) {
    const m = asObject(element);
    if (!m) continue;
    const title = cleanTitle(str(m, "title") ?? "");
    if (title.trim() === "") continue;
    const publication = asObject(array(m, "publication")?.[0]);
    const isbns = strings(m, "isbn")
      .map((isbn) => Isbn.to13(isbn))
      .filter((isbn): isbn is string => isbn !== null);
    const creators = (array(m, "contribution") ?? [])
      .map(asObject)
      .filter((c) => {
        const role = str(asObject(c?.role), "id") ?? "";
        return role.endsWith("/aut") || role.endsWith("/cre") || role === "";
      })
      .map((c) => str(asObject(c?.agent), "label"))
      .filter((label): label is string => label !== null)
      .map(personName);
    const medium = (array(m, "medium") ?? [])
      .map((item) => str(asObject(item), "label"))
      .filter((label): label is string => label !== null)
      .join(" ")
      .toLowerCase();
    const languageId = str(asObject(array(m, "language")?.[0]), "id") ?? "";
    let format: BookFormat = "UNKNOWN";
    if (medium.includes("audio")) format = "AUDIOBOOK";
    else if (medium.includes("online")) format = "EBOOK";
    out.push(
      remoteBook({
        title,
        subtitle: strings(m, "otherTitleInformation")[0] ?? "",
        authors: Array.from(new Set(creators)),
        isbn: isbns.find((isbn) => isbn === wantedIsbn) ?? isbns[0] ?? "",
        publisher: strings(publication, "publishedBy")[0] ?? "",
        year: extractYear(str(publication, "startDate") ?? ""),
        pageCount: Number(/(\d{1,5})\s*(S\.|Seiten|p\.|pages)/.exec(str(m, "extent") ?? "")?.[1] ?? 0) || 0,
        language: languageId.slice(languageId.lastIndexOf("/") + 1),
        format,
        source: "lobid",
      }),
    );
  }
  return out;
}

/** lobid: the catalogue of the libraries of North Rhine-Westphalia as open data, strong on German titles. */
export function lobid(http: HttpFetcher): BookSource {
  const fetchMembers = async (params: string, signal?: AbortSignal) => {
    const body = await http(`https://lobid.org/resources/search?${params}&format=json`, signal);
    return body === null ? [] : parseLobid(body);
  };
  return {
    name: "lobid",
    suggests: true,
    async search(query, limit, _lang, partial, signal) {
      const words = searchWords(query);
      if (words.length === 0) return [];
      const last = words[words.length - 1];
      const typing = partial && !query.endsWith(" ") && last.length >= 2;
      const q = (typing ? [...words.slice(0, -1), last + "*"] : words).join(" AND ");
      return fetchMembers(`q=${enc(q)}&filter=${enc("type:Book")}&size=${Math.min(12, limit)}`, signal);
    },
    async byIsbn(isbn, _lang, signal) {
      const found = await fetchMembers(`q=${enc(`isbn:${isbn}`)}&size=3`, signal);
      return found.find((book) => book.isbn === isbn) ?? found[0] ?? null;
    },
  };
}

export function parseITunes(body: string): RemoteBook[] {
  const results = array(parseObject(body), "results");
  if (!results) return [];
  const out: RemoteBook[] = [];
  for (const element of results) {
    const r = asObject(element);
    if (!r) continue;
    const title = str(r, "trackName") ?? "";
    if (title.trim() === "") continue;
    out.push(
      remoteBook({
        title,
        authors: (str(r, "artistName") ?? "")
          .split(/ & |, /)
          .map((name) => name.trim())
          .filter((name) => name !== ""),
        year: extractYear((str(r, "releaseDate") ?? "").slice(0, 4)),
        description: stripHtml(str(r, "description") ?? ""),
        // The address carries the picture size, so a larger one is only a matter of asking.
        coverUrl: (str(r, "artworkUrl100") ?? "").replaceAll("100x100bb", "600x600bb"),
        source: "applebooks",
      }),
    );
  }
  return out;
}

/**
 * Apple Books through the public iTunes search. It knows no page counts or print ISBNs,
 * but it has blurbs and large cover pictures for most books that are on sale.
 */
export function iTunes(http: HttpFetcher, country: () => string = () => ""): BookSource {
  const BASE = "https://itunes.apple.com";
  const store = () => {
    const code = country().toLowerCase();
    return /^[a-z]{2}$/.test(code) ? `&country=${code}` : "";
  };
  return {
    name: "applebooks",
    suggests: true,
    async search(query, limit, _lang, _partial, signal) {
      const words = searchWords(query);
      if (words.length === 0) return [];
      const body = await http(`${BASE}/search?term=${enc(words.join(" "))}&media=ebook&limit=${Math.min(15, limit)}${store()}`, signal);
      return body === null ? [] : parseITunes(body);
    },
    async byIsbn(isbn, _lang, signal) {
      const body = await http(`${BASE}/lookup?isbn=${isbn}${store()}`, signal);
      const book = body === null ? null : (parseITunes(body)[0] ?? null);
      return book ? { ...book, isbn } : null;
    },
  };
}
