import type { RemoteBook } from "./remoteBook.ts";

/** One online catalogue. */
export interface BookSource {
  name: string;
  /** False for catalogues that are too slow or too literal to be asked on every keystroke. */
  suggests: boolean;
  /** [partial] is true while the user is still typing, so the last word may be incomplete. */
  search(query: string, limit: number, lang: string, partial: boolean, signal?: AbortSignal): Promise<RemoteBook[]>;
  byIsbn(isbn: string, lang: string, signal?: AbortSignal): Promise<RemoteBook | null>;
}
