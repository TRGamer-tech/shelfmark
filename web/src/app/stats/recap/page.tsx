"use client";

// Looks back at one month or one year: what was read, how much, and when
// (ui/stats/RecapScreen.kt).

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookCover } from "@/components/BookCover";
import { monthName, weekdayNames } from "@/components/Charts";
import { useDuration, useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { RatingBar } from "@/components/Ratings";
import { Card, Chip, IconButton, PageHead, Stat } from "@/components/ui";
import { daysInMonth, formatDay, fromEpochDay, toEpochDay, today } from "@/lib/dates";
import type { ReaderType, TimeOfDay } from "@/lib/insights";
import { recap as makeRecap } from "@/lib/insights";
import { formatPrice, formatRating } from "@/lib/libraryLogic";
import { coverAddressOf } from "@/lib/shelf";

const READER_KEYS: Record<ReaderType, string> = {
  QUIET_SHELF: "reader_quiet",
  WEEKEND_READER: "reader_weekend",
  EARLY_BIRD: "reader_early",
  AFTERNOON_ESCAPIST: "reader_afternoon",
  EVENING_UNWINDER: "reader_evening",
  NIGHT_OWL: "reader_night",
};

const TIME_KEYS: Record<TimeOfDay, string> = { MORNING: "time_morning", AFTERNOON: "time_afternoon", EVENING: "time_evening", NIGHT: "time_night" };

function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <>
      <span className="label-small" style={{ display: "block" }}>
        {label}
      </span>
      <span className="strong">{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className="fact fact-link">
      {inner}
    </Link>
  ) : (
    <div className="fact">{inner}</div>
  );
}

export default function RecapPage() {
  const { t, plural, locale } = useI18n();
  const duration = useDuration();
  const { vault } = useLibrary();
  const [yearly, setYearly] = useState(false);
  const [monthIndex, setMonthIndex] = useState(() => {
    const { year, month } = fromEpochDay(today());
    return year * 12 + month - 1;
  });
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const from = yearly ? toEpochDay(year, 1, 1) : toEpochDay(year, month, 1);
  const to = yearly ? toEpochDay(year, 12, 31) : toEpochDay(year, month, daysInMonth(year, month));
  const recap = useMemo(() => makeRecap(vault.books, vault.sessions, vault.purchases, from, to), [vault.books, vault.sessions, vault.purchases, from, to]);
  const ranked = (items: [string, number][]) => items.map(([name, count]) => `${name} (${count})`).join(", ");
  const highlights = recap.bestRated !== null || recap.longest !== null || recap.bestDay !== null || recap.favouriteWeekday !== null;

  return (
    <div className="page" data-testid="recap-page">
      <PageHead title={t("recap_title")} back="/stats" />
      <div className="chips" role="group" aria-label={t("recap_title")}>
        <Chip selected={!yearly} onClick={() => setYearly(false)} data-testid="recap-month">
          {t("recap_month")}
        </Chip>
        <Chip selected={yearly} onClick={() => setYearly(true)} data-testid="recap-year">
          {t("recap_year")}
        </Chip>
      </div>

      <Card>
        <div className="month-nav">
          <IconButton icon="left" label={t("calendar_previous")} onClick={() => setMonthIndex(monthIndex - (yearly ? 12 : 1))} />
          <h2 data-testid="recap-period">{yearly ? String(year) : monthName(locale, year, month)}</h2>
          <IconButton icon="right" label={t("calendar_next")} onClick={() => setMonthIndex(monthIndex + (yearly ? 12 : 1))} />
        </div>
        <h3 className="accent" style={{ fontSize: "1.5rem", marginTop: 8 }} data-testid="reader-type">
          {t(READER_KEYS[recap.readerType])}
        </h3>
        <p className="muted">{t(`${READER_KEYS[recap.readerType]}_text`)}</p>
      </Card>

      <Card title={t("recap_numbers")} testId="recap-numbers">
        <div className="tile-grid tile-grid-3">
          <Stat value={String(recap.finished.length)} label={t("stats_books_finished")} />
          <Stat value={String(recap.pages)} label={t("stats_pages")} />
          <Stat value={duration(recap.minutes)} label={t("stats_time")} />
          <Stat value={String(recap.sessions)} label={t("stats_sessions")} />
          <Stat value={String(recap.readingDays)} label={t("recap_reading_days")} />
          <Stat value={plural("days", recap.bestStreak)} label={t("stats_streak_best")} />
        </div>
      </Card>

      {recap.finished.length > 0 ? (
        <Card title={t("recap_finished")}>
          <div className="finished-row">
            {recap.finished.map((book) => (
              <Link key={book.id} href={`/book?id=${book.id}`} aria-label={book.title} title={book.title}>
                <BookCover title={book.title} authors={book.authors} url={coverAddressOf(book)} />
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {highlights ? (
        <Card title={t("recap_highlights")}>
          {recap.bestRated ? (
            <Link href={`/book?id=${recap.bestRated.id}`} className="row-between fact-link" style={{ padding: "4px 0" }}>
              <span>
                <span className="label-small" style={{ display: "block" }}>
                  {t("recap_best_rated")}
                </span>
                <span className="strong">{recap.bestRated.title}</span>
              </span>
              <RatingBar rating={recap.bestRated.rating} size={16} />
            </Link>
          ) : null}
          {recap.longest ? <Fact label={t("recap_longest")} value={`${recap.longest.title} (${plural("pages_count", recap.longest.pageCount)})`} href={`/book?id=${recap.longest.id}`} /> : null}
          {recap.bestDay ? <Fact label={t("recap_best_day")} value={`${formatDay(recap.bestDay.day, locale)}: ${recap.bestDay.pages > 0 ? plural("pages_count", recap.bestDay.pages) : duration(recap.bestDay.minutes)}`} /> : null}
          {recap.averageRating > 0 ? <Fact label={t("stats_average_rating")} value={formatRating(Math.round(recap.averageRating * 10) / 10, locale)} /> : null}
          {recap.favouriteWeekday !== null ? <Fact label={t("recap_favourite_weekday")} value={weekdayNames(locale, "long")[recap.favouriteWeekday - 1]} /> : null}
          {recap.favouriteTime !== null ? <Fact label={t("recap_favourite_time")} value={t(TIME_KEYS[recap.favouriteTime])} /> : null}
        </Card>
      ) : null}

      {recap.topAuthors.length > 0 || recap.topGenres.length > 0 ? (
        <Card title={t("recap_favourites")}>
          {recap.topAuthors.length > 0 ? <Fact label={t("stats_top_authors")} value={ranked(recap.topAuthors)} /> : null}
          {recap.topGenres.length > 0 ? <Fact label={t("stats_top_genres")} value={ranked(recap.topGenres)} /> : null}
        </Card>
      ) : null}

      {recap.spent.size > 0 ? (
        <Card title={t("recap_spent")}>
          {Array.from(recap.spent.entries()).map(([currency, amount]) => (
            <p key={currency} className="tile-value">
              {formatPrice(amount, currency, locale)}
            </p>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
