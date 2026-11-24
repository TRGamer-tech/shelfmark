// Notifications of the browser (src/lib/browserNotices.ts): when the reader is asked,
// when the browser tells and when the page alone does, one notification per thing, and
// what a click leads to. The browser itself is stood in for.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { NotificationOptionsLike, NotifyState, Shown } from "../src/lib/browserNotices.ts";
import { BrowserNotices, CANNOT_NOTIFY, askPermission, canNotify, looksNow, offerOf, permissionNow, tellsBrowser } from "../src/lib/browserNotices.ts";
import { FRIENDS_PAGE, LOANS_PAGE, aboutFriend, aboutLoan } from "../src/lib/news.ts";

const can = (permission: NotifyState["permission"]): NotifyState => ({ supported: true, permission });

/** What stands in for window.Notification: it notes what was put up, closed and clicked. */
function fakeBrowser() {
  const up: { title: string; options: NotificationOptionsLike; closed: boolean; click: () => void }[] = [];
  class Fake {
    onclick: ((event: unknown) => void) | null = null;
    private readonly entry: (typeof up)[number];
    constructor(title: string, options: NotificationOptionsLike = {}) {
      this.entry = { title, options, closed: false, click: () => this.onclick?.({}) };
      up.push(this.entry);
    }
    close() {
      this.entry.closed = true;
    }
  }
  return { Fake, up, open: () => up.filter((entry) => !entry.closed).map((entry) => entry.title) };
}

const momo: Shown = { about: aboutLoan("3f2a9c1e-7b4d-4e8a-9c0d-112233445566"), title: "Ben says Momo was handed over to you", body: "Open Shelfmark to confirm.", href: LOANS_PAGE };

test("the reader is asked when they were never asked, told where to allow it after a no, and otherwise left alone", () => {
  // Never asked: the card with its one button. The question itself only follows a click on it.
  assert.equal(offerOf(can("default"), false), "ask");
  // Said no in the browser: a line that says where to change that.
  assert.equal(offerOf(can("denied"), false), "blocked");
  // Allowed: nothing to ask and nothing to say.
  assert.equal(offerOf(can("granted"), false), "none");
  // "Not now" puts all of it away for this browser, whatever the browser says.
  for (const permission of ["default", "denied", "granted"] as const) assert.equal(offerOf(can(permission), true), "none", permission);
  // A browser that cannot do it at all is offered nothing.
  assert.equal(offerOf(CANNOT_NOTIFY, false), "none");
  assert.equal(offerOf({ supported: false, permission: "default" }, false), "none");
});

test("the browser tells only what the page cannot: news that comes while the page is not in front", () => {
  assert.equal(tellsBrowser(can("granted"), false), true);
  // While the page can be seen the notice in it is enough. Nothing is told twice.
  assert.equal(tellsBrowser(can("granted"), true), false);
  // Without the reader's yes the browser is never used.
  assert.equal(tellsBrowser(can("default"), false), false);
  assert.equal(tellsBrowser(can("denied"), false), false);
  assert.equal(tellsBrowser(CANNOT_NOTIFY, false), false);
});

test("a tab that is not in front looks only when it could tell the browser, and no other tab is in front", () => {
  // In front: always, as before.
  for (const state of [can("granted"), can("default"), can("denied"), CANNOT_NOTIFY]) assert.equal(looksNow(state, true, false), true);
  // Behind, allowed, and nobody in front: it looks, to have the browser tell the news.
  assert.equal(looksNow(can("granted"), false, false), true);
  // Behind while another tab of Shelfmark is in front: that one finds the news and says it in its page.
  assert.equal(looksNow(can("granted"), false, true), false);
  // Behind and not allowed: nobody could be told, so the server is not asked, as before.
  assert.equal(looksNow(can("default"), false, false), false);
  assert.equal(looksNow(can("denied"), false, false), false);
  assert.equal(looksNow(CANNOT_NOTIFY, false, false), false);
});

test("a notification carries the news, the tag of what it is about, and the reader's language", () => {
  const browser = fakeBrowser();
  const notices = new BrowserNotices(browser.Fake, "de", () => undefined);
  assert.equal(notices.show(momo), true);
  assert.deepEqual(browser.up.map((entry) => [entry.title, entry.options]), [[momo.title, { body: momo.body, tag: momo.about, lang: "de", renotify: true }]]);
  assert.deepEqual(notices.shown, [momo.about]);
});

test("there is one notification per loan: the next step takes the place of the one before", () => {
  const browser = fakeBrowser();
  const notices = new BrowserNotices(browser.Fake, "en", () => undefined);
  notices.show(momo);
  notices.show({ about: aboutFriend("clara"), title: "Clara is now your friend", body: "Somebody used your friend code.", href: FRIENDS_PAGE });
  notices.show({ ...momo, title: "Ben changed the date for Momo", body: "" });
  // The first one about the loan was closed, and the tag is the same, so the browser replaces it as well.
  assert.deepEqual(browser.open(), ["Clara is now your friend", "Ben changed the date for Momo"]);
  assert.equal(browser.up[0].options.tag, browser.up[2].options.tag);
  assert.notEqual(browser.up[0].options.tag, browser.up[1].options.tag);
  assert.deepEqual(notices.shown, [aboutFriend("clara"), momo.about]);
});

