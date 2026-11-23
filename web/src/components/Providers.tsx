"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { today } from "@/lib/dates";
import { serverConfig } from "@/lib/supabase/config";
import { AppShell } from "./AppShell";
import { AuthProvider, useAuth } from "./auth";
import { I18nProvider, useI18n } from "./i18n";
import { LibraryProvider } from "./library";
import { RememberedTheme } from "./theme";

/** What is shown while the browser finds out who is here. No words, so no language is needed yet. */
export function Splash({ text }: { text?: string }) {
  return (
    <div className="splash" aria-busy="true">
      <p className="splash-name">Shelfmark</p>
      <div className="splash-board" aria-hidden="true" />
      {text ? <p className="splash-text">{text}</p> : null}
    </div>
  );
}

function NotConfigured() {
  const { t } = useI18n();
  return (
    <main className="plain-page" data-testid="not-configured">
      <RememberedTheme />
      <h1>Shelfmark</h1>
      <h2>{t("web_not_configured_title")}</h2>
      <p>{t("web_not_configured_text")}</p>
    </main>
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

function Gate({ children }: { children: ReactNode }) {
  const { status, user, recovering } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  useDailyPing();

  const onLogin = pathname === "/login";
  const onReset = pathname === "/reset";

  useEffect(() => {
    if (status === "loading") return;
    if (recovering && !onReset) router.replace("/reset");
    else if (status === "out" && !onLogin && !onReset) router.replace("/login");
    else if (status === "in" && onLogin) router.replace("/");
  }, [status, recovering, onLogin, onReset, router]);

  if (status === "loading") return <Splash />;
  if (onReset || (status === "out" && onLogin)) {
    return (
      <>
        <RememberedTheme />
        {children}
      </>
    );
  }
  // On the way to another page: nothing to show for the blink it takes.
  if (status === "out" || onLogin || !user) return <Splash />;
  return (
    <LibraryProvider key={user.id}>
      <AppShell>{children}</AppShell>
    </LibraryProvider>
  );
}

/**
 * Everything on this site happens in the browser: who is signed in, the language, the
 * theme and the library itself are only known there. So the server sends a quiet first
 * page and the real one is drawn once the browser has taken over.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Splash />;
  const config = serverConfig();
  return (
    <I18nProvider>
      {config ? (
        <AuthProvider config={config}>
          <Gate>
            <Suspense fallback={<Splash />}>{children}</Suspense>
          </Gate>
        </AuthProvider>
      ) : (
        <NotConfigured />
      )}
    </I18nProvider>
  );
}
