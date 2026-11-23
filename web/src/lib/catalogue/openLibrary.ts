// Client for openlibrary.org, a free catalogue that needs no key (data/remote/OpenLibraryApi.kt).

import * as Isbn from "../isbn.ts";
import type { HttpFetcher } from "./http.ts";
import { enc } from "./http.ts";
import type { Json } from "./json.ts";
import { array, asObject, int, parseObject, str, strings, textValue } from "./json.ts";
import type { RemoteBook } from "./remoteBook.ts";
import { extractYear, fillFrom, isLetterOrDigit, parseFormat, remoteBook } from "./remoteBook.ts";
import type { BookSource } from "./source.ts";

const BASE = "https://openlibrary.org";
const COVERS = "https://covers.openlibrary.org";
const SEARCH_FIELDS =
  "key,title,subtitle,author_name,first_publish_year,cover_i,number_of_pages_median," +
  "editions,editions.key,editions.title,editions.subtitle,editions.isbn,editions.language," +
  "editions.cover_i,editions.publisher,editions.publish_date";
const NAME = "openlibrary";

/**
 * Open Library matches whole words only. While the user is typing, the last word gets a
 * trailing wildcard so "der vorl" already finds "Der Vorleser". Characters that have a
 * meaning in the search syntax are dropped.
 */
export function buildQuery(query: string, partial: boolean): string {
  const words = Array.from(query)
    .map((c) => (isLetterOrDigit(c) || c === "'" ? c : " "))
    .join("")
    .split(" ")
    .filter((word) => word.trim() !== "");
  if (words.length === 0) return "";
  const last = words[words.length - 1];
  const typing = partial && !query.endsWith(" ") && last.length >= 2;
  return typing ? [...words.slice(0, -1), last + "*"].join(" ") : words.join(" ");
}

function pickIsbn(candidates: string[]): string {
  const valid = candidates.find((c) => Isbn.isValid13(Isbn.clean(c)));
  if (valid) return Isbn.clean(valid);
  for (const candidate of candidates) {
    const converted = Isbn.to13(candidate);
    if (converted) return converted;
  }
  return "";
}

export function parseSearch(body: string): RemoteBook[] {
  const docs = array(parseObject(body), "docs");
  if (!docs) return [];
  const out: RemoteBook[] = [];
  for (const element of docs) {
    const work = asObject(element);
    if (!work) continue;
    // With "lang" set, Open Library attaches the best matching edition of each work.
    const edition = asObject(array(asObject(work.editions), "docs")?.[0]);
    const title = (str(edition, "title") ?? "").trim() !== "" ? (str(edition, "title") as string) : (str(work, "title") ?? "");
    if (title.trim() === "") continue;
    const coverId = int(edition, "cover_i") ?? int(work, "cover_i");
    const editionYear = extractYear(strings(edition, "publish_date")[0] ?? "");
    out.push(
      remoteBook({
        title,
        subtitle: (str(edition, "subtitle") ?? "").trim() !== "" ? (str(edition, "subtitle") as string) : (str(work, "subtitle") ?? ""),
        authors: strings(work, "author_name"),
        isbn: pickIsbn(strings(edition, "isbn")),
        publisher: strings(edition, "publisher")[0] ?? "",
        year: editionYear !== "" ? editionYear : (int(work, "first_publish_year")?.toString() ?? ""),
        pageCount: int(work, "number_of_pages_median") ?? 0,
        coverUrl: coverId !== null ? `${COVERS}/b/id/${coverId}-L.jpg` : "",
        language: strings(edition, "language")[0] ?? "",
        source: NAME,
      }),
    );
  }
  return out;
}

export function parseData(body: string, isbn: string): RemoteBook | null {
  const root = parseObject(body);
  if (!root) return null;
  const entry = asObject(Object.values(root)[0]);
  if (!entry) return null;
  const title = str(entry, "title") ?? "";
  if (title.trim() === "") return null;
  const cover = asObject(entry.cover);
  return remoteBook({
    title,
    subtitle: str(entry, "subtitle") ?? "",
    authors: (array(entry, "authors") ?? []).map((a) => str(asObject(a), "name")).filter((name): name is string => name !== null),
    isbn,
    publisher: str(asObject(array(entry, "publishers")?.[0]), "name") ?? "",
    year: extractYear(str(entry, "publish_date") ?? ""),
    pageCount: int(entry, "number_of_pages") ?? 0,
    coverUrl: str(cover, "large") ?? str(cover, "medium") ?? "",
    source: NAME,
  });
}

export function parseEdition(edition: Json, isbn: string): RemoteBook | null {
  const title = str(edition, "title") ?? "";
  if (title.trim() === "") return null;
  const firstCover = array(edition, "covers")?.[0];
  const coverId = typeof firstCover === "number" && Number.isInteger(firstCover) && firstCover > 0 ? firstCover : null;
  const languageKey = str(asObject(array(edition, "languages")?.[0]), "key") ?? "";
  return remoteBook({
    title,
    subtitle: str(edition, "subtitle") ?? "",
    isbn,
    publisher: strings(edition, "publishers")[0] ?? "",
    year: extractYear(str(edition, "publish_date") ?? ""),
    pageCount: int(edition, "number_of_pages") ?? 0,
    description: textValue(edition.description),
    coverUrl: coverId !== null ? `${COVERS}/b/id/${coverId}-L.jpg` : "",
    language: languageKey.slice(languageKey.lastIndexOf("/") + 1),
    format: parseFormat(str(edition, "physical_format") ?? ""),
    source: NAME,
  });
}

/**
 * For the parts of an answer that are nice to have: null when the request fails, and also
 * when it takes too long, so that a slow extra does not cost the record that is already there.
 */
function optional(request: Promise<string | null>, ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    request.then(
      (body) => {
        clearTimeout(timer);
        resolve(body);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export function openLibrary(http: HttpFetcher, extrasMs = 6_000): BookSource {
  return {
    name: NAME,
    suggests: true,
    async search(query, limit, lang, partial, signal) {
      const q = buildQuery(query, partial);
      if (q === "") return [];
      const body = await http(`${BASE}/search.json?q=${enc(q)}&limit=${limit}&lang=${enc(lang)}&fields=${SEARCH_FIELDS}`, signal);
      return body === null ? [] : parseSearch(body);
    },
    async byIsbn(isbn, _lang, signal) {
      // Two views of the same edition: "data" has author names and cover links,
      // the raw edition record has binding, language and the link to the work.
      const dataCall = http(`${BASE}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, signal);
      const editionCall = optional(http(`${BASE}/isbn/${isbn}.json`, signal), extrasMs);
      const [data, editionBody] = await Promise.all([dataCall, editionCall]);
      const fromData = data !== null ? parseData(data, isbn) : null;
      const edition = editionBody !== null ? parseObject(editionBody) : null;
      const fromEdition = edition ? parseEdition(edition, isbn) : null;
      let book = fromData && fromEdition ? fillFrom(fromData, fromEdition) : (fromData ?? fromEdition);
      if (!book) return null;
      if (book.description.trim() === "") {
        const workKey = str(asObject(array(edition, "works")?.[0]), "key");
        if (workKey && workKey.trim() !== "") {
          const workBody = await optional(http(`${BASE}${workKey}.json`, signal), extrasMs);
          const work = workBody !== null ? parseObject(workBody) : null;
          book = { ...book, description: textValue(work?.description) };
        }
      }
      return book;
    },
  };
}
