"use client";

// The shelf: the home of the site, as LibraryScreen in the app.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookCover } from "@/components/BookCover";
import { Icon } from "@/components/icons";
import { useI18n } from "@/components/i18n";
import { sortKeyOf, statusKey, viewKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { OrnamentDialog } from "@/components/OrnamentDialog";
import { OrnamentView } from "@/components/Ornaments";
import { RatingBar } from "@/components/Ratings";
import type { ShelfItem, ShelfSection } from "@/components/Shelves";
import { CoverShelf, ShelfBoard, SpineShelf } from "@/components/Shelves";
import { Chip, IconButton, IconLink, ProgressBar } from "@/components/ui";
import type { LibraryFilter } from "@/lib/libraryLogic";
import { STATUS_ORDER, applyFilter } from "@/lib/libraryLogic";
import type { Book, ReadingStatus, SortOrder, ViewMode } from "@/lib/model";
import { awayOf, awayWords } from "@/lib/away";
import { READING_STATUSES, SORT_ORDERS, VIEW_MODES } from "@/lib/model";
import { setPrefs } from "@/lib/mutations";
import { progressOf } from "@/lib/rules";
import { coverAddressOf } from "@/lib/shelf";

function filterOf(params: URLSearchParams): LibraryFilter {
  const status = params.get("status");
  if (status && (READING_STATUSES as string[]).includes(status)) return { kind: "status", status: status as ReadingStatus };
  const list = Number(params.get("list"));
  if (params.get("list") && Number.isFinite(list)) return { kind: "shelf", shelfId: list };
  if (params.get("show") === "lent") return { kind: "lent" };
  if (params.get("show") === "borrowed") return { kind: "borrowed" };
  return { kind: "all" };
}

function hrefOf(filter: LibraryFilter): string {
  switch (filter.kind) {
    case "status":
      return `/?status=${filter.status}`;
    case "shelf":
      return `/?list=${filter.shelfId}`;
    case "lent":
      return "/?show=lent";
    case "borrowed":
      return "/?show=borrowed";
    default:
      return "/";
  }
}

const sameFilter = (a: LibraryFilter, b: LibraryFilter) => JSON.stringify(a) === JSON.stringify(b);

/** Sixteen specks of dust drifting through the lamplight. They are only drawn, clicks go through. */
function DustMotes() {
  const motes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const seed = i * 0.618034;
        return {
          left: `${((seed * 7.13) % 1) * 100}%`,
          top: `${40 + ((seed * 3.71) % 1) * 60}%`,
          size: 2 + (i % 3),
          duration: `${38 + ((seed * 5.3) % 1) * 40}s`,
          delay: `${-((seed * 11.7) % 1) * 60}s`,
          opacity: 0.16 + (i % 5) * 0.045,
        };
      }),
    [],
  );
  return (
    <div className="dust" aria-hidden="true">
      {motes.map((mote, i) => (
        <span key={i} className="mote" style={{ left: mote.left, top: mote.top, width: mote.size, height: mote.size, "--t": mote.duration, "--d": mote.delay, "--o": mote.opacity } as React.CSSProperties} />
      ))}
    </div>
  );
}

/** The words for a book that is away, "Lent to Bo", or null for a book that is here. */
function useAwayWords(): (book: Book) => string | null {
  const { t } = useI18n();
  return (book) => {
    const away = awayOf(book);
    if (!away) return null;
    const words = awayWords(away, t("friends_someone"));
    return t(words.key, words.who);
  };
}

