"use client";

// Books on wooden boards, as in ui/components/Shelves.kt of the app: standing spine out
// with ornaments between them, standing face out, or as a plain list.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BookFormat, OrnamentKind } from "@/lib/model";
import type { ShelfThing } from "@/lib/shelf";
import { arrange, bookColor, inkOn, leanOf, packRows, spineGradient, spineHeight, spineWidth, thingWidth } from "@/lib/shelf";
import { BookCover } from "./BookCover";
import { Icon } from "./icons";
import { useI18n } from "./i18n";
import { OrnamentView } from "./Ornaments";
import { IconButton } from "./ui";

/** Anything that can stand on a shelf: one of my books or a friend's. */
export interface ShelfItem {
  key: number;
  title: string;
  authors: string;
  cover: string | null;
  pageCount: number;
  format: BookFormat | string;
  /** Colour of a small ribbon, e.g. for "currently reading" or "available to borrow". */
  ribbon?: string | null;
  /** Where a click leads. Without it [onClick] of the shelf is called, and without that the book just stands there. */
  href?: string;
  /** A paper label at the foot of the spine, as library books carry their shelfmark. */
  label?: string;
  /** For a book that works as a switch: whether it is the one taken off the shelf. */
  pressed?: boolean;
  /**
   * For a book that is away (lib/away.ts): the words for it, "Lent to Bo". The book is
   * then drawn see-through with a dashed outline, and the words are said with its title.
   */
  away?: string | null;
}

/** A run of books under one heading, e.g. everything on the "Reading" list. */
export interface ShelfSection {
  key: string;
  items: ShelfItem[];
  /** Heading above the shelf, or null for a shelf without one. */
  title?: string | null;
  /** Opens just this list when the heading is clicked. */
  onOpen?: (() => void) | null;
  /** Ornaments on this shelf, each standing after the given number of books. Only the spine view shows them. */
  ornaments?: { position: number; kind: OrnamentKind | string }[];
  /** Opens the dialog for choosing ornaments. */
  onDecorate?: (() => void) | null;
  /** Shown on the bare board when the shelf has nothing on it. Without it an empty shelf is not drawn at all. */
  emptyHint?: string | null;
}

interface ShelfProps {
  sections: ShelfSection[];
  onClick?: (item: ShelfItem) => void;
  /** Sections side by side where there is room, like the bays of a bookcase. */
  grouped?: boolean;
  lively?: boolean;
}

/**
 * The width of an element, kept up to date as the window changes. Zero until it is known.
 * It is the width the element is laid out with: a shelf that is drawn larger or smaller
 * than life (as on the front page) still packs its books by its own measure.
 */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.offsetWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function ShelfBoard() {
  return (
    <>
      <div className="board" aria-hidden="true" />
      <div className="board-shadow" aria-hidden="true" />
    </>
  );
}

function DecorateButton({ section }: { section: ShelfSection }) {
  const { t } = useI18n();
  return <IconButton icon="flower" label={`${t("ornament_title")}: ${section.title}`} onClick={section.onDecorate ?? undefined} className="muted" data-testid={`decorate-${section.key}`} />;
}

function Heading({ section, decorate }: { section: ShelfSection; decorate: boolean }) {
  if (!section.title) return null;
  const inner = (
    <>
      <span>{section.title}</span>
      <span className="shelf-count">{section.items.length}</span>
    </>
  );
  return (
    <div className="shelf-heading" data-testid={`shelf-${section.key}`}>
      <h2>
        {section.onOpen ? (
          <button type="button" className="shelf-open" onClick={section.onOpen}>
            {inner}
            <Icon name="right" />
          </button>
        ) : (
          <span className="shelf-open">{inner}</span>
        )}
      </h2>
      <span className="grow" />
      {decorate && section.onDecorate ? <DecorateButton section={section} /> : null}
    </div>
  );
}

function EmptyShelf({ hint, sectionKey }: { hint: string; sectionKey: string }) {
  return (
    <>
      <div className="shelf-row shelf-row-empty" data-testid={`empty-shelf-${sectionKey}`}>
        <p>{hint}</p>
      </div>
      <ShelfBoard />
    </>
  );
}

