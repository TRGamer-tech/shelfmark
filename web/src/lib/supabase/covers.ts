// Cover pictures a reader uploads, see "Cover photos" in supabase/README.md. They go
// to the server as plain requests: a picture is the body, and the folder named after the
// account is the only place the server lets that account write to.

import { ServerError } from "../sync.ts";
import type { ServerConfig } from "./config.ts";

export const COVER_BUCKET = "shelfmark-covers";

/** Where a cover of this account lives, for everybody who has the address. */
export function coverAddress(config: ServerConfig, userId: string, file: string): string {
  return `${config.url}/storage/v1/object/public/${COVER_BUCKET}/${userId}/${file}`;
}

/** The file name of a cover that this account uploaded, or null for any other address. */
export function ownCoverFile(config: ServerConfig, userId: string, url: string): string | null {
  const prefix = `${config.url}/storage/v1/object/public/${COVER_BUCKET}/${userId}/`;
  if (!url.startsWith(prefix)) return null;
  const file = url.slice(prefix.length);
  return /^[A-Za-z0-9._-]+$/.test(file) ? file : null;
}

/**
 * Uploads a cover picture and returns its address. The picture goes up as the plain
 * body of the request, below a folder named after the account, which is the only place
 * the server lets an account write to.
 */
export async function uploadCover(config: ServerConfig, token: string, userId: string, picture: Blob): Promise<string> {
  const file = `${crypto.randomUUID()}.jpg`;
  let response: Response;
  try {
    response = await fetch(`${config.url}/storage/v1/object/${COVER_BUCKET}/${userId}/${file}`, {
      method: "POST",
      headers: { apikey: config.key, Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
      body: picture,
    });
  } catch {
    throw new ServerError("network");
  }
  if (!response.ok) throw new ServerError(`http_${response.status}`);
  return coverAddress(config, userId, file);
}

/** Removes a cover this account uploaded earlier. Not being able to is no reason to bother the reader. */
export async function removeCover(config: ServerConfig, token: string, userId: string, file: string): Promise<void> {
  try {
    await fetch(`${config.url}/storage/v1/object/${COVER_BUCKET}/${userId}/${file}`, {
      method: "DELETE",
      headers: { apikey: config.key, Authorization: `Bearer ${token}` },
      // A server that does not answer must not hold up whatever comes next for ever.
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // The picture stays where it is. Nothing points at it any more.
  }
}

/** The files of all covers in these books that this account uploaded, each once. */
export function ownCoverFiles(config: ServerConfig, userId: string, books: readonly { coverUrl: string }[]): string[] {
  const files = new Set<string>();
  for (const book of books) {
    const file = ownCoverFile(config, userId, book.coverUrl);
    if (file) files.add(file);
  }
  return Array.from(files);
}

/**
 * The pictures a save left without a book: files of this account that some book showed
 * before the save and no book shows after it. That is what happens when a book is
 * deleted or gets another cover. A picture another book still uses is not among them.
 */
export function droppedCoverFiles(config: ServerConfig, userId: string, before: readonly { coverUrl: string }[], after: readonly { coverUrl: string }[]): string[] {
  const still = new Set(ownCoverFiles(config, userId, after));
  return ownCoverFiles(config, userId, before).filter((file) => !still.has(file));
}

/** How many names one question about a folder is answered with at most. */
const LIST_PAGE = 100;
/** The most questions that are asked about one folder. Nobody uploads that many covers, and no loop should run for ever. */
const LIST_PAGES = 200;

/**
 * The names of all the pictures in the account's own folder, whether a book still shows
 * them or not. The server answers a page at a time. A server that does not answer, or
 * answers with something else than a list, ends the listing with what was found so far.
 */
export async function listCoverFiles(config: ServerConfig, token: string, userId: string): Promise<string[]> {
  const names: string[] = [];
  for (let page = 0; page < LIST_PAGES; page++) {
    let answer: unknown;
    try {
      const response = await fetch(`${config.url}/storage/v1/object/list/${COVER_BUCKET}`, {
        method: "POST",
        headers: { apikey: config.key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: userId, limit: LIST_PAGE, offset: page * LIST_PAGE }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) break;
      answer = await response.json();
    } catch {
      break;
    }
    if (!Array.isArray(answer)) break;
    for (const entry of answer) {
      const name = typeof entry === "object" && entry !== null ? (entry as { name?: unknown }).name : null;
      // Only what can be a file of this folder: a name that is no path.
      if (typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name)) names.push(name);
    }
    if (answer.length < LIST_PAGE) break;
  }
  return Array.from(new Set(names));
}

/** Removes pictures of this account, a few at a time, so that many of them do not open hundreds of connections at once. */
export async function removeCoverFiles(config: ServerConfig, token: string, userId: string, files: readonly string[]): Promise<void> {
  for (let at = 0; at < files.length; at += 6) {
    await Promise.all(files.slice(at, at + 6).map((file) => removeCover(config, token, userId, file)));
  }
}

/**
 * Removes every picture of an account: all that lie in its folder, also those of books
 * that are long gone, and those its books name. This is done before the account itself
 * is deleted, while there is still somebody who may remove them. A picture that cannot
 * be removed is left behind and nothing is said about it: it must not stop the account
 * from being deleted.
 */
export async function removeAllCovers(config: ServerConfig, token: string, userId: string, books: readonly { coverUrl: string }[]): Promise<void> {
  const listed = await listCoverFiles(config, token, userId);
  // What the books name is removed as well, should the folder not have told of it.
  const files = Array.from(new Set([...listed, ...ownCoverFiles(config, userId, books)]));
  await removeCoverFiles(config, token, userId, files);
}
