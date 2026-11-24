"use client";

// How the reader is told things: by a notice at the foot of the page, and, for news that
// comes in while the page is not in front, by a notification of the browser if the
// reader allowed that. The rules are in lib/notices.ts, lib/news.ts and
// lib/browserNotices.ts. This is where they meet the page and the browser.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationMaker, NotifyState, Offer, Permission } from "@/lib/browserNotices";
import { BrowserNotices, CANNOT_NOTIFY, askPermission, canNotify, looksNow, offerOf, permissionNow, tellsBrowser } from "@/lib/browserNotices";
import { formatDay } from "@/lib/dates";
import type { News, Words } from "@/lib/news";
import type { Notice } from "@/lib/notices";
import { stayOf, withNotice, withoutAbout, withoutNotice } from "@/lib/notices";
import { useI18n } from "./i18n";

/** Whether the reader put the card about notifications away, in this browser. Not tied to an account. */
const PUT_AWAY_KEY = "shelfmark.notify";

/**
 * The name of the lock a tab holds while it is in front, for the other tabs of this
 * browser to see. A lock is nothing that is kept: it is gone with the tab.
 */
const FRONT_LOCK = "shelfmark-front";

function putAwayBefore(): boolean {
  try {
    return window.localStorage.getItem(PUT_AWAY_KEY) !== null;
  } catch {
    return false;
  }
}

const isVisible = () => document.visibilityState === "visible";

/** Whether another tab of Shelfmark in this browser is in front right now. A browser that cannot say counts as: none. */
async function frontElsewhere(): Promise<boolean> {
  try {
    if (!navigator.locks) return false;
    const state = await navigator.locks.query();
    return (state.held ?? []).some((lock) => lock.name === FRONT_LOCK);
  } catch {
    return false;
  }
}

export interface Telling {
  notices: Notice[];
  /** Says something in a line that passes. */
  notify: (text: string, more?: { about?: string; detail?: string; href?: string }) => void;
  /** Tells a piece of news: in the page, and by the browser while the page is not in front. */
  tell: (news: News) => void;
  /** Takes back whatever was said about something, in the page and by the browser. */
  unsay: (about: string) => void;
  /** Takes one notice off the page: its time is up, or the reader followed it. */
  dismiss: (id: number) => void;
  /** What the friends and loans pages show about notifications of the browser. */
  offer: Offer;
  /** Asks the browser for the permission. Only from a click. */
  allowNotifications: () => Promise<Permission>;
  /** "Not now": the card is put away for this browser. */
  putOfferAway: () => void;
  /** Whether this tab should look at the server now: always in front, and behind only to tell the browser. */
  mayLook: () => Promise<boolean>;
}

