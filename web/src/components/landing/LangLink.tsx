"use client";

// The language switch of the front page. Each language has an address of its own, so it
// is a plain link and works without scripts. With them it also remembers the choice:
// the bare address of the site takes a German reader to the German page, and somebody
// who asked for English there must not be sent back.

import type { ReactNode } from "react";
import type { Lang } from "@/i18n/index";
import { rememberLang } from "../i18n";

export function LangLink({ lang, current, children }: { lang: Lang; current: boolean; children: ReactNode }) {
  return (
    <a href={lang === "de" ? "/de" : "/"} hrefLang={lang} lang={lang} aria-current={current ? "true" : undefined} onClick={() => rememberLang(lang)} data-testid={`front-lang-${lang}`}>
      {children}
    </a>
  );
}
