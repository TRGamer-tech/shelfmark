"use client";

// Two shelves of one sample library, one as wide as a browser window and one as narrow
// as a phone. A change of view, order or ornaments on either is followed by the other:
// that is what an account does for a real library, shown here instead of claimed.
//
// Both are drawn with the code of the library itself: the same shelves, the same way of
// sorting, the same rule for where an ornament stands.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Lang } from "@/i18n/index";
import type { LandingTexts } from "@/i18n/landing";
import { sortBooks } from "@/lib/libraryLogic";
import type { Book, SortOrder, ViewMode } from "@/lib/model";
import { SORT_ORDERS, VIEW_MODES, newBook } from "@/lib/model";
import { BookCover } from "../BookCover";
import { I18nProvider } from "../i18n";
import { RatingBar } from "../Ratings";
import type { ShelfItem } from "../Shelves";
import { CoverShelf, SpineShelf } from "../Shelves";
import { Scaled } from "./Scaled";

// The sample library. Titles and authors are real, the stars are those of a reader who
// does not exist, and the page counts only decide how thick a spine is drawn.
const DAY = 86_400_000;
const SAMPLE: Book[] = [
  ["Middlemarch", "George Eliot", 880, 5, "HARDCOVER"],
  ["Heidi", "Johanna Spyri", 320, 4, "PAPERBACK"],
  ["Moby-Dick", "Herman Melville", 720, 3.5, "HARDCOVER"],
  ["Emma", "Jane Austen", 474, 4.5, "PAPERBACK"],
  ["Effi Briest", "Theodor Fontane", 350, 3, "PAPERBACK"],
  ["Dracula", "Bram Stoker", 418, 4, "HARDCOVER"],
  ["Walden", "Henry David Thoreau", 352, 2.5, "PAPERBACK"],
  ["Frankenstein", "Mary Shelley", 280, 4.5, "PAPERBACK"],
  ["Jane Eyre", "Charlotte Brontë", 532, 5, "PAPERBACK"],
].map(([title, authors, pageCount, rating, format], index) =>
  // The first three are being read, the others are read.
  newBook({ id: index + 1, title: title as string, authors: authors as string, pageCount: pageCount as number, rating: rating as number, format: format as Book["format"], status: index < 3 ? "READING" : "READ", addedAt: (index + 1) * DAY }),
);
const READ_COUNT = SAMPLE.filter((book) => book.status === "READ").length;

type Device = "browser" | "phone";

interface Settings {
  view: ViewMode;
  sort: SortOrder;
  /** After how many books of the "Read" shelf the candle stands. */
  candle: number;
  /** Whether the cat sleeps at the end of the "Reading" shelf. */
  cat: boolean;
}

const START: Settings = { view: "SPINES", sort: "ADDED", candle: 2, cat: false };

interface Labels {
  views: Record<string, string>;
  sorts: Record<string, string>;
  /** Headings of the two shelves: the lists the sample books are on. */
  reading: string;
  read: string;
}

interface Props {
  lang: Lang;
  texts: LandingTexts["twin"];
  labels: Labels;
}

