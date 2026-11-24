import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Book, Goal, Purchase, ReadingSession } from "../src/lib/model.ts";
import { bookCodec, goalCodec, purchaseCodec, sessionCodec } from "../src/lib/model.ts";
import { toEpochDay } from "../src/lib/dates.ts";

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

export function sample(name: string): string {
  return fixture(`samples/${name}`);
}

/** A file from before the loans: a vault that still carries borrow requests, or a request sent as a file. */
export function old(name: string): string {
  return fixture(`old/${name}`);
}

/** A book with every field at its default, except what is given. */
export function book(fields: Partial<Book> & { title: string }): Book {
  return { ...bookCodec.read({ title: fields.title }), ...fields };
}

export function session(fields: Partial<ReadingSession> & { bookId: number }): ReadingSession {
  return { ...sessionCodec.read({ bookId: fields.bookId }), ...fields };
}

export function goal(fields: Partial<Goal> & { target: number }): Goal {
  return { ...goalCodec.read({ target: fields.target, startDay: 0, endDay: 0 }), ...fields };
}

export function purchase(fields: Partial<Purchase> & { bookId: number; day: number }): Purchase {
  return { ...purchaseCodec.read({ bookId: fields.bookId, day: fields.day }), ...fields };
}

/** "2026-03-10" as an epoch day. */
export function day(text: string): number {
  const [y, m, d] = text.split("-").map(Number);
  return toEpochDay(y, m, d);
}

/** A moment on that date at the given hour, in UTC. */
export function at(date: string, hour = 20): number {
  return day(date) * 86_400_000 + hour * 3_600_000;
}
