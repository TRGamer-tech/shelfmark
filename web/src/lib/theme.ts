// Colour themes (ui/theme/Theme.kt). A theme is four colours, everything else is mixed
// from them.

import type { CustomTheme } from "./model.ts";
import { CUSTOM_THEME_PREFIX } from "./model.ts";

export type Rgb = [number, number, number];

export interface ThemePreset {
  key: string;
  name: string;
  background: Rgb;
  card: Rgb;
  accent: Rgb;
  text: Rgb;
}

/** The 18 themes of the app, same keys and colours. */
export const THEME_PRESETS: ThemePreset[] = [
  { key: "ember", name: "Ember", background: [31, 26, 23], card: [44, 38, 34], accent: [229, 135, 63], text: [240, 234, 228] },
  { key: "forest", name: "Forest", background: [14, 24, 19], card: [24, 38, 30], accent: [143, 191, 138], text: [227, 236, 228] },
  { key: "midnight", name: "Midnight", background: [13, 18, 32], card: [24, 32, 58], accent: [217, 180, 74], text: [232, 230, 223] },
  { key: "plum", name: "Plum Night", background: [33, 22, 48], card: [47, 34, 68], accent: [190, 154, 240], text: [242, 236, 250] },
  { key: "deepsea", name: "Deep Sea", background: [16, 27, 50], card: [27, 42, 72], accent: [112, 172, 240], text: [230, 236, 246] },
  { key: "ocean", name: "Ocean", background: [12, 26, 31], card: [21, 40, 47], accent: [79, 179, 191], text: [226, 238, 240] },
  { key: "mocha", name: "Mocha", background: [33, 25, 21], card: [47, 37, 32], accent: [210, 166, 121], text: [240, 230, 220] },
  { key: "cocoa", name: "Cocoa", background: [42, 29, 23], card: [58, 41, 33], accent: [238, 162, 98], text: [246, 234, 222] },
  { key: "graphite", name: "Graphite", background: [18, 18, 18], card: [30, 30, 30], accent: [158, 197, 255], text: [242, 242, 242] },
  { key: "paper", name: "Paper", background: [245, 241, 234], card: [255, 255, 255], accent: [200, 105, 44], text: [43, 39, 35] },
  { key: "peach", name: "Peach", background: [251, 236, 226], card: [255, 250, 246], accent: [226, 120, 64], text: [52, 36, 28] },
  { key: "lavender", name: "Lavender", background: [244, 238, 248], card: [252, 250, 254], accent: [176, 92, 206], text: [45, 35, 56] },
  { key: "rose", name: "Rose", background: [251, 240, 242], card: [255, 255, 255], accent: [207, 86, 121], text: [53, 36, 42] },
  { key: "slate", name: "Slate", background: [236, 239, 244], card: [255, 255, 255], accent: [63, 111, 181], text: [31, 39, 51] },
  { key: "sage", name: "Sage", background: [236, 242, 234], card: [252, 255, 251], accent: [86, 140, 90], text: [32, 44, 34] },
  { key: "sky", name: "Sky", background: [234, 243, 250], card: [255, 255, 255], accent: [52, 140, 210], text: [28, 40, 54] },
  { key: "sand", name: "Sand", background: [244, 236, 222], card: [253, 250, 244], accent: [176, 120, 60], text: [52, 42, 30] },
  { key: "mint", name: "Mint", background: [232, 246, 242], card: [252, 255, 254], accent: [38, 160, 140], text: [26, 46, 42] },
];

// ---- colour arithmetic ----

/** An ARGB integer as Android keeps it (signed) to its red, green and blue. */
export function rgbOfArgb(argb: number): Rgb {
  const value = argb >>> 0;
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Red, green and blue to an opaque ARGB integer, signed as on Android. */
export function argbOfRgb(rgb: Rgb): number {
  return (0xff000000 | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) | 0;
}

/** "#1F1A17" for a colour, the way people write them. */
export function hexOf(argb: number): string {
  return "#" + ((argb >>> 0) & 0xffffff).toString(16).toUpperCase().padStart(6, "0");
}

/** Reads "#1F1A17" or "1f1a17". Null for anything else. */
export function parseHex(text: string): number | null {
  let digits = text.trim();
  if (digits.startsWith("#")) digits = digits.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) return null;
  return (0xff000000 | parseInt(digits, 16)) | 0;
}

export function cssOf(rgb: Rgb): string {
  return "#" + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
}

export function rgbOfCss(hex: string): Rgb {
  return rgbOfArgb(parseHex(hex) ?? 0);
}

