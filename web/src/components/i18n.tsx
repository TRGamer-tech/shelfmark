"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Lang } from "@/i18n/index";
import { langOf, localeOf, pluralise, translate } from "@/i18n/index";

const STORAGE_KEY = "shelfmark.lang";

interface I18n {
  lang: Lang;
  /** How dates and numbers are written, e.g. "de-CH". */
  locale: string;
  setLang: (lang: Lang) => void;
  t: (key: string, ...args: (string | number)[]) => string;
  plural: (key: string, count: number, ...args: (string | number)[]) => string;
}

const Context = createContext<I18n | null>(null);

/** Remembers the language in this browser. Not being able to is no reason to complain. */
export function rememberLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not remembered then, but it still applies until the page is closed.
  }
}

function initialLang(): Lang {
  // A link from the front page says which language it was read in ("?lang=de"), so that
  // the sign-in page goes on in the same one.
  const asked = new URLSearchParams(window.location.search).get("lang");
  if (asked === "en" || asked === "de") {
    rememberLang(asked);
    return asked;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "de") return stored;
  } catch {
    // Storage may be switched off. The language of the browser will do.
  }
  return langOf(navigator.language);
}

/**
 * The language is the one thing that stays with the browser: default from it, remembered
 * in it. The front page is the exception: its language is the one of its address, so
 * there it is given ([fixed]) and nothing is looked up or remembered.
 */
export function I18nProvider({ children, fixed }: { children: ReactNode; fixed?: Lang }) {
  const [chosen, setLangState] = useState<Lang>(() => fixed ?? initialLang());
  const lang = fixed ?? chosen;

  useEffect(() => {
    if (!fixed) document.documentElement.lang = lang;
  }, [lang, fixed]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    rememberLang(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      // On the front page the server draws first and knows no browser, so it does not ask for one.
      locale: localeOf(lang, fixed || typeof navigator === "undefined" ? null : navigator.language),
      setLang,
      t: (key, ...args) => translate(lang, key, ...args),
      plural: (key, count, ...args) => pluralise(lang, key, count, ...args),
    }),
    [lang, setLang],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n needs an I18nProvider above it");
  return value;
}

/** "3 h 20 min" or "45 min". */
export function useDuration(): (minutes: number) => string {
  const { t } = useI18n();
  return (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? t("duration_h_min", h, m) : t("duration_min", m);
  };
}
