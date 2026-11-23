// Small helpers for reading the loosely shaped JSON the catalogues answer with.

export type Json = Record<string, unknown>;

export function parseObject(body: string): Json | null {
  try {
    return asObject(JSON.parse(body));
  } catch {
    return null;
  }
}

export function asObject(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

export function str(object: Json | null | undefined, key: string): string | null {
  const value = object?.[key];
  return typeof value === "string" ? value : null;
}

export function int(object: Json | null | undefined, key: string): number | null {
  const value = object?.[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  // Some catalogues send numbers as text.
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

export function array(object: Json | null | undefined, key: string): unknown[] | null {
  const value = object?.[key];
  return Array.isArray(value) ? value : null;
}

export function strings(object: Json | null | undefined, key: string): string[] {
  return (array(object, key) ?? []).filter((item): item is string => typeof item === "string");
}

/** Open Library stores long texts either as a plain string or as {"type": ..., "value": ...}. */
export function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const object = asObject(value);
  return (str(object, "value") ?? "").trim();
}
