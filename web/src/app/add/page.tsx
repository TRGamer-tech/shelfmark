"use client";

// Adding a book: search with suggestions while typing, by ISBN, or entirely by hand
// (ui/add/SearchScreen.kt and PreviewSheet.kt). Every book that is found can go straight
// onto the shelf or onto the book cart, to be shelved later with the others.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BookCover } from "@/components/BookCover";
import { ListChoice } from "@/components/BookForm";
import { CartBar, useCart } from "@/components/cart";
import { useI18n } from "@/components/i18n";
import { Icon } from "@/components/icons";
import { formatKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { Button, Dialog, PageHead } from "@/components/ui";
import { chosenWhereFound } from "@/lib/cart";
import type { RemoteBook } from "@/lib/catalogue/remoteBook";
import { authorLine, fillFrom, normalise, remoteBook, toBook } from "@/lib/catalogue/remoteBook";
import { today } from "@/lib/dates";
import { setDraft } from "@/lib/draft";
import { findCovers } from "@/lib/findCovers";
import { newId } from "@/lib/ids";
import * as Isbn from "@/lib/isbn";
import type { Book, ReadingStatus } from "@/lib/model";
import { newBook } from "@/lib/model";
import { addBook, fillCover } from "@/lib/mutations";
import { withDefaultsFor } from "@/lib/rules";

const MIN_CHARS = 3;
const TYPING_PAUSE_MS = 450;

/** Whatever the route sent, as catalogue records. Anything else is left out. */
function recordsOf(items: unknown): RemoteBook[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && typeof (item as { title?: unknown }).title === "string")
    .map((item) => {
      const text = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : "");
      return remoteBook({
        title: text("title"),
        subtitle: text("subtitle"),
        authors: Array.isArray(item.authors) ? item.authors.filter((a): a is string => typeof a === "string") : [],
        isbn: text("isbn"),
        publisher: text("publisher"),
        year: text("year"),
        pageCount: typeof item.pageCount === "number" ? item.pageCount : 0,
        description: text("description"),
        coverUrl: /^https?:\/\//.test(text("coverUrl")) ? text("coverUrl") : "",
        language: text("language"),
        format: (["HARDCOVER", "PAPERBACK", "EBOOK", "AUDIOBOOK", "OTHER"].includes(text("format")) ? text("format") : "UNKNOWN") as RemoteBook["format"],
        source: text("source"),
      });
    });
}

/** The id of the book in the library that a catalogue record means, if it is there already. */
function existingId(record: RemoteBook, library: Book[]): number | null {
  const owned = library.find(
    (book) =>
      (record.isbn.trim() !== "" && book.isbn === record.isbn) ||
      (normalise(book.title) === normalise(record.title) && normalise(book.authors.split(",")[0]) === normalise(record.authors[0] ?? "")),
  );
  return owned ? owned.id : null;
}

/**
 * The one button of a search result that puts the book on the cart, and takes it off
 * again. It says which of the two it is, and with the title of the book, for whoever
 * hears the list button by button.
 */
function CartToggle({ record }: { record: RemoteBook }) {
  const { t } = useI18n();
  const { entryOf, toggle } = useCart();
  const on = entryOf({ title: record.title, authors: authorLine(record), isbn: record.isbn }) !== undefined;
  const label = t(on ? "cart_on" : "cart_put");
  return (
    <button
      type="button"
      className={`result-cart ${on ? "result-cart-on" : ""}`}
      aria-pressed={on}
      aria-label={`${label}: ${record.title}`}
      title={on ? t("cart_take_off") : label}
      onClick={() => toggle(toBook(record))}
      data-testid="cart-toggle"
    >
      <Icon name={on ? "check" : "cart"} size={20} />
      <span className="result-cart-label">{label}</span>
    </button>
  );
}

function useMetaLine(): (book: RemoteBook) => string {
  const { t } = useI18n();
  // "2014 · 320 p. · Paperback", leaving out what is unknown.
  return (book) =>
    [book.year, book.pageCount > 0 ? t("pages_short", book.pageCount) : "", book.format !== "UNKNOWN" ? t(formatKey(book.format)) : "", book.language.toUpperCase(), book.publisher]
      .filter((part) => part.trim() !== "")
      .join(" · ");
}

