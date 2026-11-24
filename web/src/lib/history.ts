// The earlier versions of a library that the server keeps, see "Earlier versions" in
// supabase/README.md: up to ten, a few from the last hours and one for each of the last
// days. Only what is listed of them comes here, never the documents themselves.

export interface VaultVersion {
  /** The revision the library had when this version was the current one. */
  revision: number;
  /** When it was saved, in milliseconds. */
  at: number;
  /** How many books it holds. */
  books: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the list as shelfmark_vault_history answers it, the newest first. What is no version is left out. */
export function readVersions(raw: unknown): VaultVersion[] {
  const list = isObject(raw) && Array.isArray(raw.versions) ? raw.versions : [];
  const versions: VaultVersion[] = [];
  for (const entry of list) {
    if (!isObject(entry) || typeof entry.revision !== "number" || !Number.isFinite(entry.revision) || entry.revision <= 0) continue;
    versions.push({
      revision: entry.revision,
      at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0,
      books: typeof entry.books === "number" && entry.books > 0 ? Math.floor(entry.books) : 0,
    });
  }
  return versions.sort((a, b) => b.revision - a.revision);
}

/**
 * Why an earlier version was not brought back, as the name of a text. "unsaved" is the
 * website's own reason: the reader's last changes could not be saved, and bringing a
 * version back over them would lose them without a word.
 */
export function restoreProblemKey(reason: string): string | null {
  switch (reason) {
    case "unsaved":
      return "web_history_unsaved";
    case "unknown_version":
      return "history_gone";
    // A server from before earlier versions were kept has no such function.
    case "setup":
      return "history_unavailable";
    default:
      return null;
  }
}
