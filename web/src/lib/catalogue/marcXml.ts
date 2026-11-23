// Reads MARC 21 records out of an SRU response, the format library catalogues answer
// in (data/remote/MarcXml.kt). Works for any catalogue: element prefixes and attribute
// order do not matter.

import * as Isbn from "../isbn.ts";
import type { BookFormat } from "../model.ts";
import type { RemoteBook } from "./remoteBook.ts";
import { extractYear, parseFormat, remoteBook } from "./remoteBook.ts";
import type { XmlElement } from "./xml.ts";
import { descendants, parseXml } from "./xml.ts";

const PAGES = /(\d{1,5})\s*(S\.|Seiten|Seite|p\.|pages|pp\.|Bl\.|S$)/;
const FIRST_NUMBER = /\d{2,5}/;

function trimEnd(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

/** "Schlink, Bernhard" as catalogues file it becomes "Bernhard Schlink". */
export function personName(filed: string): string {
  const name = trimEnd(filed.trim(), ",.").trim();
  const comma = name.indexOf(",");
  if (comma < 0) return name;
  return (name.slice(comma + 1).trim() + " " + name.slice(0, comma).trim()).trim();
}

/** Drops the marks around a leading article and the punctuation MARC puts before the next subfield. */
export function cleanTitle(raw: string): string {
  const cleaned = raw.replaceAll("<<", "").replaceAll(">>", "").replaceAll("\u0098", "").replaceAll("\u009C", "").replaceAll("¬", "");
  return trimEnd(cleaned.trim(), "/:;=").trim();
}

const subs = (field: XmlElement, code: string) => field.children.filter((c) => c.name === "subfield" && c.attributes.code === code).map((c) => c.text.trim());
const sub = (field: XmlElement | undefined, code: string) => (field ? (subs(field, code)[0] ?? "") : "");

function toBook(record: XmlElement, source: string, wantedIsbn: string | null): RemoteBook | null {
  const leader = record.children.find((c) => c.name === "leader")?.text ?? "";
  // Position 6 is the kind of material: a and t are text, i is a spoken recording.
  const kind = leader.length > 6 ? leader[6] : "a";
  if (kind !== "a" && kind !== "t" && kind !== "i") return null;
  const fields = record.children.filter((c) => c.name === "datafield");
  const field = (tag: string) => fields.find((f) => f.attributes.tag === tag);
  const all = (tag: string) => fields.filter((f) => f.attributes.tag === tag);

  const titleField = field("245");
  if (!titleField) return null;
  const title = cleanTitle(sub(titleField, "a"));
  if (title.trim() === "") return null;

  const isbns = all("020")
    .flatMap((f) => [...subs(f, "a"), ...subs(f, "9")])
    .map((text) => Isbn.to13(text.split(" ")[0]))
    .filter((isbn): isbn is string => isbn !== null);
  const binding = all("020")
    .flatMap((f) => [...subs(f, "q"), ...subs(f, "c")])
    .join(" ");
  const carrier = all("338")
    .map((f) => sub(f, "b") + " " + sub(f, "a"))
    .join(" ");
  const imprint = fields.find((f) => f.attributes.tag === "264" && f.attributes.ind2 === "1") ?? field("264") ?? field("260");
  const control008 = record.children.find((c) => c.name === "controlfield" && c.attributes.tag === "008")?.text ?? "";
  const extent = sub(field("300"), "a");

  const filed: string[] = [];
  const main = field("100");
  if (main) filed.push(sub(main, "a"));
  for (const f of all("700")) if (subs(f, "4").some((role) => role === "aut" || role === "cre")) filed.push(sub(f, "a"));
  const creators = Array.from(new Set(filed.map(personName).filter((name) => name.trim() !== "")));

  const languageCode = control008.slice(35, 38).trim();
  const year = extractYear(sub(imprint, "c"));
  let format: BookFormat;
  if (kind === "i") format = "AUDIOBOOK";
  else if (carrier.includes("cr") || carrier.toLowerCase().includes("online")) format = "EBOOK";
  else format = parseFormat(binding);

  return remoteBook({
    title,
    subtitle: cleanTitle(sub(titleField, "b")),
    authors: creators,
    isbn: isbns.find((isbn) => isbn === wantedIsbn) ?? isbns[0] ?? "",
    publisher: trimEnd(sub(imprint, "b").trim(), ",;:").trim(),
    year: year !== "" ? year : extractYear(control008.slice(7, 11)),
    pageCount: Number(PAGES.exec(extent)?.[1] ?? FIRST_NUMBER.exec(extent)?.[0] ?? 0) || 0,
    description: sub(field("520"), "a").trim(),
    language: sub(field("041"), "a") !== "" ? sub(field("041"), "a") : /^\p{L}{3}$/u.test(languageCode) ? languageCode : "",
    format,
    source,
  });
}

export function parseMarc(xml: string, source: string, wantedIsbn: string | null = null): RemoteBook[] {
  const document = parseXml(xml);
  if (!document) return [];
  const records = descendants(document).filter((e) => e.name === "record" && e.children.some((child) => child.name === "datafield"));
  const books = records.map((record) => toBook(record, source, wantedIsbn)).filter((book): book is RemoteBook => book !== null);
  if (wantedIsbn === null) return books;
  // A search by ISBN can also return other editions that merely mention the number.
  return [...books.filter((b) => b.isbn === wantedIsbn), ...books.filter((b) => b.isbn !== wantedIsbn)];
}