export function useTelling(): Telling {
  const { t, lang, locale } = useI18n();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [state, setState] = useState<NotifyState>(CANNOT_NOTIFY);
  const [putAway, setPutAway] = useState(true);
  const stateRef = useRef<NotifyState>(CANNOT_NOTIFY);
  // Whether the browser can do it is found out once for the page. Whether it may can change at any time.
  const able = useRef<boolean | null>(null);
  // The notices whose time is running. A notice put up while the page cannot be seen waits for the reader.
  const timers = useRef(new Map<number, number>());
  const noticesRef = useRef<Notice[]>([]);
  noticesRef.current = notices;
  const say = useRef({ t, locale });
  say.current = { t, locale };

  const readState = useCallback((): NotifyState => {
    able.current ??= canNotify(window);
    const next: NotifyState = able.current ? { supported: true, permission: permissionNow(window) } : CANNOT_NOTIFY;
    if (next.supported !== stateRef.current.supported || next.permission !== stateRef.current.permission) {
      stateRef.current = next;
      setState(next);
    }
    return next;
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setNotices((current) => withoutNotice(current, id));
  }, []);

  /** Starts the time of a notice, which only runs while the page can be seen. */
  const arm = useCallback(
    (notice: Notice) => {
      if (timers.current.has(notice.id)) return;
      timers.current.set(
        notice.id,
        window.setTimeout(() => dismiss(notice.id), stayOf(notice)),
      );
    },
    [dismiss],
  );

  const browser = useMemo(
    () =>
      new BrowserNotices(typeof window !== "undefined" && "Notification" in window ? (window.Notification as unknown as NotificationMaker) : null, lang, (shown) => {
        // The reader followed the notification: the tab comes to the front on the page it
        // is about, and the page does not say the same once more.
        window.focus();
        setNotices((current) => withoutAbout(current, shown.about));
        router.push(shown.href);
      }),
    [lang, router],
  );
  // A page that goes away takes its notifications with it: nothing would answer a click on them.
  useEffect(() => {
    const leave = () => browser.closeAll();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [browser]);

  const notify = useCallback(
    (text: string, more: { about?: string; detail?: string; href?: string } = {}) => {
      const notice: Notice = { id: Date.now() + Math.random(), text, ...more };
      setNotices((current) => withNotice(current, notice));
      if (isVisible()) arm(notice);
    },
    [arm],
  );

  const words = useCallback((said: Words | undefined): string => {
    if (!said) return "";
    return say.current.t(said.key, ...said.args.map((arg) => (typeof arg === "string" ? arg : formatDay(arg.day, say.current.locale))));
  }, []);

  const tell = useCallback(
    (news: News) => {
      const title = words(news.title);
      const detail = words(news.detail);
      notify(title, { about: news.about, detail: detail !== "" ? detail : undefined, href: news.href });
      if (tellsBrowser(readState(), isVisible())) {
        browser.show({ about: news.about, title, body: [detail, words(news.away)].filter((line) => line !== "").join(" "), href: news.href });
      }
    },
    [browser, notify, words, readState],
  );

  const unsay = useCallback(
    (about: string) => {
      setNotices((current) => withoutAbout(current, about));
      browser.close(about);
    },
    [browser],
  );

  // What the browser can and may do is read when the page comes up and whenever it
  // comes back to the front: the reader may have changed it in the settings of the browser.
  useEffect(() => {
    readState();
    setPutAway(putAwayBefore());
    // While the tab is in front it holds a lock, for the other tabs of this browser to
    // see. The browser lets go of it by itself should the tab close.
    let release: (() => void) | null = null;
    let asking = false;
    let over = false;
    const hold = () => {
      if (release || asking || !navigator.locks) return;
      asking = true;
      void navigator.locks
        .request(
          FRONT_LOCK,
          { mode: "shared" },
          () =>
            new Promise<void>((resolve) => {
              asking = false;
              // Behind again, or gone, before the lock came: it is given straight back.
              if (over || !isVisible()) resolve();
              else release = resolve;
            }),
        )
        .catch(() => {
          asking = false;
        });
    };
    const front = () => {
      if (isVisible()) {
        readState();
        // In front again. The notices that waited start their time, and what the browser
        // put up goes: the page says the same.
        for (const notice of noticesRef.current) arm(notice);
        browser.closeAll();
        hold();
      } else if (release) {
        release();
        release = null;
      }
    };
    const refresh = () => void readState();
    front();
    document.addEventListener("visibilitychange", front);
    window.addEventListener("focus", refresh);
    const running = timers.current;
    return () => {
      over = true;
      document.removeEventListener("visibilitychange", front);
      window.removeEventListener("focus", refresh);
      release?.();
      for (const timer of running.values()) window.clearTimeout(timer);
      running.clear();
    };
  }, [arm, browser, readState]);

  const allowNotifications = useCallback(async () => {
    const answer = await askPermission(window);
    readState();
    return answer;
  }, [readState]);

  const putOfferAway = useCallback(() => {
    setPutAway(true);
    try {
      window.localStorage.setItem(PUT_AWAY_KEY, "later");
    } catch {
      // Not remembered then: the card comes back with the next visit.
    }
  }, []);

  const mayLook = useCallback(async () => {
    if (isVisible()) return true;
    const current = readState();
    // The other tabs are asked only when it matters: a tab that could not tell the browser anything does not look.
    if (!looksNow(current, false, false)) return false;
    return looksNow(current, false, await frontElsewhere());
  }, [readState]);

  return { notices, notify, tell, unsay, dismiss, offer: offerOf(state, putAway), allowNotifications, putOfferAway, mayLook };
}

/** The notices at the foot of the page. One that leads somewhere is a link, and following it takes it away. */
export function Notices({ notices, onFollow }: { notices: Notice[]; onFollow: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {notices.map((notice) => {
        const body = (
          <>
            <span className="toast-text">{notice.text}</span>
            {notice.detail ? <span className="toast-detail">{notice.detail}</span> : null}
          </>
        );
        return notice.href ? (
          <Link key={notice.id} href={notice.href} className="toast toast-link" onClick={() => onFollow(notice.id)} data-about={notice.about}>
            {body}
          </Link>
        ) : (
          <div key={notice.id} className="toast" data-about={notice.about}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
