// Reading dates are days since 1970-01-01 in local time (LocalDate.toEpochDay in the
// app), which keeps them free of time zone surprises. Moments are milliseconds.

const DAY_MS = 86_400_000;

export interface Ymd {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

/** What a moment looks like on the clock of some place. */
export interface ClockParts extends Ymd {
  hour: number;
  /** 1 = Monday to 7 = Sunday, as java.time counts. */
  weekday: number;
}

/** Turns a moment into a local date and time. Tests use UTC, the browser its own zone. */
export interface Zone {
  parts(millis: number): ClockParts;
}

export const utcZone: Zone = {
  parts(millis) {
    const d = new Date(millis);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), weekday: ((d.getUTCDay() + 6) % 7) + 1 };
  },
};

export const localZone: Zone = {
  parts(millis) {
    const d = new Date(millis);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), weekday: ((d.getDay() + 6) % 7) + 1 };
  },
};

export function toEpochDay(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function fromEpochDay(epochDay: number): Ymd {
  const d = new Date(epochDay * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 1 = Monday to 7 = Sunday. */
export function weekdayOf(epochDay: number): number {
  // 1970-01-01 was a Thursday.
  return ((((epochDay + 3) % 7) + 7) % 7) + 1;
}

export function dayOf(millis: number, zone: Zone): number {
  const p = zone.parts(millis);
  return toEpochDay(p.year, p.month, p.day);
}

export function todayIn(zone: Zone, now: number = Date.now()): number {
  return dayOf(now, zone);
}

/** Today as the reader's own calendar has it. */
export function today(): number {
  return todayIn(localZone);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return daysInMonth(year, 2) === 29;
}

/** "2026-11-23", the value of a date field in a form. Empty for no date. */
export function toIsoDate(epochDay: number | null | undefined): string {
  if (epochDay === null || epochDay === undefined) return "";
  const { year, month, day } = fromEpochDay(epochDay);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function fromIsoDate(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  return toEpochDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** The day as people write it, e.g. "23 Nov 2026" or "23.11.2026". */
export function formatDay(epochDay: number | null | undefined, locale: string): string {
  if (epochDay === null || epochDay === undefined) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(epochDay * DAY_MS));
}

export function formatMoment(millis: number, locale: string, withTime = false): string {
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(millis));
}
