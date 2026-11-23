// The reading timer: a stopwatch for one reading session (TimerState in the app's
// SettingsRepository.kt and the logic of ui/detail/TimerScreen.kt).
//
// There is one timer at a time, for one book. It is kept in the browser, not in the
// library: a stopwatch that runs on this screen is of no use on another device.

export interface TimerState {
  bookId: number;
  /** Set while running: when the current run began (milliseconds since 1970). */
  runningSince: number | null;
  /** Seconds collected in earlier runs, before pauses. */
  accumulatedSeconds: number;
  /** When the timer was first started. This becomes the start of the session that is logged. */
  startedAt: number;
  /** The page the book was on when the timer was started. */
  startPage: number;
}

export function isRunning(timer: TimerState | null): boolean {
  return timer !== null && timer.runningSince !== null;
}

export function elapsedSeconds(timer: TimerState, now: number): number {
  // A clock that was set back in the meantime must not make the timer run backwards.
  const current = timer.runningSince === null ? 0 : Math.max(0, Math.floor((now - timer.runningSince) / 1000));
  return timer.accumulatedSeconds + current;
}

/** What the round button does: start a new timer, pause a running one, or go on with a paused one. */
export function toggled(timer: TimerState | null, bookId: number, currentPage: number, now: number): TimerState {
  if (timer === null || timer.bookId !== bookId) return { bookId, runningSince: now, accumulatedSeconds: 0, startedAt: now, startPage: currentPage };
  if (timer.runningSince !== null) return { ...timer, runningSince: null, accumulatedSeconds: elapsedSeconds(timer, now) };
  return { ...timer, runningSince: now };
}

/** The minutes the session form starts with: what the clock shows, rounded, and never less than one. */
export function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

const two = (n: number) => String(n).padStart(2, "0");

/** "01:05:09" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** How far round the ring is, in degrees: it completes once a minute, a quiet sign that the clock is running. */
export function ringDegrees(seconds: number): number {
  return (Math.max(0, Math.floor(seconds)) % 60) * 6;
}

// ---- kept in the browser ----

const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** Reads what [writeTimer] wrote. Anything else, or nothing, is no timer. */
export function readTimer(text: string | null | undefined): TimerState | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { bookId, runningSince, accumulatedSeconds, startedAt, startPage } = raw as Record<string, unknown>;
  if (!whole(bookId) || !whole(startedAt) || startedAt <= 0) return null;
  if (runningSince !== null && !(whole(runningSince) && runningSince > 0)) return null;
  return {
    bookId,
    runningSince,
    accumulatedSeconds: whole(accumulatedSeconds) && accumulatedSeconds > 0 ? accumulatedSeconds : 0,
    startedAt,
    startPage: whole(startPage) && startPage > 0 ? startPage : 0,
  };
}

export function writeTimer(timer: TimerState): string {
  return JSON.stringify({ bookId: timer.bookId, runningSince: timer.runningSince, accumulatedSeconds: timer.accumulatedSeconds, startedAt: timer.startedAt, startPage: timer.startPage });
}
