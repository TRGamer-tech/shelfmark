// The small script that decides, before the first paint, whether the address of the
// site shows the front page or the shelf. It is run here against a browser that is played.

import assert from "node:assert/strict";
import { test } from "node:test";
import { VISITOR_SCRIPT, isHome } from "../src/lib/visitor.ts";

interface Arrival {
  path: string;
  hash?: string;
  search?: string;
  /** What the browser remembers. */
  stored?: Record<string, string>;
  /** The language of the browser. */
  speaks?: string;
  /** A browser that refuses to be asked what it remembers. */
  locked?: boolean;
}

interface Outcome {
  visitor?: string;
  world?: string;
  lang?: string;
  js: boolean;
  /** Where the reader was sent on, if anywhere. */
  sentTo: string | null;
}

function arrive({ path, hash = "", search = "", stored = {}, speaks = "en-GB", locked = false }: Arrival): Outcome {
  const attributes: Record<string, string> = {};
  const classes = new Set<string>();
  let sentTo: string | null = null;
  let lang: string | undefined;
  const document = {
    documentElement: {
      classList: { add: (name: string) => classes.add(name) },
      setAttribute: (name: string, value: string) => (attributes[name] = value),
      set lang(value: string) {
        lang = value;
      },
    },
  };
  const location = { pathname: path, hash, search, replace: (address: string) => (sentTo = address) };
  const localStorage = {
    getItem: (key: string) => {
      if (locked) throw new Error("storage is switched off");
      return stored[key] ?? null;
    },
  };
  new Function("document", "location", "localStorage", "navigator", VISITOR_SCRIPT)(document, location, localStorage, { language: speaks });
  return { visitor: attributes["data-visitor"], world: attributes["data-world"], lang, js: classes.has("js"), sentTo };
}

const SIGNED_IN = { "shelfmark.auth": '{"access_token":"a"}' };

test("a visitor gets the front page, in the colours of the front pages", () => {
  assert.deepEqual(arrive({ path: "/" }), { visitor: "out", world: "front", lang: "en", js: true, sentTo: null });
  assert.deepEqual(arrive({ path: "/de" }), { visitor: "out", world: "front", lang: "de", js: true, sentTo: null });
  // With or without the slash at the end.
  assert.equal(arrive({ path: "/de/" }).visitor, "out");
  // A link to a part of the page is no sign-in.
  assert.equal(arrive({ path: "/", hash: "#download" }).visitor, "out");
});

test("somebody this browser remembers gets their shelf, in their own colours, and is never shown the front page", () => {
  assert.deepEqual(arrive({ path: "/", stored: SIGNED_IN }), { visitor: "in", world: "app", lang: "en", js: true, sentTo: null });
  assert.equal(arrive({ path: "/de", stored: SIGNED_IN }).visitor, "in");
  // Their language is the one they chose or the one of the browser, not the one of the address.
  assert.equal(arrive({ path: "/", stored: { ...SIGNED_IN, "shelfmark.lang": "de" } }).lang, "de");
  assert.equal(arrive({ path: "/", stored: SIGNED_IN, speaks: "de-CH" }).lang, "de");
});

