// A book as an online catalogue describes it, before it becomes part of the library
// (data/remote/RemoteBook.kt).

import type { Book, BookFormat } from "../model.ts";
import { newBook } from "../model.ts";

export interface RemoteBook {
  title: string;
  subtitle: string;
  authors: string[];
  isbn: string;
  publisher: string;
  year: string;
  pageCount: number;
  description: string;
  coverUrl: string;
  language: string;
  format: BookFormat;
  source: string;
}

export function remoteBook(fields: Partial<RemoteBook> & { title: string }): RemoteBook {
  return {
    subtitle: "",
    authors: [],
    isbn: "",
    publisher: "",
    year: "",
    pageCount: 0,
    description: "",
    coverUrl: "",
    language: "",
    format: "UNKNOWN",
    source: "",
    ...fields,
  };
}

export function authorLine(book: RemoteBook): string {
  return book.authors.join(", ");
}

export function toBook(book: RemoteBook): Book {
  return newBook({
    title: book.title,
    subtitle: book.subtitle,
    authors: authorLine(book),
    isbn: book.isbn,
    publisher: book.publisher,
    publishedYear: book.year,
    language: book.language,
    pageCount: book.pageCount,
    format: book.format,
    description: book.description,
    coverUrl: book.coverUrl,
  });
}

const blank = (text: string) => text.trim() === "";

/** Fills every blank field of [book] with the value from [other]. */
export function fillFrom(book: RemoteBook, other: RemoteBook): RemoteBook {
  return {
    ...book,
    title: blank(book.title) ? other.title : book.title,
    subtitle: blank(book.subtitle) ? other.subtitle : book.subtitle,
    authors: book.authors.length === 0 ? other.authors : book.authors,
    isbn: blank(book.isbn) ? other.isbn : book.isbn,
    publisher: blank(book.publisher) ? other.publisher : book.publisher,
    year: blank(book.year) ? other.year : book.year,
    pageCount: book.pageCount > 0 ? book.pageCount : other.pageCount,
    description: blank(book.description) ? other.description : book.description,
    coverUrl: blank(book.coverUrl) ? other.coverUrl : book.coverUrl,
    language: blank(book.language) ? other.language : book.language,
    format: book.format !== "UNKNOWN" ? book.format : other.format,
  };
}

export const isLetterOrDigit = (c: string) => /[\p{L}\p{Nd}]/u.test(c);

/** Lower case letters and digits only, for telling whether two records mean the same book. */
export function normalise(text: string): string {
  return Array.from(text.toLowerCase()).filter(isLetterOrDigit).join("");
}

const YEAR_REGEX = /\b(1[0-9]{3}|20[0-9]{2})\b/;

export function extractYear(text: string): string {
  return YEAR_REGEX.exec(text)?.[0] ?? "";
}

/** Maps the free text binding descriptions catalogues use (English and German) to a format. */
export function parseFormat(text: string): BookFormat {
  const t = text.toLowerCase();
  const any = (words: string[]) => words.some((word) => t.includes(word));
  if (t.trim() === "") return "UNKNOWN";
  if (any(["audio", "hörbuch", "hoerbuch", " cd", "mp3"])) return "AUDIOBOOK";
  if (any(["ebook", "e-book", "kindle", "epub", "electronic", "digital"])) return "EBOOK";
  if (any(["hardcover", "hardback", "gebunden", "leinen", "hard cover", "library binding", "pappband", "fester einband", "festeinband", "geb.", "gb.", "pp.", "ln."])) return "HARDCOVER";
  if (any(["paperback", "taschenbuch", "softcover", "broschiert", "kartoniert", "mass market", "pocket", "trade paper", "broschur", "kart.", "brosch", "pbk"])) return "PAPERBACK";
  return "UNKNOWN";
}

/** Blurbs sometimes arrive as HTML. Keeps the paragraphs, drops the markup. */
export function stripHtml(text: string): string {
  if (!text.includes("<") && !text.includes("&")) return text.trim();
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits what the user typed into plain words, dropping everything a query language could trip over. */
export function searchWords(query: string): string[] {
  return Array.from(query)
    .map((c) => (isLetterOrDigit(c) ? c : " "))
    .join("")
    .split(" ")
    .filter((word) => word.trim() !== "");
}
