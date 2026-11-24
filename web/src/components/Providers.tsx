"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { today } from "@/lib/dates";
import { legalLangOf } from "@/lib/legal";
import { serverConfig } from "@/lib/supabase/config";
import { getVisitor, isHome, setVisitor, setWorld, subscribeVisitor } from "@/lib/visitor";
import { AppShell } from "./AppShell";
import { AuthProvider, useAuth } from "./auth";
import { CoverJobProvider } from "./coverJob";
import { FrontDesk } from "./FrontDesk";
import { I18nProvider, useI18n } from "./i18n";
import { LibraryProvider } from "./library";
import { ShelfPage } from "./ShelfPage";
import { TimerProvider } from "./timer";

/**
 * What is shown while the browser finds out who is here. No words, so no language is
 * needed yet. On the front page it is in the document from the start and the
 * stylesheet shows it only to somebody this browser remembers as signed in.
 */
export function Splash({ text, home = false }: { text?: string; home?: boolean }) {
  return (
    <div className={home ? "splash splash-home" : "splash"} aria-busy="true">
      <p className="splash-name">Shelfmark</p>
      <div className="splash-board" aria-hidden="true" />
      {text ? <p className="splash-text">{text}</p> : null}
    </div>
  );
}

function NotConfigured() {
  const { t } = useI18n();
  useEffect(() => setWorld("front"), []);
  return (
    <FrontDesk testId="not-configured">
      <h1>{t("web_not_configured_title")}</h1>
      <p>{t("web_not_configured_text")}</p>
    </FrontDesk>
  );
}

const PING_KEY = "shelfmark.ping";

/**
 * Once a day the browser of a signed-in reader says hello to the server. A free Supabase
 * project is put to sleep when its database sees nothing for a week, and this is that
 * something. It tells nothing about anyone.
 *
 * A visitor who only looks at the site sends nothing: their browser has no business
 * with the database, and the scheduled job of the site (/api/keepalive) says hello anyway.
 */
function useDailyPing() {
  const { api, status } = useAuth();
  useEffect(() => {
    if (status !== "in") return;
    const day = String(today());
    try {
      if (window.localStorage.getItem(PING_KEY) === day) return;
    } catch {
      return;
    }
    api.ping().then(
      () => {
        try {
          window.localStorage.setItem(PING_KEY, day);
        } catch {
          // Asked again on the next visit, which does no harm.
        }
      },
      () => undefined,
    );
  }, [api, status]);
}

// The pages of the library. Every other address is either one of the open pages below
// or does not exist, and "does not exist" is said to anybody, signed in or not.
const LIBRARY_PATHS = new Set([
  "/add",
  "/add/manual",
  "/book",
  "/book/edit",
  "/book/timer",
  "/friends",
  "/friends/library",
  "/friends/loans",
  // Where borrow requests used to be. It leads to the loans.
  "/friends/requests",
  "/lists",
  "/quotes",
  "/settings",
  "/stats",
  "/stats/calendar",
  "/stats/goals",
  "/stats/milestones",
  "/stats/recap",
]);

