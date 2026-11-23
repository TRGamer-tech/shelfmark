// Client for the Google Books volumes API (data/remote/GoogleBooksApi.kt). It works
// without a key, but the keyless quota is shared and often exhausted, so an optional
// key can be supplied.

import * as Isbn from "../isbn.ts";
import type { HttpFetcher } from "./http.ts";
import { enc } from "./http.ts";
import { array, asObject, int, parseObject, str, strings } from "./json.ts";
import type { RemoteBook } from "./remoteBook.ts";
import { extractYear, remoteBook, stripHtml } from "./remoteBook.ts";
import type { BookSource } from "./source.ts";

const BASE = "https://www.googleapis.com/books/v1";
const NAME = "googlebooks";

export function parseVolumes(body: string): RemoteBook[] {
  const items = array(parseObject(body), "items");
  if (!items) return [];
  const out: RemoteBook[] = [];
  for (const element of items) {
    const info = asObject(asObject(element)?.volumeInfo);
    if (!info) continue;
    const title = str(info, "title") ?? "";
    if (title.trim() === "") continue;
    const identifiers = (array(info, "industryIdentifiers") ?? []).map(asObject);
    const isbn13 = str(identifiers.find((i) => str(i, "type") === "ISBN_13") ?? null, "identifier");
    const isbn10 = str(identifiers.find((i) => str(i, "type") === "ISBN_10") ?? null, "identifier");
    const images = asObject(info.imageLinks);
    const picked = isbn13 ?? isbn10;
    out.push(
      remoteBook({
        title,
        subtitle: str(info, "subtitle") ?? "",
        authors: strings(info, "authors"),
        isbn: picked !== null ? (Isbn.to13(picked) ?? "") : "",
        publisher: str(info, "publisher") ?? "",
        year: extractYear(str(info, "publishedDate") ?? ""),
        pageCount: int(info, "pageCount") ?? 0,
        description: stripHtml(str(info, "description") ?? ""),
        coverUrl: (str(images, "thumbnail") ?? str(images, "smallThumbnail") ?? "").replaceAll("http://", "https://").replaceAll("&edge=curl", ""),
        language: str(info, "language") ?? "",
        source: NAME,
      }),
    );
  }
  return out;
}

export function googleBooks(http: HttpFetcher, apiKey: () => string = () => ""): BookSource {
  const url = (params: string) => {
    const key = apiKey().trim();
    return `${BASE}/volumes?${params}` + (key !== "" ? `&key=${enc(key)}` : "");
  };
  return {
    name: NAME,
    suggests: true,
    async search(query, limit, _lang, _partial, signal) {
      const body = await http(url(`q=${enc(query)}&maxResults=${Math.min(40, Math.max(1, limit))}&printType=books`), signal);
      return body === null ? [] : parseVolumes(body);
    },
    async byIsbn(isbn, _lang, signal) {
      const body = await http(url(`q=isbn:${isbn}&maxResults=1`), signal);
      const book = body === null ? null : (parseVolumes(body)[0] ?? null);
      if (!book) return null;
      return book.isbn.trim() === "" ? { ...book, isbn } : book;
    },
  };
}
