"use client";

// A month at a glance: the more was read on a day, the stronger its colour, with the
// cover of the book (ui/stats/CalendarScreen.kt).

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookCover } from "@/components/BookCover";
import { monthName, weekdayNames } from "@/components/Charts";
import { useDuration, useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { Card, IconButton, PageHead } from "@/components/ui";
import { daysInMonth, formatDay, fromEpochDay, toEpochDay, today, weekdayOf } from "@/lib/dates";
import type { DaySummary } from "@/lib/insights";
import { dayAmount, daySummaries } from "@/lib/insights";
import type { Book } from "@/lib/model";
import { coverAddressOf } from "@/lib/shelf";
import { daysInYear } from "@/lib/stats";

/** The whole year as small squares, a column per week. */
function YearHeatmap({ year, days }: { year: number; days: Map<number, DaySummary> }) {
  const { t, plural } = useI18n();
  const start = toEpochDay(year, 1, 1);
  const length = daysInYear(year);
  const amounts = Array.from({ length }, (_, i) => {
    const summary = days.get(start + i);
    return summary ? dayAmount(summary) : 0;
  });
  const max = Math.max(1, ...amounts);
  const lead = weekdayOf(start) - 1;
  const weeks = Math.ceil((lead + length) / 7);
  const cell = 10;
  const gap = 1.4;
  const reading = amounts.filter((a) => a > 0).length;
  return (
    <>
      <svg viewBox={`0 0 ${weeks * cell} ${7 * cell}`} role="img" aria-label={plural("reading_days", reading)} style={{ width: "100%", display: "block" }} data-testid="heatmap">
        {amounts.map((amount, index) => {
          const slot = lead + index;
          return (
            <rect
              key={index}
              x={Math.floor(slot / 7) * cell + gap / 2}
              y={(slot % 7) * cell + gap / 2}
              width={cell - gap}
              height={cell - gap}
              rx={cell * 0.2}
              fill={amount > 0 ? "var(--accent-text)" : "var(--tile)"}
              fillOpacity={amount > 0 ? 0.25 + (0.75 * amount) / max : 1}
            />
          );
        })}
      </svg>
      <div className="row-between" style={{ marginTop: 6 }}>
        <span className="small muted">{plural("reading_days", reading)}</span>
        <span className="heat-legend" aria-hidden="true">
          {t("calendar_less")}
          {[0, 0.25, 0.5, 0.75, 1].map((level) => (
            <span key={level} className="heat-swatch" style={{ background: level === 0 ? "var(--tile)" : "var(--accent-text)", opacity: level === 0 ? 1 : 0.25 + 0.75 * level }} />
          ))}
          {t("calendar_more")}
        </span>
      </div>
    </>
  );
}

function DayCard({ day, summary, books }: { day: number; summary: DaySummary | undefined; books: Map<number, Book> }) {
  const { t, plural, locale } = useI18n();
  const duration = useDuration();
  const parts = summary ? [summary.pages > 0 ? plural("pages_count", summary.pages) : null, summary.minutes > 0 ? duration(summary.minutes) : null].filter(Boolean).join(" · ") : "";
  return (
    <Card title={formatDay(day, locale)} testId="day-card">
      {!summary ? (
        <p className="muted">{t("calendar_nothing")}</p>
      ) : (
        <>
          <p className="strong accent">{parts !== "" ? parts : t("calendar_finished_only")}</p>
          {summary.bookIds
            .map((id) => books.get(id))
            .filter((book): book is Book => book !== undefined)
            .map((book) => (
              <Link key={book.id} href={`/book?id=${book.id}`} className="row-between fact-link" style={{ padding: "6px 0" }}>
                <span className="grow">
                  <span style={{ display: "block" }}>{book.title}</span>
                  {book.authors.trim() !== "" ? <span className="small muted">{book.authors}</span> : null}
                </span>
                {summary.finishedIds.includes(book.id) ? <span className="status-word">{t("calendar_finished")}</span> : null}
              </Link>
            ))}
        </>
      )}
    </Card>
  );
}

export default function CalendarPage() {
  const { t, plural, locale } = useI18n();
  const duration = useDuration();
  const { vault } = useLibrary();
  const now = today();
  const [monthIndex, setMonthIndex] = useState(() => {
    const { year, month } = fromEpochDay(now);
    return year * 12 + month - 1;
  });
  const [selected, setSelected] = useState<number | null>(null);
  const days = useMemo(() => daySummaries(vault.books, vault.sessions), [vault.books, vault.sessions]);
  const books = useMemo(() => new Map(vault.books.map((b) => [b.id, b])), [vault.books]);

  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const length = daysInMonth(year, month);
  const first = toEpochDay(year, month, 1);
  // Monday first.
  const lead = weekdayOf(first) - 1;
  const inMonth = Array.from({ length }, (_, i) => days.get(first + i)).filter((d): d is DaySummary => d !== undefined);
  const max = Math.max(1, ...inMonth.map(dayAmount));
  const finished = new Set(inMonth.flatMap((d) => d.finishedIds)).size;
  const move = (by: number) => {
    setMonthIndex(monthIndex + by);
    setSelected(null);
  };

  return (
    <div className="page" data-testid="calendar-page">
      <PageHead title={t("calendar_title")} back="/stats" />
      <Card>
        <div className="month-nav">
          <IconButton icon="left" label={t("calendar_previous")} onClick={() => move(-1)} data-testid="calendar-prev" />
          <h2 data-testid="calendar-month">{monthName(locale, year, month)}</h2>
          <IconButton icon="right" label={t("calendar_next")} onClick={() => move(1)} data-testid="calendar-next" />
        </div>
        <div className="cal-grid" aria-hidden="true">
          {weekdayNames(locale).map((name) => (
            <span key={name} className="cal-weekday">
              {name}
            </span>
          ))}
        </div>
        <div className="cal-grid">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead${i}`} />
          ))}
          {Array.from({ length }, (_, i) => {
            const day = first + i;
            const summary = days.get(day);
            const amount = summary ? dayAmount(summary) : 0;
            const book = summary?.bookIds.map((id) => books.get(id)).find((b) => b !== undefined);
            return (
              <button
                key={day}
                type="button"
                className={`cal-day ${day === selected ? "cal-day-selected" : day === now ? "cal-day-today" : ""}`}
                style={summary ? { background: `color-mix(in srgb, var(--accent-text) ${Math.round((0.18 + (0.6 * amount) / max) * 100)}%, transparent)` } : undefined}
                aria-label={formatDay(day, locale) + (summary ? `: ${plural("pages_count", summary.pages)}` : "")}
                aria-pressed={day === selected}
                onClick={() => setSelected(day === selected ? null : day)}
                data-testid={`day-${i + 1}`}
              >
                {book ? <BookCover title={book.title} authors={book.authors} url={coverAddressOf(book)} tiny /> : null}
                <span className={`cal-number ${book ? "cal-number-on-cover" : ""}`}>{i + 1}</span>
              </button>
            );
          })}
        </div>
        <p className="small muted" style={{ marginTop: 10 }} data-testid="month-summary">
          {t(
            "calendar_month_summary",
            inMonth.reduce((sum, d) => sum + d.pages, 0),
            duration(inMonth.reduce((sum, d) => sum + d.minutes, 0)),
            finished,
          )}
        </p>
      </Card>
      {selected !== null ? <DayCard day={selected} summary={days.get(selected)} books={books} /> : null}
      <Card title={t("calendar_year", year)}>
        <YearHeatmap year={year} days={days} />
      </Card>
    </div>
  );
}
