// How books and ornaments stand on a shelf (ui/components/Shelves.kt, Covers.kt and
// Ornaments.kt). Sizes are in CSS pixels, which is what dp are on a phone.

import type { BookFormat, OrnamentKind } from "./model.ts";

/** String.hashCode of the JVM, so that a book has the same colour and height here as in the app. */
export function javaHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}

/** Cloth and leather tones for books that have no cover picture. */
export const BOOK_COLORS = [
  "#1F4D46", "#7B2D26", "#2F3E5C", "#8A6529",
  "#4A3B52", "#3F5D3A", "#A6522F", "#22475E",
  "#6B4226", "#5C2A44", "#39524F", "#8C7A3B",
];

/** Stable colour for a book, derived from its title so it never changes. */
export function bookColor(seed: string): string {
  return BOOK_COLORS[Math.abs(javaHash(seed)) % BOOK_COLORS.length];
}

/** Width of a spine. Thick books get thick spines. */
export function spineWidth(pageCount: number): number {
  if (pageCount <= 0) return 34;
  return 24 + (Math.min(1000, Math.max(60, pageCount)) / 1000) * 36;
}

/** Height of a spine, varied a little per title so the row looks like a real shelf. */
export function spineHeight(title: string, format: BookFormat | string): number {
  return 146 + (Math.abs(javaHash(title)) % 5) * 6 + (format === "HARDCOVER" ? 12 : 0);
}

/** Breaks a run of widths into rows that each fit [maxWidth]. Returns [first, last] index pairs. */
export function packRows(widths: number[], maxWidth: number, gap: number): [number, number][] {
  const rows: [number, number][] = [];
  let start = 0;
  let used = 0;
  widths.forEach((w, i) => {
    const needed = i === start ? w : used + gap + w;
    if (i > start && needed > maxWidth) {
      rows.push([start, i - 1]);
      start = i;
      used = w;
    } else {
      used = needed;
    }
  });
  if (widths.length > 0) rows.push([start, widths.length - 1]);
  return rows;
}

/** Width and height of an ornament. They are sized to sit among book spines. */
export function ornamentSize(kind: OrnamentKind | string): [number, number] {
  switch (kind) {
    case "PLANT":
      return [46, 78];
    case "CACTUS":
      return [36, 68];
    case "CANDLE":
      return [22, 58];
    case "MUG":
      return [42, 40];
    case "VASE":
      return [36, 84];
    case "LAMP":
      return [48, 92];
    case "GLOBE":
      return [46, 70];
    case "CLOCK":
      return [44, 50];
    case "TROPHY":
      return [42, 72];
    case "FRAME":
      return [50, 62];
    case "PUMPKIN":
      return [52, 42];
    case "BOOKEND":
      return [28, 74];
    case "CAT":
      return [74, 40];
    case "BOOKSTACK":
      return [64, 44];
    default:
      // Something a newer app put there. It keeps its place as a small gap.
      return [30, 40];
  }
}

/** A spine or an ornament: the two kinds of thing that stand on a shelf in the spine view. */
export type ShelfThing =
  | { type: "spine"; index: number; title: string; pageCount: number; format: BookFormat | string }
  | { type: "deco"; index: number; kind: OrnamentKind | string };

export function thingWidth(thing: ShelfThing): number {
  return thing.type === "spine" ? spineWidth(thing.pageCount) : ornamentSize(thing.kind)[0];
}

/**
 * Puts every ornament behind the book it follows. Ornaments beyond the last book end up
 * at the end. Returns [isBook, index] pairs in the order things stand on the shelf.
 */
export function arrange(itemCount: number, ornamentPositions: number[]): [boolean, number][] {
  const out: [boolean, number][] = [];
  const sorted = ornamentPositions.map((position, index) => ({ position, index })).sort((a, b) => a.position - b.position);
  let next = 0;
  for (let i = 0; i <= itemCount; i++) {
    while (next < sorted.length && (sorted[next].position <= i || i === itemCount)) {
      out.push([false, sorted[next].index]);
      next++;
    }
    if (i < itemCount) out.push([true, i]);
  }
  return out;
}

/** How the last book of a row leans: by how many degrees, and how far its foot stands from the neighbour. */
export interface Lean {
  angle: number;
  offset: number;
}

/**
 * Decides whether the last book of a row leans. It does whenever the shelf is not full
 * and there is a neighbour to lean on, as on a real shelf, where the last book never
 * stands by itself. (An ornament behind it holds the row up, a bookend for instance.)
 * The angle differs from shelf to shelf. The foot of the book stands just far enough out
 * that its edge touches the neighbour.
 */
export function leanOf(sectionKey: string, rowIndex: number, row: ShelfThing[], available: number): Lean | null {
  const last = row[row.length - 1];
  const neighbour = row[row.length - 2];
  if (!last || last.type !== "spine" || !neighbour || neighbour.type !== "spine") return null;
  const mood = ((Math.imul(javaHash(sectionKey), 31) + rowIndex) | 0) & 0x7fffffff;
  const angle = 5 + (mood % 5);
  const radians = (angle * Math.PI) / 180;
  const height = spineHeight(last.title, last.format);
  const neighbourHeight = spineHeight(neighbour.title, neighbour.format);
  // Against a taller neighbour the top corner touches, against a shorter one the edge rests on its corner.
  const offset = Math.min(height * Math.sin(radians), neighbourHeight * Math.tan(radians));
  const used = row.reduce((sum, thing) => sum + thingWidth(thing), 0) + 2 * (row.length - 1);
  return available - used >= offset + 2 ? { angle, offset } : null;
}

// ---- the colours of a drawn book ----

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const toHex = (rgb: number[]) => "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

export function darker(hex: string, amount: number): string {
  return toHex(channels(hex).map((c) => c * (1 - amount)));
}

export function lighter(hex: string, amount: number): string {
  return toHex(channels(hex).map((c) => c + (255 - c) * amount));
}

/** Ink for a cloth cover: dark on a light cloth, cream on a dark one. */
export function inkOn(hex: string): string {
  const linear = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.45 ? "#211D17" : "#F8F1E1";
}

/** Lighter in the middle, darker at the edges: a spine is rounded. */
export function spineGradient(title: string): string {
  const base = bookColor(title);
  return `linear-gradient(90deg, ${darker(base, 0.28)}, ${lighter(base, 0.1)}, ${darker(base, 0.22)})`;
}

export function clothGradient(title: string): string {
  const base = bookColor(title);
  return `linear-gradient(${base}, ${darker(base, 0.22)})`;
}

/** Only web addresses are shown as pictures. A photo that lives on the phone has none. */
export function coverAddressOf(book: { coverUrl: string }): string | null {
  return /^https?:\/\//i.test(book.coverUrl.trim()) ? book.coverUrl.trim() : null;
}
