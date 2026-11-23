// Ids of new books, lists, quotes and so on. They are numbers that fit a JavaScript
// number and must not collide with those a phone hands out (below 9e14), so the
// website uses the time in microseconds, see supabase/README.md.

let last = 0;

export function newId(now: number = Date.now()): number {
  let id = now * 1000 + Math.floor(Math.random() * 1000);
  // Two ids asked for in the same millisecond must still differ.
  if (id <= last) id = last + 1;
  last = id;
  return id;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
