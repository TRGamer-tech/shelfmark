// Asking the site's own server for cover pictures of a book (/api/books/covers).

/** The covers the catalogues have for a book, best first. An empty list when there are none or the search failed. */
export async function findCovers(title: string, authors: string, isbn: string, lang: string): Promise<string[]> {
  try {
    const query = new URLSearchParams({ title, authors, isbn, lang });
    const response = await fetch(`/api/books/covers?${query}`);
    if (!response.ok) return [];
    const answer = (await response.json()) as { covers?: unknown };
    return Array.isArray(answer.covers) ? answer.covers.filter((c): c is string => typeof c === "string" && /^https?:\/\//.test(c)) : [];
  } catch {
    return [];
  }
}