function Shelf({ settings, labels, wide }: { settings: Settings; labels: Labels; wide: boolean }) {
  const books = useMemo(() => sortBooks(SAMPLE, settings.sort), [settings.sort]);
  const itemsOf = (status: Book["status"]): ShelfItem[] =>
    books.filter((book) => book.status === status).map((book) => ({ key: book.id, title: book.title, authors: book.authors, cover: null, pageCount: book.pageCount, format: book.format }));
  // One shelf for every list that has books, as in the library. Ornaments stand where the reader put them.
  const sections = [
    { key: "READING", title: labels.reading, items: itemsOf("READING"), ornaments: settings.cat ? [{ position: 99, kind: "CAT" }] : [] },
    { key: "READ", title: labels.read, items: itemsOf("READ"), ornaments: [{ position: settings.candle, kind: "CANDLE" }] },
  ];
  if (settings.view === "COVERS") return <CoverShelf sections={sections} grouped={wide} />;
  if (settings.view === "LIST") {
    return (
      <ul className="book-list">
        {books.map((book) => (
          <li key={book.id}>
            <div className="book-row">
              <BookCover title={book.title} authors={book.authors} url={null} tiny />
              <span className="book-row-text">
                <span className="book-row-title">{book.title}</span>
                <span className="book-row-authors">{book.authors}</span>
                <span className="row" style={{ marginTop: 4 }}>
                  <span className="status-word">{book.status === "READING" ? labels.reading : labels.read}</span>
                  <RatingBar rating={book.rating} size={14} />
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  // In a wide window the shelves stand side by side, like the bays of a bookcase.
  return <SpineShelf sections={sections} grouped={wide} lively={false} />;
}

function Controls({ device, settings, texts, labels, onChange }: { device: Device; settings: Settings; texts: LandingTexts["twin"]; labels: Labels; onChange: (next: Settings) => void }) {
  const id = useId();
  // Ornaments only stand among spines, as in the library itself.
  const spines = settings.view === "SPINES";
  return (
    <div className="twin-controls">
      <div className="twin-field">
        <label htmlFor={`${id}-view`}>{texts.view}</label>
        <select id={`${id}-view`} value={settings.view} onChange={(event) => onChange({ ...settings, view: event.target.value as ViewMode })} data-testid={`${device}-view`}>
          {VIEW_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {labels.views[mode]}
            </option>
          ))}
        </select>
      </div>
      <div className="twin-field">
        <label htmlFor={`${id}-sort`}>{texts.order}</label>
        <select id={`${id}-sort`} value={settings.sort} onChange={(event) => onChange({ ...settings, sort: event.target.value as SortOrder })} data-testid={`${device}-sort`}>
          {SORT_ORDERS.map((order) => (
            <option key={order} value={order}>
              {labels.sorts[order]}
            </option>
          ))}
        </select>
      </div>
      <div className="twin-buttons" role="group" aria-label={texts.ornaments}>
        <button type="button" disabled={!spines || settings.candle <= 0} onClick={() => onChange({ ...settings, candle: settings.candle - 1 })} data-testid={`${device}-candle-left`}>
          {texts.candleLeft}
        </button>
        <button type="button" disabled={!spines || settings.candle >= READ_COUNT} onClick={() => onChange({ ...settings, candle: settings.candle + 1 })} data-testid={`${device}-candle-right`}>
          {texts.candleRight}
        </button>
        <button type="button" disabled={!spines} aria-pressed={settings.cat} onClick={() => onChange({ ...settings, cat: !settings.cat })} data-testid={`${device}-cat`}>
          {settings.cat ? texts.catOff : texts.catOn}
        </button>
      </div>
    </div>
  );
}

export function TwinShelves({ lang, texts, labels }: Props) {
  const [shown, setShown] = useState<Record<Device, Settings>>({ browser: START, phone: START });
  const [said, setSaid] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (from: Device, next: Settings) => {
    const other: Device = from === "browser" ? "phone" : "browser";
    setShown((current) => ({ ...current, [from]: next }));
    window.clearTimeout(timer.current);
    const follow = () => {
      setShown((current) => ({ ...current, [other]: next }));
      setSaid(from === "browser" ? texts.followedPhone : texts.followedBrowser);
    };
    // A beat later, so that cause and effect can be told apart. Not for somebody who asked for less movement.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) follow();
    else timer.current = window.setTimeout(follow, 450);
  };

  const device = (name: Device, designWidth: number) => (
    <div className={`twin-device twin-${name}`} data-testid={`twin-${name}`}>
      <p className="twin-name">{name === "browser" ? texts.browser : texts.phone}</p>
      <div className="twin-frame paper" data-view={shown[name].view} data-sort={shown[name].sort}>
        <Scaled designWidth={designWidth}>
          <div className="twin-screen">
            <Shelf settings={shown[name]} labels={labels} wide={name === "browser"} />
          </div>
        </Scaled>
      </div>
      <Controls device={name} settings={shown[name]} texts={texts} labels={labels} onChange={(next) => change(name, next)} />
    </div>
  );

  return (
    <I18nProvider fixed={lang}>
      <div className="twin-stage">
        <div className="twin-left">
          {device("browser", 640)}
          <p className="twin-said" role="status" data-testid="twin-said">
            {said}
          </p>
          <p className="twin-caption">{texts.caption}</p>
        </div>
        {device("phone", 300)}
      </div>
    </I18nProvider>
  );
}