function Gate({ home, children }: { home: boolean; children: ReactNode }) {
  const { status, user, recovering, turnedAway, arrivedAtDesk, dueAtConfirmation, arrivedAtConfirmation } = useAuth();
  const pathname = usePathname().replace(/(.)\/+$/, "$1");
  const router = useRouter();
  useDailyPing();

  const onLogin = pathname === "/login";
  const onReset = pathname === "/reset";
  const onConfirmed = pathname === "/confirmed";
  const library = home || LIBRARY_PATHS.has(pathname);
  // Pages anybody may read: signing in, a new password, the confirmation of an address,
  // and "there is no such page".
  const open = !library;
  const signedIn = status === "in" && user !== null;

  // Where this reader belongs instead of here. Null when they are in the right place,
  // or when it is not known yet who they are.
  let heading: string | null = null;
  if (status !== "loading") {
    // The link of a mail comes first: it says where its reader is to end up.
    if (dueAtConfirmation && !onConfirmed) heading = "/confirmed";
    else if (recovering && !onReset) heading = "/reset";
    else if (turnedAway && status === "out" && !onLogin && !onReset) heading = "/login";
    // The front page is for visitors. Everything else of the library asks for a sign-in.
    else if (status === "out" && library && !home) heading = "/login";
    else if (status === "in" && onLogin) heading = "/";
    // The shelf lives at the address of the site itself, in whatever language it was asked for.
    else if (status === "in" && home && pathname !== "/") heading = "/";
  }

  // Replaced, not added: the Back button is not to lead to a page that sends on again.
  useEffect(() => {
    if (heading) router.replace(heading);
  }, [heading, router]);

  // Somebody sent here by the link of a mail has arrived where it is explained.
  useEffect(() => {
    if (turnedAway && onLogin) arrivedAtDesk();
  }, [turnedAway, onLogin, arrivedAtDesk]);
  useEffect(() => {
    if (dueAtConfirmation && onConfirmed) arrivedAtConfirmation();
  }, [dueAtConfirmation, onConfirmed, arrivedAtConfirmation]);

  // The front page is shown or hidden by what the root element says, see lib/visitor.
  // It is said on every page, not only on the front page: whoever signs in on another
  // page and is taken to their shelf must not see the front page on arriving. Somebody
  // on their way to another page is not shown it either.
  useEffect(() => {
    if (status !== "loading") setVisitor(status === "in" || heading ? "in" : "out");
  }, [status, heading]);

  const front = heading ? heading !== "/" : open || (home && status === "out");
  useEffect(() => {
    if (status !== "loading") setWorld(front ? "front" : "app");
  }, [front, status]);

  // The front page is in the language of its address, whatever language the library
  // behind it would speak to this reader. The document has to say so too.
  const landingLang = home && status === "out" && !heading ? (pathname === "/de" ? "de" : "en") : null;
  useEffect(() => {
    if (landingLang) document.documentElement.lang = landingLang;
  }, [landingLang]);

  // Not known yet who is here, or on the way to another page: nothing to show for the
  // blink it takes. Neither the library nor the sign-in page is opened on the way.
  if (status === "loading" || heading) return <Splash home={home} />;
  if (open) return <>{children}</>;
  // A visitor at the address of the site: the front page is theirs, the server drew it.
  if (home && status === "out") return null;
  if (!signedIn) return <Splash home={home} />;
  return (
    <LibraryProvider key={user.id}>
      <TimerProvider userId={user.id}>
        <CoverJobProvider>
          <AppShell>{children}</AppShell>
        </CoverJobProvider>
      </TimerProvider>
    </LibraryProvider>
  );
}

/**
 * The front page as the server drew it. It stays in the document for a visitor and is
 * taken out for somebody who is signed in, whose shelf stands at the same address.
 */
function LandingSlot({ children }: { children: ReactNode }) {
  // The server cannot know who is here, so it draws the page. The browser knows before
  // the first paint, and the stylesheet hides the page until this has caught up.
  const visitor = useSyncExternalStore(subscribeVisitor, getVisitor, () => null);
  if (visitor === "in") return null;
  return <>{children}</>;
}

/**
 * Who is signed in, the language, the theme and the library itself are only known in
 * the browser. So for the pages of the library the server sends a quiet first screen
 * and the real one is drawn once the browser has taken over. The front page is the
 * exception: it is the same for everybody, the server draws all of it, and it is what a
 * visitor sees at the address of the site while the library waits behind it. The
 * imprint and the privacy notice are drawn by the server as well.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const home = isHome(pathname);
  useEffect(() => setMounted(true), []);
  const config = serverConfig();
  // The imprint and the privacy notice are plain pages the server drew. They need no
  // sign-in, no script and no server of their own, and they talk to nobody.
  if (legalLangOf(pathname)) return <>{children}</>;
  return (
    <>
      {home ? <LandingSlot>{children}</LandingSlot> : null}
      {!mounted ? (
        <Splash home={home} />
      ) : (
        <I18nProvider>
          {config ? (
            <AuthProvider config={config}>
              <Gate home={home}>
                <Suspense fallback={<Splash />}>{home ? <ShelfPage /> : children}</Suspense>
              </Gate>
            </AuthProvider>
          ) : home ? (
            <Unconfigured />
          ) : (
            <NotConfigured />
          )}
        </I18nProvider>
      )}
    </>
  );
}

/** A site without a server still has its front page. Whoever this browser took for signed in gets to see it after all. */
function Unconfigured() {
  const german = usePathname().replace(/\/+$/, "") === "/de";
  useEffect(() => {
    setVisitor("out");
    setWorld("front");
    document.documentElement.lang = german ? "de" : "en";
  }, [german]);
  return null;
}