test("a notification goes when what it is about is dealt with, and all of them when the page comes to the front", () => {
  const browser = fakeBrowser();
  const notices = new BrowserNotices(browser.Fake, "en", () => undefined);
  notices.show(momo);
  notices.show({ about: aboutFriend("clara"), title: "Clara is now your friend", body: "", href: FRIENDS_PAGE });
  // The reader said "I have it", here or on another device.
  notices.close(momo.about);
  assert.deepEqual(browser.open(), ["Clara is now your friend"]);
  // Nothing about that loan is up any more: closing it again is nothing.
  notices.close(momo.about);
  notices.close("loan:another");
  // In front again: the page says the same.
  notices.closeAll();
  assert.deepEqual(browser.open(), []);
  assert.deepEqual(notices.shown, []);
});

test("a click on a notification closes it and leads to the page it is about", () => {
  const browser = fakeBrowser();
  const followed: Shown[] = [];
  const notices = new BrowserNotices(browser.Fake, "en", (shown) => followed.push(shown));
  notices.show(momo);
  notices.show({ about: aboutFriend("clara"), title: "Clara is now your friend", body: "", href: FRIENDS_PAGE });
  browser.up[1].click();
  assert.deepEqual(followed.map((shown) => shown.href), [FRIENDS_PAGE]);
  assert.deepEqual(browser.open(), [momo.title]);
  browser.up[0].click();
  assert.deepEqual(followed.map((shown) => shown.href), [FRIENDS_PAGE, LOANS_PAGE]);
  assert.deepEqual(notices.shown, []);
  // A notification that was replaced no longer leads anywhere: only the one that is up counts.
  notices.show(momo);
  notices.show({ ...momo, title: "Ben changed the date for Momo" });
  browser.up[3].click();
  assert.equal(followed.at(-1)?.title, "Ben changed the date for Momo");
});

test("a browser that cannot show notifications to a page is not asked a second time", () => {
  // Chrome on Android has the word and gives the deed to service workers only.
  let tried = 0;
  class Illegal {
    onclick = null;
    constructor() {
      tried++;
      throw new TypeError("Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.");
    }
    close() {}
  }
  const notices = new BrowserNotices(Illegal, "en", () => undefined);
  assert.equal(notices.show(momo), false);
  assert.equal(notices.show(momo), false);
  assert.equal(tried, 1);
  assert.deepEqual(notices.shown, []);
  // And one without notifications at all.
  assert.equal(new BrowserNotices(null, "en", () => undefined).show(momo), false);
});

test("whether the browser can is found out without showing anything", () => {
  // No notifications for pages at all: Safari on a phone, outside an installed web app.
  assert.equal(canNotify(undefined), false);
  assert.equal(canNotify({}), false);
  assert.equal(canNotify({ Notification: {} }), false);
  // Asked or not, a browser that takes the constructor can.
  const made: string[] = [];
  const closed: string[] = [];
  const desktop = (permission: string) =>
    Object.assign(
      class {
        onclick = null;
        constructor(title: string) {
          made.push(title);
        }
        close() {
          closed.push("closed");
        }
      },
      { permission, requestPermission: () => Promise.resolve(permission) },
    );
  assert.equal(canNotify({ Notification: desktop("default") }), true);
  assert.equal(canNotify({ Notification: desktop("denied") }), true);
  // The try shows nothing while the reader has not said yes, and is closed at once.
  assert.deepEqual([made, closed], [["", ""], ["closed", "closed"]]);
  // With a yes nothing is tried: a try would be a notification.
  assert.equal(canNotify({ Notification: desktop("granted") }), true);
  assert.equal(made.length, 2);
  // The kind that refuses the constructor cannot.
  const android = Object.assign(
    class {
      constructor() {
        throw new TypeError("Illegal constructor");
      }
    },
    { permission: "default", requestPermission: () => Promise.resolve("default") },
  );
  assert.equal(canNotify({ Notification: android }), false);
});

test("the permission is read as the browser has it, and asked for in both ways browsers answer", async () => {
  const maker = (permission: unknown, requestPermission: unknown) => ({ Notification: Object.assign(class {}, { permission, requestPermission }) });
  assert.equal(permissionNow(maker("granted", () => undefined)), "granted");
  assert.equal(permissionNow(maker("denied", () => undefined)), "denied");
  assert.equal(permissionNow(maker("default", () => undefined)), "default");
  // Anything else is "not asked yet".
  assert.equal(permissionNow(maker("prompt", () => undefined)), "default");
  assert.equal(permissionNow(undefined), "default");
  // Newer browsers answer with a promise.
  assert.equal(await askPermission(maker("default", () => Promise.resolve("granted"))), "granted");
  assert.equal(await askPermission(maker("default", () => Promise.resolve("denied"))), "denied");
  // The question was closed without an answer: still not asked.
  assert.equal(await askPermission(maker("default", () => Promise.resolve("default"))), "default");
  // Older ones call back.
  assert.equal(await askPermission(maker("default", (done: (answer: string) => void) => void done("granted"))), "granted");
  // One that fails says what it has.
  assert.equal(
    await askPermission(
      maker("denied", () => {
        throw new Error("no");
      }),
    ),
    "denied",
  );
  assert.equal(await askPermission(maker("default", () => Promise.reject(new Error("no")))), "default");
  // No notifications: nothing to ask.
  assert.equal(await askPermission({}), "denied");
});
