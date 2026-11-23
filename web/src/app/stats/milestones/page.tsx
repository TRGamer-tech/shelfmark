"use client";

// How far the reader has come in each discipline, and when the big moments happened
// (ui/stats/MilestonesScreen.kt).

import Link from "next/link";
import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { Card, PageHead, ProgressBar } from "@/components/ui";
import { formatDay, today } from "@/lib/dates";
import type { MilestoneCategory } from "@/lib/insights";
import { milestoneTimeline, milestones } from "@/lib/insights";

const LABELS: Record<MilestoneCategory, string> = {
  BOOKS: "milestone_books",
  PAGES: "milestone_pages",
  SESSIONS: "milestone_sessions",
  HOURS: "milestone_hours",
  REVIEWS: "milestone_reviews",
  QUOTES: "milestone_quotes",
  STREAK: "milestone_streak",
  LONG_BOOKS: "milestone_long_books",
};

const ICONS: Record<MilestoneCategory, IconName> = {
  BOOKS: "book",
  PAGES: "page",
  SESSIONS: "bookmark",
  HOURS: "clock",
  REVIEWS: "review",
  QUOTES: "quote",
  STREAK: "fire",
  LONG_BOOKS: "bookmarks",
};

export default function MilestonesPage() {
  const { t, locale } = useI18n();
  const { vault } = useLibrary();
  const day = today();
  const all = useMemo(() => milestones(vault.books, vault.sessions, vault.quotes.length, day), [vault.books, vault.sessions, vault.quotes.length, day]);
  const timeline = useMemo(() => milestoneTimeline(vault.books), [vault.books]);

  return (
    <div className="page" data-testid="milestones-page">
      <PageHead title={t("milestones_title")} back="/stats" />
      {all.map((milestone) => (
        <Card key={milestone.category} testId={`milestone-${milestone.category}`}>
          <div className="milestone-head">
            <Icon name={ICONS[milestone.category]} size={28} />
            <div className="grow">
              <p className="strong">{t(LABELS[milestone.category])}</p>
              {/* One dot per tier, filled once it is reached. */}
              <div className="dots" role="img" aria-label={`${milestone.reached} / ${milestone.tiers.length}`}>
                {milestone.tiers.map((tier, index) => (
                  <span key={tier} className={`dot ${index < milestone.reached ? "dot-on" : ""}`} />
                ))}
              </div>
            </div>
            <span className="milestone-value" data-testid="milestone-value">
              {milestone.value}
            </span>
          </div>
          <ProgressBar value={milestone.progress} label={t(LABELS[milestone.category])} />
          <p className="small muted" style={{ marginTop: 4 }}>
            {milestone.next !== null ? t("milestone_next", milestone.next) : t("milestone_all_done")}
          </p>
        </Card>
      ))}
      {timeline.length > 0 ? (
        <>
          <h2 className="section-title">{t("milestones_journey")}</h2>
          {timeline.map((event) => {
            const body = (
              <>
                <Icon name="trophy" />
                <span>
                  <span className="strong" style={{ display: "block" }}>
                    {t(event.category === "LONG_BOOKS" ? "milestone_event_long" : "milestone_event_book", event.tier)}
                  </span>
                  <span className="small muted">{[event.book?.title, formatDay(event.day, locale)].filter(Boolean).join(" · ")}</span>
                </span>
              </>
            );
            return event.book ? (
              <Link key={`${event.category}_${event.tier}`} href={`/book?id=${event.book.id}`} className="timeline-item" data-testid="timeline-item">
                {body}
              </Link>
            ) : (
              <div key={`${event.category}_${event.tier}`} className="timeline-item">
                {body}
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
