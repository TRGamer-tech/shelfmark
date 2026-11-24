// Notifications of the browser, for news that comes in while Shelfmark is open in a tab
// that is not in front. There is no push service: with no tab open nothing can be told.
// The decisions are here, apart from the page and from the browser, so that they can be
// tested by themselves.

export type Permission = "default" | "granted" | "denied";

/** What the browser can do, and whether the reader lets it. */
export interface NotifyState {
  /** The browser can show notifications to a page at all. */
  supported: boolean;
  permission: Permission;
}

export const CANNOT_NOTIFY: NotifyState = { supported: false, permission: "denied" };

/**
 * What the friends page and the loans page show about notifications:
 *
 * - "ask": the reader was never asked. A card says what it is for, and its button asks
 *   the browser. Never at page load: browsers punish a question out of the blue, and
 *   some only allow it after a click.
 * - "blocked": the reader said no in the browser. A short line says where to change that.
 * - "none": allowed already, put away with "Not now", or a browser that cannot do it.
 */
export type Offer = "ask" | "blocked" | "none";

export function offerOf(state: NotifyState, putAway: boolean): Offer {
  if (!state.supported || putAway) return "none";
  if (state.permission === "default") return "ask";
  return state.permission === "denied" ? "blocked" : "none";
}

/**
 * Whether a piece of news is also shown by the browser. Only while the page cannot be
 * seen: while it can, the notice in the page is enough, and nothing is told twice.
 */
export function tellsBrowser(state: NotifyState, visible: boolean): boolean {
  return state.supported && state.permission === "granted" && !visible;
}

/**
 * Whether a tab looks at the server now. In front, always. Not in front, only when it
 * could tell the browser what it finds, and no other tab of Shelfmark is in front:
 * that one finds the news itself and tells the reader in its page. A tab that is not
 * in front and looked all the same would take the news away from the one the reader
 * is looking at.
 */
export function looksNow(state: NotifyState, visible: boolean, frontElsewhere: boolean): boolean {
  if (visible) return true;
  return state.supported && state.permission === "granted" && !frontElsewhere;
}

/** The part of a notification of the browser that is used here. */
export interface NotificationLike {
  close(): void;
  onclick: ((event: unknown) => void) | null;
}

export interface NotificationOptionsLike {
  body?: string;
  tag?: string;
  lang?: string;
  renotify?: boolean;
}

/** window.Notification, or what stands in for it in a test. */
export type NotificationMaker = new (title: string, options?: NotificationOptionsLike) => NotificationLike;

/** One notification: what it says, what it is about, and where a click on it leads. */
export interface Shown {
  about: string;
  title: string;
  body: string;
  href: string;
}

/**
 * The notifications a page has put up. One per thing: the next step of a loan takes the
 * place of the one before (the browser does the same by the tag). A notification goes
 * when what it is about is dealt with, when it is clicked, and when the page comes to
 * the front, where the notice in the page says the same.
 */
export class BrowserNotices {
  private readonly make: NotificationMaker | null;
  private readonly lang: string;
  private readonly onClick: (shown: Shown) => void;
  private open = new Map<string, NotificationLike>();
  private broken = false;

  constructor(make: NotificationMaker | null, lang: string, onClick: (shown: Shown) => void) {
    this.make = make;
    this.lang = lang;
    this.onClick = onClick;
  }

  /** Shows a notification. False when the browser would not. */
  show(shown: Shown): boolean {
    if (!this.make || this.broken) return false;
    this.close(shown.about);
    try {
      // "renotify" lets the next step of a loan ring again although it takes the place of the last one.
      const notification = new this.make(shown.title, { body: shown.body, tag: shown.about, lang: this.lang, renotify: true });
      notification.onclick = () => {
        this.close(shown.about);
        this.onClick(shown);
      };
      this.open.set(shown.about, notification);
      return true;
    } catch {
      // A browser that has the word and not the deed (Chrome on Android gives notifications
      // to service workers only). It is not tried again on this page.
      this.broken = true;
      return false;
    }
  }

  /** Takes away the notification about something, if there is one. */
  close(about: string): void {
    const notification = this.open.get(about);
    if (!notification) return;
    this.open.delete(about);
    try {
      notification.close();
    } catch {
      // Closed by the reader already.
    }
  }

  closeAll(): void {
    for (const about of Array.from(this.open.keys())) this.close(about);
  }

  /** What the notifications that are up are about. */
  get shown(): string[] {
    return Array.from(this.open.keys());
  }
}

/** A window, as far as its notifications go. What is there is looked at before it is used. */
interface WindowLike {
  Notification?: unknown;
}

type Maker = NotificationMaker & { permission?: unknown; requestPermission?: (done?: (answer: unknown) => void) => unknown };

function makerOf(win: WindowLike | undefined): Maker | null {
  const maker = win?.Notification as Maker | undefined;
  return typeof maker === "function" && typeof maker.requestPermission === "function" ? maker : null;
}

function permissionOf(value: unknown): Permission {
  return value === "granted" || value === "denied" ? value : "default";
}

/**
 * Whether this browser can show notifications to a page at all. One that has none for
 * pages (Safari on a phone, outside an installed web app) or gives them to service
 * workers only (Chrome on Android) cannot, and nothing is offered there. The second
 * kind is found by trying, which shows nothing while the reader has not said yes. With
 * a yes there is nothing to find out before the first notification, which finds it out.
 * Asked once for a page: the answer does not change while it is open.
 */
export function canNotify(win: WindowLike | undefined): boolean {
  const maker = makerOf(win);
  if (!maker) return false;
  if (permissionOf(maker.permission) === "granted") return true;
  try {
    new maker("").close();
    return true;
  } catch {
    return false;
  }
}

/** What the reader lets the browser do right now. They can change it in the browser at any time. */
export function permissionNow(win: WindowLike | undefined): Permission {
  return permissionOf(makerOf(win)?.permission);
}

/** Asks the browser, which asks the reader. Only ever called from a click. */
export function askPermission(win: WindowLike | undefined): Promise<Permission> {
  const maker = makerOf(win);
  if (!maker) return Promise.resolve("denied");
  return new Promise((resolve) => {
    const done = (answer: unknown) => resolve(permissionOf(answer ?? maker.permission));
    try {
      // Newer browsers answer with a promise, older ones call back.
      const answer = maker.requestPermission!(done);
      if (answer && typeof (answer as Promise<unknown>).then === "function") (answer as Promise<unknown>).then(done, () => done(maker.permission));
    } catch {
      done(maker.permission);
    }
  });
}
