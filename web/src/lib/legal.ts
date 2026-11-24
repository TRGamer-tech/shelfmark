// The addresses of the imprint and the privacy notice. Each language has its own, in
// its own words, so that the address says what the page is to whoever reads it.

export type LegalKind = "imprint" | "privacy";
type Lang = "en" | "de";

export const LEGAL_PATHS: Record<Lang, Record<LegalKind, string>> = {
  en: { imprint: "/imprint", privacy: "/privacy" },
  de: { imprint: "/de/impressum", privacy: "/de/datenschutz" },
};

/** The day the privacy notice was last brought in line with what the code does, as year, month, day. */
export const PRIVACY_AS_OF = "2026-11-24";

/** The language of one of these pages, told from its address. Null for every other address. */
export function legalLangOf(pathname: string): Lang | null {
  const path = pathname.replace(/\/+$/, "");
  for (const lang of ["en", "de"] as const) {
    if (Object.values(LEGAL_PATHS[lang]).includes(path)) return lang;
  }
  return null;
}