/** What a book on the shelf is: a link to its page, a button that opens something, or simply a book. */
function Clickable({ item, onClick, className, style, children, testId }: { item: ShelfItem; onClick?: (item: ShelfItem) => void; className: string; style?: React.CSSProperties; children: ReactNode; testId?: string }) {
  // A book that is away says so, to whoever hears the page and to whoever rests the pointer on it.
  const name = item.away ? `${item.title}, ${item.away}` : item.title;
  const look = item.away ? `${className} away` : className;
  if (item.href) {
    return (
      <Link href={item.href} className={look} style={style} aria-label={name} title={name} data-testid={testId} data-away={item.away ?? undefined}>
        {children}
      </Link>
    );
  }
  if (!onClick) {
    // Nothing happens on a click, so it must not look or behave as if something did.
    return (
      <span className={`${look} still`} style={style} role="img" aria-label={name} title={name} data-testid={testId} data-away={item.away ?? undefined}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" className={look} style={style} aria-label={name} title={name} aria-pressed={item.pressed} onClick={() => onClick(item)} data-testid={testId} data-away={item.away ?? undefined}>
      {children}
    </button>
  );
}

function Spine({ item, onClick, order, lean }: { item: ShelfItem; onClick?: (item: ShelfItem) => void; order: number; lean: { angle: number; offset: number } | null }) {
  const width = spineWidth(item.pageCount);
  const height = spineHeight(item.title, item.format);
  const style: React.CSSProperties & Record<string, string | number> = {
    width,
    height,
    color: inkOn(bookColor(item.title)),
    "--i": Math.min(order, 14),
  };
  if (lean) {
    // The last book of a shelf that is not full leans on its neighbour.
    style.marginLeft = lean.offset;
    style.rotate = `${-lean.angle}deg`;
  }
  return (
    <Clickable item={item} onClick={onClick} className={`spine settle ${width >= 44 ? "spine-wide" : ""} ${item.pressed ? "spine-out" : ""} ${item.label ? "spine-marked" : ""}`} style={style} testId={lean ? "leaning" : "spine"}>
      {/* The book itself, apart from the place it stands in: of a book that is away the place keeps its outline and the book is see-through. */}
      <span className="spine-body" style={{ background: spineGradient(item.title) }}>
        <span className="spine-band" style={{ top: 9 }} />
        <span className="spine-band spine-band-thin" style={{ top: 13 }} />
        {item.label ? null : <span className="spine-band" style={{ bottom: 10 }} />}
        <span className="spine-title" aria-hidden="true">
          <span>{item.title}</span>
        </span>
        {item.label ? (
          <span className="spine-label" aria-hidden="true">
            {item.label}
          </span>
        ) : null}
      </span>
      {item.ribbon ? <span className="ribbon" style={{ background: item.ribbon }} /> : null}
    </Clickable>
  );
}

function SpineSection({ section, onClick, lively }: { section: ShelfSection; onClick?: (item: ShelfItem) => void; lively: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const ornaments = section.ornaments ?? [];
  const things = useMemo<ShelfThing[]>(
    () =>
      arrange(
        section.items.length,
        ornaments.map((o) => o.position),
      ).map(([isBook, index]) =>
        isBook
          ? { type: "spine", index, title: section.items[index].title, pageCount: section.items[index].pageCount, format: section.items[index].format }
          : { type: "deco", index, kind: ornaments[index].kind },
      ),
    [section.items, ornaments],
  );
  // The board is as wide as the section, the books keep 16 pixels from either end.
  const available = width - 32;
  const rows = width > 0 ? packRows(things.map(thingWidth), available, 2) : [];
  return (
    <div ref={ref}>
      {things.length === 0 && section.emptyHint ? <EmptyShelf hint={section.emptyHint} sectionKey={section.key} /> : null}
      {rows.map(([first, last], rowIndex) => {
        const row = things.slice(first, last + 1);
        const lean = leanOf(section.key, rowIndex, row, available);
        return (
          <div key={rowIndex}>
            <div className="shelf-row shelf-row-spines">
              {row.map((thing, position) =>
                thing.type === "spine" ? (
                  <Spine key={`b${section.items[thing.index].key}`} item={section.items[thing.index]} onClick={onClick} order={rowIndex * 3 + position} lean={position === row.length - 1 ? lean : null} />
                ) : (
                  <OrnamentView key={`o${thing.index}`} kind={thing.kind} lively={lively} className="settle" style={{ "--i": Math.min(rowIndex * 3 + position, 14) } as React.CSSProperties} />
                ),
              )}
            </div>
            <ShelfBoard />
          </div>
        );
      })}
    </div>
  );
}

function CoverSection({ section, onClick }: { section: ShelfSection; onClick?: (item: ShelfItem) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const columns = Math.min(8, Math.max(3, Math.floor(width / 112)));
  const rows: ShelfItem[][] = [];
  if (width > 0) for (let i = 0; i < section.items.length; i += columns) rows.push(section.items.slice(i, i + columns));
  return (
    <div ref={ref}>
      {section.items.length === 0 && section.emptyHint ? <EmptyShelf hint={section.emptyHint} sectionKey={section.key} /> : null}
      {rows.map((row, rowIndex) => (
        <div key={row[0].key}>
          <div className="shelf-row shelf-row-covers">
            {row.map((item, column) => (
              <div key={item.key} className="cover-slot settle" style={{ "--i": Math.min(rowIndex * 2 + column, 14) } as React.CSSProperties}>
                <Clickable item={item} onClick={onClick} className="cover-link" testId="cover">
                  <BookCover title={item.title} authors={item.authors} url={item.cover} />
                </Clickable>
                {item.ribbon ? <span className="ribbon" style={{ background: item.ribbon }} /> : null}
              </div>
            ))}
            {Array.from({ length: columns - row.length }, (_, i) => (
              <div key={`gap${i}`} />
            ))}
          </div>
          <ShelfBoard />
        </div>
      ))}
    </div>
  );
}

function sectionClass(section: ShelfSection, grouped: boolean): string {
  // A long shelf takes the whole width of the bookcase, short ones share it.
  return `shelf-section ${grouped && section.items.length > 12 ? "shelf-section-wide" : ""}`;
}

/** Books standing spine out, the way they do on a real shelf. Needs no cover pictures at all. */
export function SpineShelf({ sections, onClick, grouped = false, lively = true }: ShelfProps) {
  return (
    <div className={`bookcase ${grouped ? "bookcase-grouped" : ""}`} data-testid="spine-shelf">
      {sections.map((section) => (
        <section key={section.key} className={sectionClass(section, grouped)}>
          <Heading section={section} decorate />
          <SpineSection section={section} onClick={onClick} lively={lively} />
        </section>
      ))}
    </div>
  );
}

/** Books standing face out on shelf boards, one group of shelves per section. */
export function CoverShelf({ sections, onClick, grouped = false }: ShelfProps) {
  return (
    <div className={`bookcase ${grouped ? "bookcase-grouped" : ""}`} data-testid="cover-shelf">
      {sections.map((section) => (
        <section key={section.key} className={sectionClass(section, grouped)}>
          <Heading section={section} decorate={false} />
          <CoverSection section={section} onClick={onClick} />
        </section>
      ))}
    </div>
  );
}
