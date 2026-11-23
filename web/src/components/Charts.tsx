"use client";

import { useI18n } from "./i18n";
import { goalUnitKey, repeatKey } from "./labels";
import type { Goal } from "@/lib/model";

/** Small column chart with a label under each column and the highest value named. */
export function ColumnChart({ values, labels, title }: { values: number[]; labels: string[]; title: string }) {
  const { t } = useI18n();
  const highest = values.reduce((max, v) => Math.max(max, v), 0);
  const max = Math.max(1, highest);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="small muted">{t("stats_chart_max", highest)}</figcaption>
      <div className="columns" role="img" aria-label={`${title}: ${values.map((v, i) => `${labels[i]} ${v}`).join(", ")}`}>
        {values.map((value, index) => (
          <div key={index} className="column">
            {value > 0 ? <div className="column-fill" style={{ height: `${Math.max(8, (value / max) * 100)}%` }} /> : null}
          </div>
        ))}
      </div>
      <div className="column-labels" aria-hidden="true">
        {labels.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
    </figure>
  );
}

/** One labelled horizontal bar, used for the rankings. */
export function Bar({ label, value, max, star }: { label: string; value: number; max: number; star?: boolean }) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="bar-row">
      <span className="bar-label" style={star ? { color: "var(--star-text)" } : undefined}>
        {label}
      </span>
      <div className="progress" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${percent}%`, background: star ? "var(--star)" : undefined }} />
      </div>
      <span className="bar-value">{value}</span>
    </div>
  );
}

/** The goal's own name, or a description such as "12 books, every year". */
export function useGoalTitle(): (goal: Goal) => string {
  const { t, plural } = useI18n();
  return (goal) => {
    if (goal.name.trim() !== "") return goal.name;
    // The texts of the units carry no number, the count only picks "book" or "books".
    return `${goal.target} ${plural(goalUnitKey(goal.kind), goal.target)}, ${t(repeatKey(goal.repeat))}`;
  };
}

/** The names of the months or weekdays in the reader's language, short enough for a chart. */
export function monthLetters(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { month: "narrow", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(Date.UTC(2024, month, 15))));
}

export function weekdayNames(locale: string, style: "short" | "long" = "short"): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, day) => {
    const name = format.format(new Date(Date.UTC(2024, 0, 1 + day)));
    return style === "short" ? name.replace(".", "").slice(0, 2) : name.charAt(0).toUpperCase() + name.slice(1);
  });
}

export function monthName(locale: string, year: number, month: number): string {
  const name = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 15)));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}
