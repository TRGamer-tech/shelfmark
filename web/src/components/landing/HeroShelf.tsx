"use client";

// The shelf of the front page. It is the shelf of the library itself (Shelves.tsx,
// with its ornaments and the book that leans), and its books are what Shelfmark does:
// taking one off the shelf shows its catalogue card.

import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Lang } from "@/i18n/index";
import { format } from "@/i18n/index";
import type { Feature, LandingTexts } from "@/i18n/landing";
import { I18nProvider } from "../i18n";
import type { ShelfItem } from "../Shelves";
import { SpineShelf } from "../Shelves";
import { Scaled } from "./Scaled";

// What stands between the books: a candle, a sleeping cat and a globe, each after so many books.
const ORNAMENTS = [
  { position: 3, kind: "CANDLE" },
  { position: 9, kind: "CAT" },
  { position: 12, kind: "GLOBE" },
];

interface Props {
  lang: Lang;
  features: Feature[];
  texts: LandingTexts["shelf"];
  /** What a shelfmark is, for the margin. */
  note: string;
}

export function HeroShelf({ lang, features, texts, note }: Props) {
  const [open, setOpen] = useState(0);

  const items = useMemo<ShelfItem[]>(
    () =>
      features.map((feature, index) => ({
        key: index,
        title: feature.title,
        authors: "",
        cover: null,
        pageCount: feature.pages,
        format: feature.hardcover ? "HARDCOVER" : "PAPERBACK",
        label: feature.mark,
        pressed: index === open,
      })),
    [features, open],
  );
  const sections = useMemo(() => [{ key: "front", items, ornaments: ORNAMENTS }], [items]);

  // Left and right walk along the spines, as they do along a row of tabs.
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const spines = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.spine"));
    const at = spines.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    spines[(at + step + spines.length) % spines.length].focus();
  };

  const turn = (step: number) => setOpen((current) => (current + step + features.length) % features.length);

  return (
    <I18nProvider fixed={lang}>
      <div className="shelf-intro">
        <p className="shelf-hint">{texts.hint}</p>
        <p className="hero-note">{note}</p>
      </div>
      <div className="hero-shelf" role="group" aria-label={texts.label} onKeyDown={walk} data-testid="hero-shelf">
        <Scaled>
          <SpineShelf sections={sections} onClick={(item) => setOpen(item.key)} lively={false} />
        </Scaled>
        {/* Without scripts no book can be taken off the shelf, and none is drawn. The cards below are all there. */}
        <noscript>
          <p className="shelf-plain">{texts.plain}</p>
        </noscript>
      </div>
      <div className="reading-desk">
        <ol className="cards" aria-label={texts.cardsLabel} aria-live="polite" data-testid="cards">
            {features.map((feature, index) => (
              <li key={feature.mark} className={index === open ? "card-slip is-open" : "card-slip"} data-testid={index === open ? "open-card" : undefined}>
                <article className="catalogue-card paper">
                  <p className="card-mark">
                    <span className="sr-only">{texts.mark}: </span>
                    {feature.mark}
                  </p>
                  <h3>{feature.title}</h3>
                  <p className="card-text">{feature.text}</p>
                  <p className="card-where">
                    <span>{texts.where}</span> {feature.where}
                  </p>
                  <span className="card-hole" aria-hidden="true" />
                </article>
              </li>
            ))}
        </ol>
        <div className="card-turn">
          <span className="card-count" data-testid="card-count">
            {format(texts.counter, [open + 1, features.length])}
          </span>
          <button type="button" onClick={() => turn(-1)} data-testid="card-previous">
            {texts.previous}
          </button>
          <button type="button" onClick={() => turn(1)} data-testid="card-next">
            {texts.next}
          </button>
        </div>
      </div>
    </I18nProvider>
  );
}
