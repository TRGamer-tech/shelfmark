"use client";

import { useEffect, useState } from "react";
import type { CustomTheme } from "@/lib/model";
import { THEME_SYSTEM, customThemeCodec } from "@/lib/model";
import { paletteOf, presetFor } from "@/lib/theme";

const PALETTE_KEY = "shelfmark.palette";
const CHOICE_KEY = "shelfmark.theme";

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setDark(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return dark;
}

function apply(palette: Record<string, string>): void {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(palette)) style.setProperty(name, value);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette["--bg"]);
}

interface Choice {
  theme: string;
  customThemes: CustomTheme[];
}

function rememberedChoice(): Choice {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CHOICE_KEY) ?? "null");
    if (raw && typeof raw.theme === "string" && Array.isArray(raw.customThemes)) {
      return { theme: raw.theme, customThemes: raw.customThemes.map((t: unknown) => customThemeCodec.read(t)) };
    }
  } catch {
    // Nothing remembered that can be read: the default will do.
  }
  return { theme: THEME_SYSTEM, customThemes: [] };
}

/**
 * Paints the page in a theme. The theme lives in the library, so it is the same on
 * every device. This browser only remembers the last one, so that the sign-in page and
 * the first moment of the next visit do not flash in other colours.
 */
export function useAppliedTheme(theme: string, customThemes: CustomTheme[], remember: boolean): void {
  const systemDark = useSystemDark();
  useEffect(() => {
    const palette = paletteOf(presetFor(theme, systemDark, customThemes));
    apply(palette);
    try {
      window.localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
      if (remember) window.localStorage.setItem(CHOICE_KEY, JSON.stringify({ theme, customThemes }));
    } catch {
      // Without storage the theme simply arrives a moment later next time.
    }
  }, [theme, customThemes, systemDark, remember]);
}

/** For the pages outside the library: the theme this browser saw last. */
export function RememberedTheme() {
  const [choice] = useState(rememberedChoice);
  useAppliedTheme(choice.theme, choice.customThemes, false);
  return null;
}

/**
 * Runs before the page is painted and puts the remembered colours in place, so that a
 * dark shelf does not open with a white flash. Kept tiny and free of anything that
 * could fail loudly.
 */
export const THEME_SCRIPT = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(PALETTE_KEY)})||"null");if(p){var s=document.documentElement.style;for(var k in p)s.setProperty(k,p[k])}}catch(e){}`;
