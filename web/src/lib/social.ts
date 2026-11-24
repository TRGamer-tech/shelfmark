// Friends: what comes back from the server (ServerSync.take in the app).

import type { Loan } from "./loans.ts";
import { readLoans } from "./loans.ts";
import type { Envelope, SharedLibrary } from "./model.ts";
import { ENVELOPE_VERSION, readEnvelope } from "./model.ts";

export interface ServerFriend {
  id: string;
  name: string;
  /** This friend came by my code: they typed it in, and I was not asked. False for a friend whose code I typed in. */
  joined: boolean;
  /** Since when we are friends, in milliseconds. Zero from a server that does not say. */
  since: number;
}

export interface ServerLibrary {
  owner: string;
  at: number;
  payload: unknown;
}

export interface SyncAnswer {
  id: string;
  code: string;
  name: string;
  time: number;
  friends: ServerFriend[];
  libraries: ServerLibrary[];
  /** Every loan the reader is part of and has not put away, the newest question first. */
  loans: Loan[];
}

export interface FriendLibrary {
  owner: string;
  at: number;
  library: SharedLibrary;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the answer of shelfmark_sync, whatever shape it arrives in. */
export function readSyncAnswer(raw: unknown): SyncAnswer {
  const source = isObject(raw) ? raw : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const number = (value: unknown) => (typeof value === "number" ? value : 0);
  const items = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : []);
  return {
    id: text(source.id),
    code: text(source.code),
    name: text(source.name),
    time: number(source.time),
    friends: items(source.friends).map((f) => ({ id: text(f.id), name: text(f.name), joined: f.joined === true, since: number(f.since) })),
    libraries: items(source.libraries).map((l) => ({ owner: text(l.owner), at: number(l.at), payload: l.payload })),
    // "messages" is a leftover of the mailbox borrow requests used to travel through. It is always empty.
    loans: readLoans(source.loans),
  };
}

function envelopeOf(payload: unknown): Envelope | null {
  const envelope = readEnvelope(payload);
  // A file from a newer version may mean something this website does not understand.
  if (!envelope || envelope.v > ENVELOPE_VERSION) return null;
  return envelope;
}

/** The libraries that really are what the server says: a library counts only for the friend it came from. */
export function acceptLibraries(libraries: ServerLibrary[], me: string): FriendLibrary[] {
  const out: FriendLibrary[] = [];
  for (const entry of libraries) {
    const library = envelopeOf(entry.payload)?.library;
    if (!library) continue;
    if (library.ownerId !== entry.owner || library.ownerId === me) continue;
    out.push({ owner: entry.owner, at: entry.at, library });
  }
  return out;
}

/** "ABCDEFGHJK" reads better as "ABCDE-FGHJK". */
export function displayCode(code: string): string {
  return code.match(/.{1,5}/g)?.join("-") ?? "";
}
