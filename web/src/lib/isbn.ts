// ISBN-10 and ISBN-13 helpers, as util/Isbn.kt. Input may carry hyphens or spaces.

const isDigit = (c: string) => c >= "0" && c <= "9";

export function clean(raw: string): string {
  return Array.from(raw.toUpperCase())
    .filter((c) => isDigit(c) || c === "X")
    .join("");
}

function weightedSum13(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += (s.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return sum;
}

export function isValid13(s: string): boolean {
  if (s.length !== 13 || !Array.from(s).every(isDigit)) return false;
  return weightedSum13(s) % 10 === 0;
}

export function isValid10(s: string): boolean {
  if (s.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    let v: number;
    if (isDigit(c)) v = c.charCodeAt(0) - 48;
    else if (c === "X" && i === 9) v = 10;
    else return false;
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValid(raw: string): boolean {
  const s = clean(raw);
  return isValid13(s) || isValid10(s);
}

/** True for the "Bookland" EAN-13 codes printed on books (prefix 978 or 979). */
export function isBookEan(raw: string): boolean {
  const s = clean(raw);
  return isValid13(s) && (s.startsWith("978") || s.startsWith("979"));
}

/** Any valid ISBN in its 13 digit form, or null when the input is not an ISBN. */
export function to13(raw: string): string | null {
  const s = clean(raw);
  if (isValid13(s)) return s;
  if (!isValid10(s)) return null;
  const body = "978" + s.substring(0, 9);
  const check = (10 - (weightedSum13(body) % 10)) % 10;
  return body + check;
}