export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** Relative luminance as the contrast rules of the web define it. */
export function luminance(rgb: Rgb): number {
  const channel = (c: number) => {
    const s = Math.min(255, Math.max(0, c)) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Nudges [color] away from [against] until text in it can be read on it. The themes of
 * the app were made for large coloured headings, on a website the accent also carries
 * small print.
 */
export function readable(color: Rgb, against: Rgb, wanted = 4.5): Rgb {
  // A little more than asked for, so that rounding to whole colour values cannot undo it.
  const target = wanted + 0.1;
  if (contrast(color, against) >= target) return color;
  const towards = luminance(against) < 0.4 ? WHITE : BLACK;
  for (let step = 1; step <= 40; step++) {
    const candidate = mix(color, towards, step / 40);
    if (contrast(candidate, against) >= target) return candidate;
  }
  return towards;
}

function textOn(color: Rgb): Rgb {
  // Whichever of the two inks stands out more.
  const dark: Rgb = [27, 23, 20];
  return contrast(dark, color) >= contrast(WHITE, color) ? dark : WHITE;
}

/** A theme is dark when its background is, the same measure the app uses. */
export function isDark(preset: ThemePreset): boolean {
  return luminance(preset.background) < 0.5;
}

export function presetOfCustom(theme: CustomTheme): ThemePreset {
  return {
    key: CUSTOM_THEME_PREFIX + theme.id,
    name: theme.name,
    background: rgbOfArgb(theme.background),
    card: rgbOfArgb(theme.card),
    accent: rgbOfArgb(theme.accent),
    text: rgbOfArgb(theme.text),
  };
}

/** The theme for a key. "system", or a theme that no longer exists, follows the browser: Ember in the dark, Paper in the light. */
export function presetFor(key: string, systemDark: boolean, custom: CustomTheme[] = []): ThemePreset {
  const preset = THEME_PRESETS.find((p) => p.key === key);
  if (preset) return preset;
  const own = custom.find((t) => CUSTOM_THEME_PREFIX + t.id === key);
  if (own) return presetOfCustom(own);
  return THEME_PRESETS.find((p) => p.key === (systemDark ? "ember" : "paper")) as ThemePreset;
}

/** Every colour the pages use, as CSS custom properties. */
export function paletteOf(p: ThemePreset): Record<string, string> {
  const dark = isDark(p);
  // In light themes the accent is darkened a little where it carries text, for contrast.
  const accent = dark ? p.accent : mix(p.accent, BLACK, 0.12);
  // A filled button carries a label. Where neither ink can be read on the accent, the
  // accent gives way a little.
  const strongAccent = readable(accent, textOn(accent));
  const danger: Rgb = dark ? [232, 96, 88] : [206, 60, 54];
  const surfaceVariant = mix(p.card, p.text, 0.08);
  const tile = mix(p.card, p.text, 0.09);
  const muted = mix(p.text, p.card, 0.38);
  const wood: Record<string, Rgb> = dark
    ? { light: [185, 136, 98], mid: [154, 106, 72], dark: [107, 70, 48] }
    : { light: [217, 180, 138], mid: [191, 146, 100], dark: [148, 104, 63] };
  const star: Rgb = dark ? [232, 186, 74] : [190, 140, 20];
  const spice: Rgb = dark ? [255, 107, 94] : [206, 60, 54];
  const good: Rgb = dark ? [139, 200, 120] : [58, 150, 74];
  const shelfBack = dark ? mix(p.background, BLACK, 0.25) : mix(p.background, p.text, 0.07);
  const surfaceLow = mix(p.background, p.card, 0.6);
  // The dashed outline of a book that is away (lib/away.ts). It is drawn on the page, on a
  // card, on a row under the pointer and on a shelf, down to the foot of the row, which
  // lies in the shadow of the board. It has to be seen on all of them, as a line and not
  // as print: softer than the text, and three to one at the least.
  const away = [p.background, p.card, surfaceLow, shelfBack, mix(shelfBack, BLACK, 0.16)].reduce((line, ground) => readable(line, ground, 3), mix(p.text, p.background, 0.3));
  const primaryContainer = mix(p.card, p.accent, dark ? 0.3 : 0.22);
  const secondaryContainer = mix(p.card, p.accent, dark ? 0.18 : 0.14);
  const colors: Record<string, Rgb> = {
    "--bg": p.background,
    "--card": p.card,
    "--text": p.text,
    "--accent": p.accent,
    "--primary": strongAccent,
    "--on-primary": textOn(strongAccent),
    // Accent coloured words on the page, on a card and on a tile: all have to be readable.
    "--accent-text": readable(readable(readable(strongAccent, p.background), p.card), tile),
    "--primary-container": primaryContainer,
    "--on-primary-container": readable(p.text, primaryContainer),
    "--secondary": mix(strongAccent, p.text, 0.3),
    "--secondary-container": secondaryContainer,
    "--danger": danger,
    "--on-danger": textOn(danger),
    "--danger-text": readable(readable(danger, p.background), p.card),
    "--danger-container": mix(p.card, danger, 0.22),
    "--surface-variant": surfaceVariant,
    "--muted": readable(readable(readable(muted, p.card), p.background), tile),
    // The edge of a field has to be seen on a card as well as on the page.
    "--outline": readable(readable(mix(p.card, p.text, 0.38), p.card, 3), p.background, 3),
    "--outline-variant": mix(p.card, p.text, 0.14),
    "--surface-low": surfaceLow,
    "--surface-high": mix(p.card, p.text, 0.05),
    "--tile": tile,
    "--surface-dim": mix(p.background, BLACK, 0.08),
    "--wood-light": wood.light,
    "--wood": wood.mid,
    "--wood-dark": wood.dark,
    "--shelf-back": shelfBack,
    "--away": away,
    "--star": star,
    // Stars are pictures, not print: they have to be seen, which asks for less than reading does.
    "--star-text": readable(readable(star, p.card, 3), p.background, 3),
    "--spice": spice,
    "--good": good,
    "--good-text": readable(readable(good, p.card), p.background),
  };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors)) out[name] = cssOf(value);
  out["--lamp"] = `${star[0]}, ${star[1]}, ${star[2]}`;
  out["color-scheme"] = dark ? "dark" : "light";
  return out;
}

// ---- hue, saturation, brightness: the sliders of the theme editor ----

export function hsvOfRgb(rgb: Rgb): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return [hue, max === 0 ? 0 : delta / max, max];
}

export function rgbOfHsv(hue: number, saturation: number, value: number): Rgb {
  const c = value * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - c;
  const sector = Math.floor((((hue % 360) + 360) % 360) / 60);
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