function BookRow({ book }: { book: Book }) {
  const { t } = useI18n();
  const away = useAwayWords()(book);
  const progress = book.status === "READING" ? progressOf(book) : null;
  return (
    <Link href={`/book?id=${book.id}`} className={away ? "book-row away" : "book-row"} data-testid="book-row" data-away={away ?? undefined}>
      <BookCover title={book.title} authors={book.authors} url={coverAddressOf(book)} tiny />
      <span className="book-row-text">
        <span className="book-row-title">{book.title}</span>
        {book.authors.trim() !== "" ? <span className="book-row-authors">{book.authors}</span> : null}
        {/* Only the cover is see-through. What is written stays as readable as on any other row. */}
        {away ? (
          <span className="away-words" data-testid="away-words">
            {away}
          </span>
        ) : null}
        <span className="row" style={{ marginTop: 4 }}>
          <span className="status-word">{t(statusKey(book.status))}</span>
          {book.rating > 0 ? <RatingBar rating={book.rating} size={14} /> : null}
        </span>
        {progress !== null ? (
          <span style={{ display: "block", marginTop: 6 }}>
            <ProgressBar value={progress} label={t("book_section_progress")} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function ShelfPage() {
  const { t, plural } = useI18n();
  const { vault, prefs, mutate } = useLibrary();
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [decorating, setDecorating] = useState<{ key: string; title: string; count: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hour = useMemo(() => new Date().getHours(), []);

  const requested = filterOf(new URLSearchParams(params.toString()));
  // A list that was deleted while selected falls back to everything.
  const filter: LibraryFilter = requested.kind === "shelf" && !vault.shelves.some((s) => s.id === requested.shelfId) ? { kind: "all" } : requested;
  const setFilter = (next: LibraryFilter) => router.push(hrefOf(next), { scroll: false });

  const viewMode: ViewMode = (VIEW_MODES as string[]).includes(prefs.viewMode) ? prefs.viewMode : "COVERS";
  const sort: SortOrder = prefs.sort;
  const visible = useMemo(() => applyFilter(vault.books, vault.links, filter, query, sort), [vault.books, vault.links, filter, query, sort]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const awayText = useAwayWords();
  const item = (book: Book): ShelfItem => ({
    key: book.id,
    away: awayText(book),
    title: book.title,
    authors: book.authors,
    cover: coverAddressOf(book),
    pageCount: book.pageCount,
    format: book.format,
    ribbon: book.lentTo.trim() !== "" ? "var(--spice)" : book.status === "READING" ? "var(--secondary)" : null,
    href: `/book?id=${book.id}`,
  });

  // With no filter the bookcase has a shelf per list, like sorting books by where they stand in life.
  const grouped = filter.kind === "all" && query.trim() === "";
  const section = (key: string, title: string, books: Book[], emptyHint: string | null, onOpen: (() => void) | null): ShelfSection => ({
    key,
    items: books.map(item),
    title,
    onOpen,
    ornaments: vault.ornaments.filter((o) => o.shelfKey === key).map((o) => ({ position: o.position, kind: o.kind })),
    onDecorate: () => setDecorating({ key, title, count: books.length }),
    emptyHint,
  });
  let sections: ShelfSection[];
  if (grouped) {
    sections = [];
    for (const status of STATUS_ORDER) {
      const books = visible.filter((b) => b.status === status);
      if (books.length > 0) sections.push(section(status, t(statusKey(status)), books, null, () => setFilter({ kind: "status", status })));
    }
    // Lists of one's own are shelves of their own, below the built-in ones.
    // A book that is on a list stands there as well as on the shelf of its state.
    for (const shelf of vault.shelves) {
      const ids = new Set(vault.links.filter((l) => l.shelfId === shelf.id).map((l) => l.bookId));
      sections.push(
        section(
          `list_${shelf.id}`,
          shelf.name,
          visible.filter((b) => ids.has(b.id)),
          t("list_empty_shelf"),
          () => setFilter({ kind: "shelf", shelfId: shelf.id }),
        ),
      );
    }
  } else if (filter.kind === "status" && query.trim() === "") {
    // A single list keeps its heading, so it can be decorated too.
    sections = [section(filter.status, t(statusKey(filter.status)), visible, null, null)];
  } else if (filter.kind === "shelf" && query.trim() === "") {
    sections = [section(`list_${filter.shelfId}`, vault.shelves.find((s) => s.id === filter.shelfId)?.name ?? "", visible, t("list_empty_shelf"), null)];
  } else {
    sections = [{ key: "all", items: visible.map(item) }];
  }

  // The book that was last read in, to pick up where one left off.
  const current = vault.books.filter((b) => b.status === "READING").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const name = prefs.profileName.trim();
  const time = hour >= 5 && hour <= 10 ? "morning" : hour >= 11 && hour <= 17 ? "day" : hour >= 18 && hour <= 22 ? "evening" : "night";
  const greeting = name === "" ? t(`greeting_${time}`) : t(`greeting_${time}_name`, name);

  const count = (f: LibraryFilter) => {
    switch (f.kind) {
      case "all":
        return vault.books.length;
      case "status":
        return vault.books.filter((b) => b.status === f.status).length;
      case "shelf":
        return vault.links.filter((l) => l.shelfId === f.shelfId).length;
      case "lent":
        return vault.books.filter((b) => b.lentTo.trim() !== "").length;
      case "borrowed":
        return vault.books.filter((b) => b.ownership === "BORROWED").length;
    }
  };
  const chips: { filter: LibraryFilter; label: string; key: string }[] = [
    { filter: { kind: "all" }, label: t("filter_all"), key: "all" },
    ...STATUS_ORDER.map((status) => ({ filter: { kind: "status", status } as LibraryFilter, label: t(statusKey(status)), key: status })),
  ];
  if (count({ kind: "lent" }) > 0 || filter.kind === "lent") chips.push({ filter: { kind: "lent" }, label: t("filter_lent_out"), key: "lent" });
  if (count({ kind: "borrowed" }) > 0 || filter.kind === "borrowed") chips.push({ filter: { kind: "borrowed" }, label: t("filter_borrowed"), key: "borrowed" });
  for (const shelf of vault.shelves) chips.push({ filter: { kind: "shelf", shelfId: shelf.id }, label: shelf.name, key: `list_${shelf.id}` });

  const header = grouped ? (
    <>
      <div className="greeting" data-testid="greeting">
        <h2>{greeting}</h2>
        <p className="muted">{plural("greeting_books", vault.books.length)}</p>
      </div>
      {current ? (
        <Link href={`/book?id=${current.id}`} className={awayText(current) ? "continue-card away" : "continue-card"} data-testid="continue-reading" data-away={awayText(current) ?? undefined}>
          <BookCover title={current.title} authors={current.authors} url={coverAddressOf(current)} tiny />
          <span className="grow">
            <span className="continue-label">{t("continue_reading")}</span>
            <span className="continue-title" style={{ display: "block" }}>
              {current.title}
            </span>
            {awayText(current) ? (
              <span className="away-words" data-testid="away-words">
                {awayText(current)}
              </span>
            ) : null}
            {progressOf(current) !== null ? (
              <>
                <span style={{ display: "block", margin: "6px 0 4px" }}>
                  <ProgressBar value={progressOf(current) ?? 0} label={t("book_section_progress")} />
                </span>
                {current.pageCount > 0 ? <span className="small muted">{t("continue_page", current.currentPage, current.pageCount)}</span> : null}
              </>
            ) : null}
          </span>
        </Link>
      ) : null}
    </>
  ) : (
    <p className="muted small strong" style={{ padding: "6px 16px" }} data-testid="book-count">
      {plural("book_count", visible.length)}
    </p>
  );

  return (
    <div className="shelf-page page-wide" style={{ margin: "0 auto" }}>
      {/* The shelf is the one place that lives: lamplight from above, dust in it, a candle that flickers. */}
      <div className="lamp" aria-hidden="true" />
      <div style={{ position: "relative" }}>
        <header className="topbar">
          {searching ? (
            <div className="field">
              <label htmlFor="library-search" className="sr-only">
                {t("library_search_hint")}
              </label>
              <input id="library-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library_search_hint")} autoFocus data-testid="library-search" />
            </div>
          ) : (
            // On a wide screen the name stands in the sidebar already. It stays the heading of the page for screen readers.
            <h1 className="topbar-name">Shelfmark</h1>
          )}
          <IconButton
            icon={searching ? "close" : "search"}
            label={searching ? t("action_close") : t("library_search_hint")}
            onClick={() => {
              if (searching) setQuery("");
              setSearching(!searching);
            }}
            data-testid="toggle-search"
          />
          <div className="menu-wrap" ref={menuRef}>
            <IconButton icon="tune" label={t("library_view_options")} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} data-testid="view-menu" />
            {menuOpen ? (
              <div className="menu" role="group" aria-label={t("library_view_options")}>
                <div className="menu-heading">{t("library_view")}</div>
                {VIEW_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={mode === viewMode}
                    className="menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      if (mode !== viewMode) void mutate(setPrefs({ viewMode: mode }));
                    }}
                    data-testid={`view-${mode}`}
                  >
                    <span className="menu-check">{mode === viewMode ? <Icon name="check" size={22} /> : null}</span>
                    {t(viewKey(mode))}
                  </button>
                ))}
                <hr />
                <div className="menu-heading">{t("library_sort")}</div>
                {SORT_ORDERS.map((order) => (
                  <button
                    key={order}
                    type="button"
                    aria-pressed={order === sort}
                    className="menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      if (order !== sort) void mutate(setPrefs({ sort: order }));
                    }}
                    data-testid={`sort-${order}`}
                  >
                    <span className="menu-check">{order === sort ? <Icon name="check" size={22} /> : null}</span>
                    {t(sortKeyOf(order))}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <IconLink href="/settings" icon="settings" label={t("settings_title")} />
        </header>

        <div className="chips chips-scroll" role="group" aria-label={t("book_section_list")}>
          {chips.map((chip) => (
            <Chip key={chip.key} selected={sameFilter(filter, chip.filter)} count={count(chip.filter)} onClick={() => setFilter(chip.filter)} data-testid={`filter-${chip.key}`}>
              {chip.label}
            </Chip>
          ))}
        </div>

        {vault.books.length === 0 ? (
          <div className="empty-shelf" data-testid="empty-library">
            {/* A shelf that is ready and waiting: light on, tea poured, the cat already asleep. */}
            <div className="still-life" data-testid="still-life">
              <OrnamentView kind="LAMP" lively={prefs.motion} decorative />
              <OrnamentView kind="BOOKSTACK" decorative />
              <OrnamentView kind="MUG" decorative />
              <OrnamentView kind="CAT" decorative />
            </div>
            <div className="still-life-board">
              <ShelfBoard />
            </div>
            <h2 style={{ marginTop: 8 }}>{t("library_empty_title")}</h2>
            <p className="muted">{t("library_empty_text")}</p>
            <Link href="/add" className="btn btn-text">
              {t("library_empty_action")}
            </Link>
          </div>
        ) : visible.length === 0 && !(filter.kind === "shelf" && query.trim() === "") ? (
          <p className="empty-hint" style={{ textAlign: "center", padding: "48px 32px" }} data-testid="nothing-matches">
            {t("library_nothing_matches")}
          </p>
        ) : (
          <>
            {header}
            {viewMode === "SPINES" ? (
              <SpineShelf sections={sections} grouped={grouped} lively={prefs.motion} />
            ) : viewMode === "LIST" ? (
              <ul className="book-list" data-testid="book-list">
                {visible.map((book) => (
                  <li key={book.id}>
                    <BookRow book={book} />
                  </li>
                ))}
              </ul>
            ) : (
              <CoverShelf sections={sections} grouped={grouped} />
            )}
          </>
        )}
      </div>
      {/* In front of the books, where dust is. */}
      <DustMotes />
      <Link href="/add" className="fab" data-testid="add-book">
        <Icon name="add" />
        <span>{t("add_book")}</span>
      </Link>
      {decorating ? <OrnamentDialog shelfKey={decorating.key} shelfName={decorating.title} bookCount={decorating.count} onClose={() => setDecorating(null)} /> : null}
    </div>
  );
}
