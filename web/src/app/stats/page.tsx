"use client";

// Statistics (ui/stats/StatsScreen.kt).

import Link from "next/link";
import { useMemo } from "react";
import { Bar, ColumnChart, monthLetters, useGoalTitle, weekdayNames } from "@/components/Charts";
import { Icon } from "@/components/icons";
import { useDuration, useI18n } from "@/components/i18n";
import { formatKey } from "@/components/labels";
import { useLibrary } from "@/components/library";
import { Card, PageHead, ProgressBar, Stat } from "@/components/ui";
import { today } from "@/lib/dates";
import { formatRating } from "@/lib/libraryLogic";
import { computeStats, goalProgress } from "@/lib/stats";

export default function StatsPage() {
  const { t, plural, locale } = useI18n();
  const duration = useDuration();
  const goalTitle = useGoalTitle();
  const { vault } = useLibrary();
  const day = today();
  const stats = useMemo(() => computeStats(vault.books, vault.sessions, vault.quotes.length, day), [vault.books, vault.sessions, vault.quotes.length, day]);
  const goals = useMemo(() => vault.goals.filter((g) => !g.archived).map((g) => goalProgress(g, vault.books, vault.sessions, day)), [vault.goals, vault.books, vault.sessions, day]);
  const compare = (before: number) => (before > 0 ? t("stats_last_year", stats.lastYear.year, before) : null);
  const rounded = (value: number) => formatRating(Math.round(value * 10) / 10, locale);
  const months = monthLetters(locale);

  return (
    <div className="page" data-testid="stats-page">
      <PageHead title={t("tab_stats")} />
      <nav className="explore" aria-label={t("tab_stats")}>
        <Link href="/stats/calendar" data-testid="open-calendar">
          <Icon name="calendar" />
          {t("calendar_title")}
        </Link>
        <Link href="/stats/recap" data-testid="open-recap">
          <Icon name="sparkle" />
          {t("recap_title")}
        </Link>
        <Link href="/stats/milestones" data-testid="open-milestones">
          <Icon name="trophy" />
          {t("milestones_title")}
        </Link>
      </nav>

      <Card title={t("goals_title")} testId="goals-card">
        {goals.length === 0 ? <p className="muted">{t("goals_none")}</p> : null}
        {goals.slice(0, 3).map((progress) => (
          <div key={progress.goal.id} style={{ marginBottom: 10 }}>
            <p className="strong">{goalTitle(progress.goal)}</p>
            <div className="row" style={{ flexWrap: "nowrap", gap: 12 }}>
              <div className="grow">
                <ProgressBar value={progress.fraction} label={goalTitle(progress.goal)} good={progress.reached} />
              </div>
              <span className="strong small">{`${progress.done} / ${progress.goal.target}`}</span>
            </div>
          </div>
        ))}
        <Link href="/stats/goals" className="btn btn-text" data-testid="open-goals">
          {t("goals_manage")}
        </Link>
      </Card>

      <Card title={t("stats_this_year", stats.thisYear.year)} testId="year-card">
        <div className="tile-grid">
          <Stat value={String(stats.thisYear.booksFinished)} label={t("stats_books_finished")} footnote={compare(stats.lastYear.booksFinished)} />
          <Stat value={String(stats.thisYear.pagesRead)} label={t("stats_pages")} footnote={compare(stats.lastYear.pagesRead)} />
          <Stat value={duration(stats.thisYear.minutesRead)} label={t("stats_time")} />
          <Stat value={String(stats.thisYear.sessions)} label={t("stats_sessions")} />
        </div>
      </Card>

      <Card title={t("stats_streak")}>
        <div className="tile-grid">
          <Stat value={plural("days", stats.currentStreak)} label={t("stats_streak_current")} />
          <Stat value={plural("days", stats.bestStreak)} label={t("stats_streak_best")} />
        </div>
      </Card>

      <Card title={t("stats_books_per_month")}>
        <ColumnChart values={stats.thisYear.booksPerMonth} labels={months} title={t("stats_books_per_month")} />
        <h2 className="card-title" style={{ marginTop: 16 }}>
          {t("stats_pages_per_month")}
        </h2>
        <ColumnChart values={stats.thisYear.pagesPerMonth} labels={months} title={t("stats_pages_per_month")} />
      </Card>

      <Card title={t("stats_library")} testId="library-card">
        <div className="tile-grid tile-grid-3">
          <Stat value={String(stats.totalBooks)} label={t("stats_total")} />
          <Stat value={String(stats.read)} label={t("status_read")} />
          <Stat value={String(stats.unread)} label={t("status_unread")} />
          <Stat value={String(stats.wishlist)} label={t("status_wishlist")} />
          <Stat value={stats.averageRating > 0 ? rounded(stats.averageRating) : "-"} label={t("stats_average_rating")} />
          <Stat value={stats.averageSpice > 0 ? rounded(stats.averageSpice) : "-"} label={t("stats_average_spice")} />
        </div>
      </Card>

      {stats.byFormat.length > 0 ? (
        <Card title={t("stats_by_format")}>
          {stats.byFormat.map(([format, count]) => (
            <Bar key={format} label={t(formatKey(format))} value={count} max={stats.byFormat[0][1]} />
          ))}
        </Card>
      ) : null}
      {stats.byRating.some((count) => count > 0) ? (
        <Card title={t("stats_by_rating")}>
          {stats.byRating.map((count, index) => (
            <Bar key={index} label={"★".repeat(index + 1)} value={count} max={Math.max(...stats.byRating)} star />
          ))}
        </Card>
      ) : null}
      {stats.topAuthors.length > 0 ? (
        <Card title={t("stats_top_authors")}>
          {stats.topAuthors.map(([name, count]) => (
            <Bar key={name} label={name} value={count} max={stats.topAuthors[0][1]} />
          ))}
        </Card>
      ) : null}
      {stats.topGenres.length > 0 ? (
        <Card title={t("stats_top_genres")}>
          {stats.topGenres.map(([name, count]) => (
            <Bar key={name} label={name} value={count} max={stats.topGenres[0][1]} />
          ))}
        </Card>
      ) : null}
      {stats.pagesByWeekday.some((pages) => pages > 0) ? (
        <Card title={t("stats_by_weekday")}>
          <ColumnChart values={stats.pagesByWeekday} labels={weekdayNames(locale)} title={t("stats_by_weekday")} />
        </Card>
      ) : null}
    </div>
  );
}