export default function AddPage() {
  const { t, lang } = useI18n();
  const { vault, mutate } = useLibrary();
  const { entryOf, put, takeOff } = useCart();
  const router = useRouter();
  const metaLine = useMetaLine();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RemoteBook[]>([]);
  const [loading, setLoading] = useState(false);
  /** True while the list holds quick suggestions for a half-typed query. */
  const [suggestions, setSuggestions] = useState(false);
  const [failed, setFailed] = useState(false);
  /** True once a search has finished, so "nothing found" is only said after really looking. */
  const [searched, setSearched] = useState(false);
  const [preview, setPreview] = useState<RemoteBook | null>(null);
  const [status, setStatus] = useState<ReadingStatus>("NONE");
  const [listIds, setListIds] = useState<number[]>([]);
  const running = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    running.current?.abort();
    running.current = null;
  };
  useEffect(() => stop, []);

  const run = async (text: string, partial: boolean, limit: number) => {
    stop();
    const controller = new AbortController();
    running.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const isbn = Isbn.to13(text);
      let found: RemoteBook[];
      if (isbn) {
        const response = await fetch(`/api/books/isbn/${isbn}?lang=${lang}`, { signal: controller.signal });
        if (response.status !== 404 && !response.ok) throw new Error("lookup failed");
        found = response.ok ? recordsOf([((await response.json()) as { book?: unknown }).book]) : [];
      } else {
        const params = new URLSearchParams({ q: text, lang, limit: String(limit) });
        if (partial) params.set("partial", "1");
        const response = await fetch(`/api/books/search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("search failed");
        found = recordsOf(((await response.json()) as { results?: unknown }).results);
      }
      if (controller.signal.aborted) return;
      setResults(found);
      setSuggestions(partial && !isbn);
      setSearched(true);
      setLoading(false);
    } catch {
      // A search that was overtaken by the next keystroke is not a failure.
      if (controller.signal.aborted) return;
      setLoading(false);
      setFailed(true);
      setSearched(true);
    }
  };

  /** Called on every keystroke: after a short pause the catalogues are asked for suggestions. */
  const onQueryChange = (text: string) => {
    setQuery(text);
    setFailed(false);
    stop();
    if (text.trim().length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    timer.current = window.setTimeout(() => void run(text.trim(), true, 8), TYPING_PAUSE_MS);
  };

  /** The full search, when the reader asks for it. */
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (query.trim() === "") return;
    void run(query.trim(), false, 30);
  };

  /** Opens the preview and quietly fetches the blurb and binding the result list did not carry. */
  const open = (book: RemoteBook) => {
    setPreview(book);
    setStatus("NONE");
    setListIds([]);
    if (book.isbn.trim() === "" || book.description.trim() !== "") return;
    fetch(`/api/books/isbn/${book.isbn}?lang=${lang}`, { signal: AbortSignal.timeout(8000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: { book?: unknown } | null) => {
        const detail = recordsOf([answer?.book])[0];
        if (!detail) return;
        // The title and authors the reader picked stay, only the gaps are filled.
        setPreview((current) => (current && current.isbn === book.isbn ? fillFrom(current, { ...detail, coverUrl: "" }) : current));
      })
      .catch(() => undefined);
  };

  const add = (record: RemoteBook) => {
    const now = Date.now();
    const id = newId(now);
    const book = withDefaultsFor({ ...toBook(record), id }, status, today());
    void mutate(addBook(book, listIds, now));
    if (book.coverUrl.trim() === "") {
      void findCovers(book.title, book.authors, book.isbn, lang).then((found) => {
        if (found[0]) void mutate(fillCover(id, found[0], Date.now()));
      });
    }
    setPreview(null);
    router.push(`/book?id=${id}`);
  };

  // What was chosen in the preview is the book's own on the cart. Left alone, it goes with the rest.
  const toCart = (record: RemoteBook) => {
    put(toBook(record), chosenWhereFound(status, listIds));
    setPreview(null);
  };

  const manual = (book: Book) => {
    setDraft(book);
    router.push("/add/manual");
  };

  const previewExisting = preview ? existingId(preview, vault.books) : null;
  const previewCarted = preview ? entryOf({ title: preview.title, authors: authorLine(preview), isbn: preview.isbn }) : undefined;

  return (
    <div className="page" data-testid="add-page">
      <PageHead title={t("add_book")} back="/" />
      <form className="row" onSubmit={submit} role="search" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label htmlFor="book-search">{t("add_search_hint")}</label>
          <input id="book-search" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("search_hint")} autoFocus autoComplete="off" data-testid="search-field" />
        </div>
        <Button type="submit" icon="search" disabled={query.trim() === ""} data-testid="search-submit">
          {t("web_add_search")}
        </Button>
      </form>
      <div style={{ height: 4, margin: "8px 0" }}>{loading ? <div className="busy-line" role="status" aria-label={t("server_syncing")} /> : null}</div>

      <div data-testid="search-results" aria-live="polite">
        {results.length > 0 ? (
          <div className="row-between">
            <p className="label-small" data-testid="results-heading">
              {t(suggestions ? "search_suggestions" : "search_results")}
            </p>
            {suggestions ? (
              <Button variant="text" onClick={() => submit()} data-testid="show-all">
                {t("search_show_all")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {results.map((book, index) => (
          <div key={`${index}-${book.title}-${book.isbn}`} className="result-row" data-testid="result-row">
            <button type="button" className="result" onClick={() => open(book)} data-testid="search-result">
              {/* Result lists load the medium sized cover, the large one is kept for the library. */}
              <BookCover title={book.title} authors={authorLine(book)} url={book.coverUrl !== "" ? book.coverUrl.replace("-L.jpg", "-M.jpg") : null} tiny />
              <span className="grow">
                <span className="book-row-title">{book.title}</span>
                {book.authors.length > 0 ? <span className="book-row-authors">{authorLine(book)}</span> : null}
                {metaLine(book) !== "" ? <span className="small muted book-row-authors">{metaLine(book)}</span> : null}
                {existingId(book, vault.books) !== null ? (
                  <span className="status-word" data-testid="already-owned">
                    {t("add_already_in_library")}
                  </span>
                ) : null}
              </span>
            </button>
            <CartToggle record={book} />
          </div>
        ))}
      </div>

      <div className="stack" style={{ alignItems: "center", padding: 24, textAlign: "center" }}>
        {failed ? (
          <p className="problem" role="alert" data-testid="search-failed">
            {t("search_failed")}
          </p>
        ) : searched && results.length === 0 && !loading ? (
          <p data-testid="search-nothing">{t("search_nothing")}</p>
        ) : results.length === 0 && !loading ? (
          <p className="muted">{t("search_intro")}</p>
        ) : null}
        {/* Old editions without a catalogue entry can always be typed in. */}
        <Button
          variant="outline"
          onClick={() => manual(newBook({ title: Isbn.to13(query) === null ? query.trim() : "", isbn: Isbn.to13(query) ?? "" }))}
          data-testid="manual-entry"
        >
          {t("search_manual")}
        </Button>
      </div>

      <CartBar />

      {preview ? (
        <Dialog
          title={t(previewExisting !== null ? "add_already_in_library" : "add_book")}
          onClose={() => setPreview(null)}
          wide
          testId="preview"
          actions={
            previewExisting !== null ? (
              <Button onClick={() => router.push(`/book?id=${previewExisting}`)} data-testid="open-existing">
                {t("add_open_existing")}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => manual(toBook(preview))} data-testid="edit-first">
                  {t("add_edit_first")}
                </Button>
                {previewCarted ? (
                  <Button
                    variant="outline"
                    icon="check"
                    onClick={() => {
                      takeOff(previewCarted.key);
                      setPreview(null);
                    }}
                    data-testid="preview-cart"
                  >
                    {t("cart_take_off")}
                  </Button>
                ) : (
                  <Button variant="tonal" icon="cart" onClick={() => toCart(preview)} data-testid="preview-cart">
                    {t("cart_put")}
                  </Button>
                )}
                <Button onClick={() => add(preview)} data-testid="confirm-add">
                  {t("add_confirm")}
                </Button>
              </>
            )
          }
        >
          <div className="preview-head">
            <BookCover title={preview.title} authors={authorLine(preview)} url={preview.coverUrl !== "" ? preview.coverUrl : null} />
            <div>
              <h3 style={{ fontSize: "1.3rem" }} data-testid="preview-title">
                {preview.title}
              </h3>
              {preview.subtitle.trim() !== "" ? <p className="muted">{preview.subtitle}</p> : null}
              {preview.authors.length > 0 ? <p className="book-author">{authorLine(preview)}</p> : null}
              <p className="small muted" style={{ marginTop: 6 }}>
                {metaLine(preview)}
              </p>
              {preview.isbn.trim() !== "" ? <p className="small muted">ISBN {preview.isbn}</p> : null}
            </div>
          </div>
          {preview.description.trim() !== "" ? <p className="blurb blurb-clamped">{preview.description}</p> : null}
          {previewExisting === null ? <ListChoice status={status} onStatus={setStatus} listIds={listIds} onLists={setListIds} /> : null}
        </Dialog>
      ) : null}
    </div>
  );
}
