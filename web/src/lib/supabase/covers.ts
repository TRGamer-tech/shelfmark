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
 * Removes all the pictures an account uploaded for these books. This is done before
 * the account itself is deleted, while there is still somebody who may remove them.
 * A picture that cannot be removed is left behind and nothing is said about it.
 */
export async function removeCovers(config: ServerConfig, token: string, userId: string, books: readonly { coverUrl: string }[]): Promise<void> {
  const files = ownCoverFiles(config, userId, books);
  // A few at a time, so a large library does not open hundreds of connections at once.
  for (let at = 0; at < files.length; at += 6) {
    await Promise.all(files.slice(at, at + 6).map((file) => removeCover(config, token, userId, file)));
  }
}
