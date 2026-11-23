"use client";

// The frame of the pages a visitor meets before they are signed in, other than the
// front page itself: signing in, a new password, the confirmation of an address, "there
// is no such page" and a site without a server. They share the look of the front page:
// the reading room at closing time, dark wood under a lamp, and paper where something
// is read or filled in.

import type { ReactNode } from "react";
import { LANGS } from "@/i18n/index";
import { useI18n } from "./i18n";
import { LegalLinks } from "./LegalLinks";

/** The choice of language, where the front page has it: at the top, on the right. */
export function LangButtons() {
  const { t, lang, setLang } = useI18n();
  return (
    <span className="front-langs" role="group" aria-label={t("settings_language")}>
      {LANGS.map((code) => (
        <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)} lang={code} data-testid={`lang-${code}`}>
          {t(`web_language_${code}`)}
        </button>
      ))}
    </span>
  );
}

export function FrontDesk({ children, testId, aside }: { children: ReactNode; testId?: string; aside?: ReactNode }) {
  const { lang } = useI18n();
  return (
    <div className="front desk" data-testid={testId}>
      <header className="front-head">
        {/* A plain link: the front page is a page of its own, drawn by the server. */}
        <a className="wordmark" href="/">
          Shelfmark
        </a>
        {aside ? <div className="front-nav">{aside}</div> : null}
      </header>
      <main className="desk-main">{children}</main>
      <footer className="desk-foot">
        <LegalLinks lang={lang} />
      </footer>
    </div>
  );
}
