// The texts of the website in English and German. Most are the texts of the Android
// app, so both say the same things in the same words.

import { plurals as appPluralsDe, strings as appDe } from "./app-de.ts";
import { plurals as appPluralsEn, strings as appEn } from "./app-en.ts";
import { plurals as webPluralsDe, strings as webDe } from "./web-de.ts";
import { plurals as webPluralsEn, strings as webEn } from "./web-en.ts";

export type Lang = "en" | "de";
export const LANGS: Lang[] = ["en", "de"];

export const STRINGS: Record<Lang, Record<string, string>> = {
  en: { ...appEn, ...webEn },
  de: { ...appDe, ...webDe },
};

export const PLURALS: Record<Lang, Record<string, { one: string; other: string }>> = {
  en: { ...appPluralsEn, ...webPluralsEn },
  de: { ...appPluralsDe, ...webPluralsDe },
};

/** Fills the placeholders of the app's texts: %1$s, %2$d, and plain %s or %d in order. */
export function format(template: string, args: (string | number)[]): string {
  let next = 0;
  return template.replace(/%(?:(\d+)\$)?([sd%])/g, (whole, position: string | undefined, kind: string) => {
    if (kind === "%") return "%";
    const index = position ? Number(position) - 1 : next++;
    const value = args[index];
    return value === undefined ? whole : String(value);
  });
}

export function translate(lang: Lang, key: string, ...args: (string | number)[]): string {
  const template = STRINGS[lang][key] ?? STRINGS.en[key];
  // A missing text shows its key, which is ugly enough to be noticed and fixed.
  if (template === undefined) return key;
  return format(template, args);
}

/** A text that depends on a number: "1 book", "3 books". The number is the first placeholder. */
export function pluralise(lang: Lang, key: string, count: number, ...args: (string | number)[]): string {
  const forms = PLURALS[lang][key] ?? PLURALS.en[key];
  if (!forms) return key;
  return format(count === 1 ? forms.one : forms.other, [count, ...args]);
}

/** The language of the browser when the reader has not chosen one. */
export function langOf(tag: string | null | undefined): Lang {
  return (tag ?? "").toLowerCase().startsWith("de") ? "de" : "en";
}

/** How dates and numbers are written. Swiss German for German, the browser's own English otherwise. */
export function localeOf(lang: Lang, browser: string | null | undefined): string {
  const tag = browser ?? "";
  if (lang === "de") return tag.toLowerCase().startsWith("de") ? tag : "de-CH";
  return tag.toLowerCase().startsWith("en") ? tag : "en-GB";
}
