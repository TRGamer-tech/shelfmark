"use client";

// A stopwatch for a reading session (ui/detail/TimerScreen.kt in the app). It keeps
// counting while another page is open, and while the browser is closed.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LogSessionDialog } from "@/components/BookDialogs";
import { Icon } from "@/components/icons";
import { useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { TimerLine, useNow, useTimer } from "@/components/timer";
import { Button, EmptyHint, PageHead } from "@/components/ui";
import { elapsedSeconds, formatClock, isRunning, minutesOf, ringDegrees, toggled } from "@/lib/timer";

const SIZE = 240;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const AROUND = 2 * Math.PI * RADIUS;

export default function TimerPage() {
  const { t } = useI18n();
  const { vault } = useLibrary();
  const router = useRouter();
  const id = Number(useSearchParams().get("id"));
  const book = vault.books.find((b) => b.id === id);
  const { timer: current, setTimer } = useTimer();
  // There is one timer. When it runs for another book, this page starts from nothing.
  const timer = current && current.bookId === id ? current : null;
  const running = isRunning(timer);
  const now = useNow(running);
  const [logging, setLogging] = useState(false);

  if (!book) {
    return (
      <div className="page">
        <EmptyHint>{t("web_book_missing")}</EmptyHint>
        <Link href="/" className="btn btn-text">
          {t("web_to_shelf")}
        </Link>
      </div>
    );
  }

  const elapsed = timer ? elapsedSeconds(timer, now) : 0;
  const degrees = ringDegrees(elapsed);
  const back = `/book?id=${book.id}`;

  return (
    <div className="page" data-testid="timer-page">
      <PageHead title={t("timer_title")} back={back} />
      <div className="timer">
        <h2 className="timer-book" data-testid="timer-book">
          {book.title}
        </h2>
        {current && current.bookId !== id ? <TimerLine always /> : null}
        <div className="timer-ring">
          {/* The ring completes once a minute, a quiet sign that the clock is running. */}
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
            <circle className="timer-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} />
            {degrees > 0 ? <circle className="timer-arc" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${(AROUND * degrees) / 360} ${AROUND}`} /> : null}
          </svg>
          <div className="timer-clock" role="timer" data-testid="timer-clock">
            {formatClock(elapsed)}
          </div>
        </div>
        <button
          type="button"
          className="timer-toggle"
          aria-label={t(running ? "timer_pause" : "timer_start")}
          title={t(running ? "timer_pause" : "timer_start")}
          onClick={() => setTimer(toggled(timer, book.id, book.currentPage, Date.now()))}
          data-testid="timer-toggle"
          data-running={running}
        >
          <Icon name={running ? "pause" : "play"} size={40} />
        </button>
        <div className="row timer-actions">
          <Button variant="outline" disabled={!timer} onClick={() => setTimer(null)} data-testid="timer-discard">
            {t("timer_discard")}
          </Button>
          <Button disabled={!timer || elapsed < 1} onClick={() => setLogging(true)} data-testid="timer-stop">
            {t("timer_stop_and_log")}
          </Button>
        </div>
      </div>
      {logging && timer ? (
        <LogSessionDialog
          book={book}
          presetMinutes={minutesOf(elapsed)}
          startedAt={timer.startedAt}
          onClose={() => setLogging(false)}
          onSaved={() => {
            setTimer(null);
            router.push(back);
          }}
        />
      ) : null}
    </div>
  );
}
