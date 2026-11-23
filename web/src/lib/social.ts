// Friends: what comes back from the server and what it does to the library
// (SocialRepository.import and ServerSync.take in the app).

import type { Envelope, LendRequest, SharedLibrary, Vault } from "./model.ts";
import { ENVELOPE_VERSION, readEnvelope, requestCodec } from "./model.ts";

export interface ServerFriend {
  id: string;
  name: string;
}

export interface ServerLibrary {
  owner: string;
  at: number;
  payload: unknown;
}

export interface ServerMessage {
  id: string;
  from: string;
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
  messages: ServerMessage[];
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
    friends: items(source.friends).map((f) => ({ id: text(f.id), name: text(f.name) })),
    libraries: items(source.libraries).map((l) => ({ owner: text(l.owner), at: number(l.at), payload: l.payload })),
    messages: items(source.messages).map((m) => ({ id: text(m.id), from: text(m.from), at: number(m.at), payload: m.payload })),
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

export interface Imported {
  vault: Vault;
  /** Requests that were not known before, to tell the reader about. */
  newRequests: LendRequest[];
  /** My requests that just got their answer. */
  answered: LendRequest[];
}

/**
 * Takes the waiting messages into the library: a borrow request addressed to me becomes
 * an incoming request (never twice), an answer updates the request I sent. Nobody can
 * ask or answer in somebody else's name, such messages are ignored.
 */
export function importMessages(vault: Vault, messages: ServerMessage[], me: string): Imported {
  let requests = vault.requests;
  const newRequests: LendRequest[] = [];
  const answered: LendRequest[] = [];
  for (const message of messages) {
    const envelope = envelopeOf(message.payload);
    if (!envelope) continue;
    const request = envelope.request;
    const answer = envelope.answer;
    if (request && request.fromId === message.from) {
      if (request.toId !== me) continue;
      // Receiving the same request twice must not reset an answer that was already given.
      if (requests.some((r) => r.id === request.requestId)) continue;
      const incoming: LendRequest = {
        ...requestCodec.read({}),
        id: request.requestId,
        incoming: true,
        bookRemoteId: request.bookId,
        bookTitle: request.bookTitle,
        bookAuthors: request.bookAuthors,
        isbn: request.isbn,
        peerId: request.fromId,
        peerName: request.fromName,
        note: request.note,
        status: "PENDING",
        createdAt: request.createdAt,
        answeredAt: null,
      };
      requests = [...requests, incoming];
      newRequests.push(incoming);
    } else if (answer && answer.fromId === message.from) {
      const mine = requests.find((r) => r.id === answer.requestId && !r.incoming);
      // An answer only counts from the friend the request went to.
      if (!mine || mine.peerId !== message.from) continue;
      const status = answer.accepted ? "ACCEPTED" : "DECLINED";
      if (mine.status === status && mine.answeredAt === answer.answeredAt) continue;
      const updated: LendRequest = { ...mine, status, answeredAt: answer.answeredAt };
      if (mine.status === "PENDING") answered.push(updated);
      requests = requests.map((r) => (r === mine ? updated : r));
    }
  }
  if (requests === vault.requests) return { vault, newRequests, answered };
  return { vault: { ...vault, requests }, newRequests, answered };
}

/** "ABCDEFGHJK" reads better as "ABCDE-FGHJK". */
export function displayCode(code: string): string {
  return code.match(/.{1,5}/g)?.join("-") ?? "";
}