test("the link of a mail is on its way in: no front page, and no detour", () => {
  // Exactly where Supabase sends the browser after the click in a confirmation mail.
  const confirmed = arrive({ path: "/", hash: "#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=signup", speaks: "de-CH" });
  assert.equal(confirmed.visitor, "in");
  // Whoever comes through a link is on their way to one of the front pages. The quiet screen wears their colours.
  assert.equal(confirmed.world, "front");
  // A German reader is not sent to the German page now: the sign-in behind the "#" would be lost on the way.
  assert.equal(confirmed.sentTo, null);
  assert.equal(arrive({ path: "/", hash: "#type=recovery&access_token=abc" }).visitor, "in");
  // A link that is too old leads to the sign-in page, not past the front page.
  assert.equal(arrive({ path: "/", hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid" }).visitor, "in");
  assert.equal(arrive({ path: "/", search: "?error=access_denied&error_code=otp_expired" }).visitor, "in");
  assert.equal(arrive({ path: "/", hash: "#message=Confirmation+link+accepted" }).visitor, "in");
});

test("a reader whose browser speaks German is taken to the German front page, unless they chose English", () => {
  assert.equal(arrive({ path: "/", speaks: "de-CH" }).sentTo, "/de");
  assert.equal(arrive({ path: "/", speaks: "de" }).sentTo, "/de");
  // What stands behind the address goes along.
  assert.equal(arrive({ path: "/", speaks: "de-DE", search: "?from=mail", hash: "#download" }).sentTo, "/de?from=mail#download");
  assert.equal(arrive({ path: "/", speaks: "de-CH", stored: { "shelfmark.lang": "en" } }).sentTo, null);
  assert.equal(arrive({ path: "/", speaks: "fr-CH" }).sentTo, null);
  // A choice of German counts in an English browser too.
  assert.equal(arrive({ path: "/", speaks: "en-GB", stored: { "shelfmark.lang": "de" } }).sentTo, "/de");
  // The German page asked for by its address is never left for English.
  assert.equal(arrive({ path: "/de", speaks: "en-GB", stored: { "shelfmark.lang": "en" } }).sentTo, null);
  // Somebody signed in is not sent anywhere: their shelf is here.
  assert.equal(arrive({ path: "/", speaks: "de-CH", stored: SIGNED_IN }).sentTo, null);
});

test("the pages around the sign-in wear the colours of the front page, the library its own", () => {
  assert.equal(arrive({ path: "/login" }).world, "front");
  assert.equal(arrive({ path: "/reset", hash: "#access_token=abc&type=recovery" }).world, "front");
  assert.equal(arrive({ path: "/book", search: "?id=5", stored: SIGNED_IN }).world, "app");
  assert.equal(arrive({ path: "/settings", stored: SIGNED_IN }).world, "app");
  // Only the front page asks who is at the door.
  assert.equal(arrive({ path: "/login" }).visitor, undefined);
  assert.equal(arrive({ path: "/book", stored: SIGNED_IN }).visitor, undefined);
  // On the sign-in page the language is the reader's, as in the library.
  assert.equal(arrive({ path: "/login", speaks: "de-CH" }).lang, "de");
});

test("the confirmation page wears the colours of the front page, with a link behind it or without", () => {
  const link = arrive({ path: "/confirmed", hash: "#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=signup", speaks: "de-CH" });
  assert.deepEqual(link, { visitor: undefined, world: "front", lang: "de", js: true, sentTo: null });
  assert.equal(arrive({ path: "/confirmed", hash: "#error=access_denied&error_code=otp_expired" }).world, "front");
  assert.equal(arrive({ path: "/confirmed" }).world, "front");
  assert.equal(arrive({ path: "/confirmed", stored: SIGNED_IN }).world, "front");
  // A link that fails on its way to the shelf of somebody signed in: the page that explains it is a front page.
  assert.equal(arrive({ path: "/", hash: "#error=access_denied&error_code=otp_expired", stored: SIGNED_IN }).world, "front");
});

test("the imprint and the privacy notice are in the language of their address, whoever reads them", () => {
  for (const path of ["/imprint", "/privacy"]) {
    assert.deepEqual(arrive({ path, speaks: "de-CH" }), { visitor: undefined, world: "front", lang: "en", js: true, sentTo: null });
    assert.equal(arrive({ path, stored: { ...SIGNED_IN, "shelfmark.lang": "de" } }).lang, "en");
    assert.equal(arrive({ path, stored: SIGNED_IN }).world, "front");
  }
  for (const path of ["/de/impressum", "/de/datenschutz", "/de/datenschutz/"]) {
    assert.deepEqual(arrive({ path, speaks: "en-GB" }), { visitor: undefined, world: "front", lang: "de", js: true, sentTo: null });
    assert.equal(arrive({ path, stored: { "shelfmark.lang": "en" } }).lang, "de");
  }
  // An address that only looks like one of them is an ordinary page.
  assert.equal(arrive({ path: "/de/privacy", speaks: "en-GB" }).lang, "en");
});

test("a browser that will not say what it remembers is treated as a visitor", () => {
  const outcome = arrive({ path: "/", locked: true });
  assert.equal(outcome.visitor, "out");
  assert.equal(outcome.world, "front");
  assert.equal(outcome.js, true);
});

test("the front page has two addresses", () => {
  assert.equal(isHome("/"), true);
  assert.equal(isHome(""), true);
  assert.equal(isHome("/de"), true);
  assert.equal(isHome("/de/"), true);
  assert.equal(isHome("/login"), false);
  assert.equal(isHome("/design"), false);
  assert.equal(isHome("/de/more"), false);
});
