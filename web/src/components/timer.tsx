"use client";

// The reading timer of this browser: which book it runs for, since when, and how much
// was counted before the last pause. It is kept in the browser's own storage, so it goes
// on counting through another page, a reload and a closed tab, and it is not part of
// the library: a stopwatch on this screen means nothing on another device.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Book } from "@/lib/model";
import type { TimerState } from "@/lib/timer";
import { elapsedSeconds, formatClock, isRunning, readTimer, writeTimer } from "@/lib/timer";
import { Icon } from "./icons";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";

interface Timer {
  timer: TimerState | null;
  /** Null stops and forgets the timer. */
  setTimer: (next: TimerState | null) => void;
}

const Context = createContext<Timer | null>(null);

export function useTimer(): Timer {
  const value = useContext(Context);
  if (!value) throw new Error("useTimer needs a TimerProvider above it");
  return value;
}

function stored(key: string): TimerState | null {
  try {
    return readTimer(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function TimerProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { vault, status } = useLibrary();
  // Every account its own: whoever signs in next on this browser has other books.
  const key = `shelfmark.timer.${userId}`;
  const [timer, setState] = useState<TimerState | null>(() => stored(key));

  const setTimer = useCallback(
    (next: TimerState | null) => {
      setState(next);
      try {
        if (next) window.localStorage.setItem(key, writeTimer(next));
        else window.localStorage.removeItem(key);
      } catch {
        // Without storage the timer still runs, only not through a reload.
      }
    },
    [key],
  );

  // Another tab of this browser started, paused or stopped the timer.
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key) setState(readTimer(event.newValue));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);

  // A timer for a book that is no longer in the library has nothing left to count for.
  const loaded = status !== "loading" && status !== "failed";
  const orphaned = loaded && timer !== null && !vault.books.some((book) => book.id === timer.bookId);
  useEffect(() => {
    if (orphaned) setTimer(null);
  }, [orphaned, setTimer]);

  const value = useMemo(() => ({ timer, setTimer }), [timer, setTimer]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The present moment, looked at twice a second while [active], as the app does. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(tick);
  }, [active]);
  return now;
}

/**
 * The book a timer is on for, when this page should say so. The timer pages show the
 * clock themselves, every other page gets the line. Null when there is nothing to say.
 */
export function useTimedBook(always = false): Book | null {
  const { timer } = useTimer();
  const { vault } = useLibrary();
  const pathname = usePathname();
  if (!timer) return null;
  if (!always && pathname.replace(/\/$/, "") === "/book/timer") return null;
  return vault.books.find((b) => b.id === timer.bookId) ?? null;
}

/** A small line that says a timer is running (or paused) and leads back to it. */
export function TimerLine({ always = false }: { always?: boolean }) {
  const { t } = useI18n();
  const { timer } = useTimer();
  const book = useTimedBook(always);
  const now = useNow(isRunning(timer));
  if (!timer || !book) return null;
  const clock = formatClock(elapsedSeconds(timer, now));
  const running = isRunning(timer);
  return (
    <Link
      href={`/book/timer?id=${book.id}`}
      className={`timer-line ${running ? "timer-line-running" : ""}`}
      aria-label={`${t("timer_title")}: ${book.title}, ${clock}${running ? "" : ` (${t("timer_pause")})`}`}
      data-testid="timer-line"
      data-running={running}
    >
      <Icon name={running ? "timer" : "pause"} size={18} />
      <span className="timer-line-title">{book.title}</span>
      <span className="timer-line-clock">{clock}</span>
    </Link>
  );
}
