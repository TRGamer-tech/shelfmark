"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { waitingCount } from "@/lib/loans";
import { serverProblemKey } from "@/lib/supabase/errors";
import { useAuth } from "./auth";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";
import { Splash } from "./Providers";
import { TimerLine, useTimedBook } from "./timer";
import { Button } from "./ui";

interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  /** Paths that belong to this entry, besides its own. */
  also?: string[];
}

function isActive(item: NavItem, pathname: string): boolean {
  const roots = [item.href, ...(item.also ?? [])];
  return roots.some((root) => (root === "/" ? pathname === "/" : pathname === root || pathname.startsWith(root + "/")));
}

/** The small word that says whether what the reader did is safe on the server. */
export function SaveState() {
  const { t } = useI18n();
  const { status, problem, retry, pending } = useLibrary();
  const [fresh, setFresh] = useState(false);

  // "Saved" is worth showing for a moment after a save, not all day long.
  useEffect(() => {
    if (status !== "saved") return;
    setFresh(true);
    const timer = window.setTimeout(() => setFresh(false), 2500);
    return () => window.clearTimeout(timer);
  }, [status, pending]);

  const state = status === "error" ? "error" : status === "saving" || pending > 0 ? "saving" : status === "saved" ? "saved" : "idle";
  const quiet = state === "idle" || (state === "saved" && !fresh);
  return (
    <div className={`save-state save-${state} ${quiet ? "save-quiet" : ""}`} data-testid="save-state" data-state={state} role="status" aria-live="polite">
      {state === "saving" ? (
        <>
          <span className="save-dot" aria-hidden="true" />
          <span>{t("web_saving")}</span>
        </>
      ) : state === "error" ? (
        <>
          <Icon name="warning" size={18} />
          <span title={problem ? t(serverProblemKey(problem), problem) : undefined}>{t("web_save_failed")}</span>
          <button type="button" className="save-retry" onClick={retry}>
            {t("action_retry")}
          </button>
        </>
      ) : (
        <>
          <Icon name="done" size={18} />
          <span>{t("web_saved")}</span>
        </>
      )}
    </div>
  );
}

/**
 * Says what the link of a mail did, once, in a line that passes, to somebody who
 * arrived through one and is signed in. The confirmation of a new account is not said
 * here: it has a page of its own (/confirmed).
 */
function Welcome() {
  const { t } = useI18n();
  const { welcome, dismissWelcome } = useAuth();
  const { notify } = useLibrary();

  useEffect(() => {
    if (!welcome) return;
    notify(t(welcome === "email_change" ? "web_welcome_email_changed" : welcome === "pending" ? "web_notice_link_pending" : welcome === "failed" ? "web_welcome_link_used" : "web_welcome_signed_in"));
    dismissWelcome();
  }, [welcome, notify, t, dismissWelcome]);

  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const { status, problem, retry, loans } = useLibrary();
  const pathname = usePathname();
  const timed = useTimedBook() !== null;

  if (status === "loading") return <Splash text={t("web_loading")} />;
  if (status === "failed") {
    // Fetched but not understood is another matter than not fetched: the library is not
    // opened, and nothing is written over it until it can be read.
    const unread = problem === "newer" || problem === "unreadable";
    return (
      <main className="plain-page" data-testid="load-failed" data-problem={problem ?? ""}>
        <h1>Shelfmark</h1>
        <h2>{t(unread ? "web_library_closed" : "web_load_failed")}</h2>
        <p data-testid="load-problem">{t(serverProblemKey(problem ?? ""), problem ?? "")}</p>
        <div className="row">
          <Button onClick={retry}>{t("action_retry")}</Button>
          <Button variant="text" onClick={() => void signOut()}>
            {t("account_sign_out")}
          </Button>
        </div>
      </main>
    );
  }

  // Loans that wait for the reader's own word: a question to answer, a hand-over or a return to confirm.
  const waiting = waitingCount(loans);
  const items: NavItem[] = [
    { href: "/", icon: "book", label: t("tab_library"), also: ["/book", "/add"] },
    { href: "/lists", icon: "bookmarks", label: t("tab_lists") },
    { href: "/stats", icon: "chart", label: t("tab_stats") },
    { href: "/quotes", icon: "quote", label: t("tab_quotes") },
    { href: "/friends", icon: "people", label: t("tab_friends") },
  ];
  const settings: NavItem = { href: "/settings", icon: "settings", label: t("settings_title") };

  const link = (item: NavItem, badge = 0) => {
    const active = isActive(item, pathname);
    return (
      <Link key={item.href} href={item.href} className={`nav-link ${active ? "nav-on" : ""}`} aria-current={active ? "page" : undefined} data-testid={`nav-${item.href === "/" ? "shelf" : item.href.slice(1)}`}>
        <span className="nav-icon">
          <Icon name={item.icon} />
          {badge > 0 ? <span className="nav-badge">{badge}</span> : null}
        </span>
        <span className="nav-label">{item.label}</span>
        {badge > 0 ? <span className="sr-only">{t("loans_waiting")}</span> : null}
      </Link>
    );
  };

  return (
    <div className={timed ? "shell shell-timer" : "shell"}>
      <a className="skip-link" href="#content">
        {t("web_skip")}
      </a>
      <nav className="sidebar" aria-label={t("web_menu")}>
        <Link href="/" className="brand">
          Shelfmark
        </Link>
        <div className="sidebar-links">{items.map((item) => link(item, item.href === "/friends" ? waiting : 0))}</div>
        <div className="sidebar-foot">
          <TimerLine />
          {link(settings)}
          <SaveState />
        </div>
      </nav>
      <main id="content" className="content" tabIndex={-1}>
        <Welcome />
        {children}
      </main>
      <div className="save-float">
        <SaveState />
      </div>
      <div className="timer-float">
        <TimerLine />
      </div>
      <nav className="bottombar" aria-label={t("web_menu")}>
        {items.map((item) => link(item, item.href === "/friends" ? waiting : 0))}
      </nav>
    </div>
  );
}
