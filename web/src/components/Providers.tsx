"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { today } from "@/lib/dates";
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
 * Once a day per browser the site says hello to its server. A free Supabase project is
 * put to sleep when its database sees nothing for a week, and this is that something.
 * It needs no sign-in and tells nothing about anyone.
 */
function useDailyPing() {
  const { api } = useAuth();
  useEffect(() => {
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
  }, [api]);
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
  const { status, user, recovering, turnedAway, arrivedAtDesk } = useAuth();
  const pathname = usePathname().replace(/(.)\/+$/, "$1");
  const router = useRouter();
  useDailyPing();

  const onLogin = pathname === "/login";
  const onReset = pathname === "/reset";
  const library = home || LIBRARY_PATHS.has(pathname);
  // Pages anybody may read: signing in, a new password, and "there is no such page".
  const open = !library;
  const signedIn = status === "in" && user !== null;

  useEffect(() => {
    if (status === "loading") return;
    if (recovering && !onReset) router.replace("/reset");
    else if (turnedAway && status === "out" && !onLogin && !onReset) router.replace("/login");
    // The front page is for visitors. Everything else of the library asks for a sign-in.
    else if (status === "out" && library && !home) router.replace("/login");
    else if (status === "in" && onLogin) router.replace("/");
    // The shelf lives at the address of the site itself, in whatever language it was asked for.
    else if (status === "in" && home && pathname !== "/") router.replace("/");
  }, [status, recovering, turnedAway, onLogin, onReset, library, home, pathname, router]);

  // Somebody sent here by a link that did not work has arrived where it is explained.
  useEffect(() => {
    if (turnedAway && onLogin) arrivedAtDesk();
  }, [turnedAway, onLogin, arrivedAtDesk]);

  // The front page is shown or hidden by what the root element says, see lib/visitor.
  // Somebody on their way to the sign-in page or to a new password is not shown it either.
  const passingThrough = recovering || turnedAway;
  useEffect(() => {
    if (!home || status === "loading") return;
    setVisitor(status === "in" || passingThrough ? "in" : "out");
  }, [home, status, passingThrough]);

  const front = open || (home && status === "out" && !passingThrough);
  useEffect(() => {
    if (status !== "loading") setWorld(front ? "front" : "app");
  }, [front, status]);

  // The front page is in the language of its address, whatever language the library
  // behind it would speak to this reader. The document has to say so too.
  const landingLang = home && status === "out" && !passingThrough ? (pathname === "/de" ? "de" : "en") : null;
  useEffect(() => {
    if (landingLang) document.documentElement.lang = landingLang;
  }, [landingLang]);

  if (status === "loading") return <Splash home={home} />;
  if (open && !(onLogin && status === "in")) return <>{children}</>;
  if (home && status === "out" && !passingThrough) return null;
  // On the way to another page: nothing to show for the blink it takes. That includes
  // somebody who came for a new password: the library is not opened on the way there.
  if (!signedIn || onLogin || recovering || (home && pathname !== "/")) return <Splash home={home} />;
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
 * visitor sees at the address of the site while the library waits behind it.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const home = isHome(usePathname());
  useEffect(() => setMounted(true), []);
  const config = serverConfig();
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
