// The short notices at the foot of the page: which ones stand there, and what takes the
// place of what. Kept apart from the page so that it can be tested by itself.

export interface Notice {
  id: number;
  text: string;
  /** A second, smaller line: what to make of it. */
  detail?: string;
  /** Where the notice leads. With it the whole notice is a link. */
  href?: string;
  /**
   * What the notice is about, a loan for instance. A newer notice about the same thing
   * takes the place of the older one, and the notice goes when that thing is dealt with.
   */
  about?: string;
}

/** How many notices stand on the page at once. */
export const NOTICES_AT_ONCE = 3;

/** How long a notice stays, in milliseconds. Only the time the page can be seen counts. */
export const NOTICE_MS = 6000;

/** A notice with a second line takes longer to read. */
export function stayOf(notice: Pick<Notice, "detail">): number {
  return notice.detail ? NOTICE_MS * 2 : NOTICE_MS;
}

/**
 * Adds a notice. It takes the place of an older one about the same thing, and of one
 * that says the very same words: nothing stands on the page twice. The oldest notices
 * make room when there are too many.
 */
export function withNotice(shown: Notice[], notice: Notice): Notice[] {
  const kept = shown.filter((other) => other.text !== notice.text && (notice.about === undefined || other.about !== notice.about));
  return [...kept.slice(-(NOTICES_AT_ONCE - 1)), notice];
}

/** Takes away what was said about something: it is no longer so, or the reader has dealt with it. */
export function withoutAbout(shown: Notice[], about: string): Notice[] {
  return shown.some((notice) => notice.about === about) ? shown.filter((notice) => notice.about !== about) : shown;
}

/** Takes away one notice, when its time is up. */
export function withoutNotice(shown: Notice[], id: number): Notice[] {
  return shown.some((notice) => notice.id === id) ? shown.filter((notice) => notice.id !== id) : shown;
}
