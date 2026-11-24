// End to end tests: the built site in a real browser against the stand-in for Supabase
// (supabase/dev_server.py) and recorded catalogue answers.
//
//   npm run e2e                 builds the site, starts everything, runs every test
//   npm run e2e -- --no-build   reuses the last build
//   npm run e2e -- --only=timer runs only the tests whose name holds that word
//
// See README.md for what has to be running (a PostgreSQL with the schema loaded).

import { writeFileSync } from "node:fs";
import {
  CONFIRM_PORT,
  CONFIRM_SERVER,
  COVER_PNG,
  FIXTURES,
  KEY,
  OUTPUT,
  PLAIN,
  SERVER,
  SERVER_PORT,
  SHOTS,
  WEB,
  WEB_DIR,
  assert,
  buildSites,
  equal,
  jpegSize,
  leftOut,
  loadPlaywright,
  png,
  results,
  rpc,
  signIn,
  startGateway,
  startSites,
  startStandIn,
  stopAll,
  test,
  untilVault,
  vaultOf,
} from "./lib.mjs";

const { chromium } = loadPlaywright();
const stamp = Date.now();
const account = (name) => ({ name, email: `${name.toLowerCase()}.${stamp}@example.org`, password: `pw-${name.toLowerCase()}-123` });
const anna = account("Anna");
const ben = account("Ben");
const carl = account("Carl");
const zed = account("Zed");

// Days are days since 1970 in local time. The browsers of these tests run in UTC.
const today = Math.floor(Date.now() / 86_400_000);
const isoToday = new Date(today * 86_400_000).toISOString().slice(0, 10);

/** A day as the English and the German pages write it, and as a date field holds it. */
const enDay = (day) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(day * 86_400_000));
const deDay = (day) => new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(day * 86_400_000));
const iso = (day) => new Date(day * 86_400_000).toISOString().slice(0, 10);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 360, height: 780 };

let browser;
let gateway;
const problems = [];

/** A browser of its own: own storage, own sign-in. Everything outside this machine is kept out. */
async function newContext({ viewport = DESKTOP, locale = "en-GB", colorScheme = "light", reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport, locale, colorScheme, reducedMotion, deviceScaleFactor: 2, timezoneId: "UTC", acceptDownloads: true });
  await context.route(
    (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
    (route) => {
      // Cover pictures of the catalogues are answered with a picture of our own, the rest of the world does not exist.
      if (route.request().resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/png", body: COVER_PNG });
      return route.abort();
    },
  );
  context.on("page", (page) => {
    page.on("pageerror", (error) => problems.push(`page error on ${page.url()}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      // A refused request is logged by the browser itself. The tests that cause one on purpose check the page instead.
      if (/Failed to load resource/.test(text)) return;
      problems.push(`console error on ${page.url()}: ${text}`);
    });
  });
  return context;
}

const shot = (page, name, options = {}) => page.screenshot({ path: `${SHOTS}${name}.png`, ...options });

/**
 * Makes a page note, frame by frame from before its first paint, whether the front page
 * can be seen. Somebody who is signed in must never see it flash by on the way to their shelf.
 */
async function watchForFrontPage(page) {
  await page.addInitScript(() => {
    window.__frontPage = { frames: 0, shown: 0, signIn: 0 };
    const look = () => {
      const landing = document.querySelector('[data-testid="landing"]');
      window.__frontPage.frames++;
      if (landing && getComputedStyle(landing).display !== "none") window.__frontPage.shown++;
      // The sign-in page must not flash by either, on the way to the page a link of a mail leads to.
      if (document.querySelector('[data-testid="login-form"]')) window.__frontPage.signIn++;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

const frontPageSeen = (page) => page.evaluate(() => window.__frontPage);

/** What Supabase puts behind the address when the link of a mail is too old or was used before. */
const USED_UP = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

/** A call to the stand-in for Supabase, as the Android app or a mail program would make it. */
const post = (base, path, body) => fetch(`${base}${path}`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** An account made by talking to the server directly, as the Android app would make it. Saying hello makes its profile, with a name or without one. */
async function signUpByApi(who, name = who.name) {
  const created = await (await post(SERVER, "/auth/v1/signup", { email: who.email, password: who.password })).json();
  who.session = { token: created.access_token, id: created.user.id };
  await rpc(who.session.token, "shelfmark_hello", name === "" ? {} : { p_name: name });
}

/** The loans of an account as the server lists them: one record that both sides read. */
const loansOf = async (who) => (await rpc(who.session.token, "shelfmark_sync", { p_known: {} })).loans;

/** A step in a loan, taken by talking to the server directly, as another device of that person would. */
const act = (who, loanId, action, more = {}) => rpc(who.session.token, "shelfmark_loan_act", { p_loan: loanId, p_action: action, ...more });

/** Makes a page look at the server now, as it does by itself every minute and whenever its window comes to the front. */
const lookNow = (page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

const FRONT_LINK_FAILED =
  "This link does not work any more: it is too old, or it was used before. If your address is confirmed already, sign in. If signing in tells you to confirm your address, you can have the mail sent again from there. For a new password, choose “Forgot the password?”.";

async function waitSaved(page) {
  // Give the page a moment to notice that there is something to save at all.
  await page.waitForTimeout(150);
  await page.waitForFunction(() => {
    const states = Array.from(document.querySelectorAll('[data-testid="save-state"]'));
    return states.length > 0 && states.every((element) => element.dataset.state === "saved" || element.dataset.state === "idle");
  });
}

async function until(check, what, seconds = 10) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`Never happened: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function signUp(page, who, base = WEB) {
  await page.goto(`${base}/login`);
  await page.getByTestId("mode-up").click();
  await page.getByTestId("email").fill(who.email);
  await page.getByTestId("password").fill(who.password);
  await page.getByTestId("name").fill(who.name);
  await page.getByTestId("submit").click();
}

async function signInOnPage(page, who) {
  await page.goto(`${WEB}/login`);
  await page.getByTestId("email").fill(who.email);
  await page.getByTestId("password").fill(who.password);
  await page.getByTestId("submit").click();
}

async function addByHand(page, { title, authors, pages, status = "NONE", format, year, genres }) {
  await page.goto(`${WEB}/add/manual`);
  await page.getByTestId("field-title").fill(title);
  await page.getByTestId("field-authors").fill(authors);
  if (pages) await page.getByTestId("field-pages").fill(String(pages));
  if (format) await page.getByTestId(`format-${format}`).click();
  if (year) await page.getByTestId("field-year").fill(year);
  if (genres) await page.getByTestId("field-genres").fill(genres);
  await page.getByTestId(`pick-${status}`).click();
  await page.getByTestId("save-book").click();
  await page.getByTestId("book-page").waitFor();
  await waitSaved(page);
}

const bookOf = (vault, title) => vault.books.find((b) => b.title === title);

async function openBook(page, who, title) {
  const { vault } = await vaultOf(who);
  const book = bookOf(vault, title);
  assert(book, `${title} is not in the library on the server`);
  await page.goto(`${WEB}/book?id=${book.id}`);
  await page.getByTestId("book-page").waitFor();
  return book;
}

/** What a careful person checking for accessibility would look at first, on whatever page is open. */
async function audit(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && !element.hidden && element.getClientRects().length > 0;
    };
    const found = [];
    for (const field of document.querySelectorAll("input, select, textarea")) {
      if (field.type === "hidden" || field.hidden) continue;
      const labelled = (field.labels && field.labels.length > 0) || field.getAttribute("aria-label") || field.getAttribute("aria-labelledby");
      if (!labelled) found.push(`a field without a label: ${field.outerHTML.slice(0, 120)}`);
    }
    for (const control of document.querySelectorAll("button, a[href]")) {
      if (!visible(control)) continue;
      const name = (control.getAttribute("aria-label") || control.textContent || control.getAttribute("title") || "").trim();
      if (!name) found.push(`a button or link without a name: ${control.outerHTML.slice(0, 120)}`);
    }
    for (const fake of document.querySelectorAll("div[onclick], span[onclick]")) found.push(`something clickable that is no button: ${fake.outerHTML.slice(0, 120)}`);
    if (!document.documentElement.lang) found.push("the page does not say which language it is in");
    if (document.querySelectorAll("h1").length !== 1) found.push(`${document.querySelectorAll("h1").length} main headings instead of one`);
    if (document.scrollingElement.scrollWidth > window.innerWidth + 1) found.push(`the page is wider than the window: ${document.scrollingElement.scrollWidth} > ${window.innerWidth}`);
    return found;
  });
}

async function main() {
  const noBuild = process.argv.includes("--no-build");
  console.log("Starting the stand-in server ...");
  await startStandIn();
  gateway = await startGateway();
  if (!noBuild) {
    console.log("Building the site (twice: with a server, and without one) ...");
    await buildSites();
  }
  console.log("Starting the site ...");
  await startSites();
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

  // ------------------------------------------------------------------------------
  console.log("\nA site without a server");
  {
    const context = await newContext();
    const page = await context.newPage();
    await test(
      "without a server the site says so plainly instead of crashing",
      async () => {
        // The front page needs no server: it says what Shelfmark is and hands over the app.
        await page.goto(`${PLAIN}/`);
        await page.getByTestId("landing").waitFor();
        equal(await page.getByTestId("not-configured").count(), 0, "complaints about the server on the front page");
        // GitHub cannot be reached from this site, so the page names no version and still offers the download.
        equal(await page.getByTestId("hero-facts").innerText(), "Android 8 or newer", "what the front page says about the app when it knows nothing");
        equal(await page.getByTestId("download-button").innerText(), "Download for Android", "the button without a version");
        equal(await page.getByTestId("slip-version").innerText(), "The newest build is on the releases page.", "the slip without a version");
        const fallback = await fetch(`${PLAIN}/download`, { redirect: "manual" });
        equal(fallback.status, 302, "the download link when GitHub cannot be asked");
        equal(fallback.headers.get("location"), "https://github.com/TRGamer-tech/shelfmark/releases", "where it leads then");
        // Everything behind the sign-in says plainly that the server is missing.
        await page.goto(`${PLAIN}/login`);
        await page.getByTestId("not-configured").waitFor();
        assert((await page.getByTestId("not-configured").innerText()).includes("The server is not configured"), "the notice is missing");
        await page.goto(`${PLAIN}/settings`);
        await page.getByTestId("not-configured").waitFor();
        const german = await newContext({ locale: "de-CH" });
        const germanPage = await german.newPage();
        await germanPage.goto(`${PLAIN}/login`);
        await germanPage.getByText("Der Server ist nicht eingerichtet").waitFor();
        await german.close();
        const keepalive = await (await fetch(`${PLAIN}/api/keepalive`)).json();
        equal(keepalive.ok, false, "keepalive without a server");
        equal(keepalive.reason, "not_configured", "keepalive without a server");
      },
      page,
    );
    await context.close();
  }

  // ------------------------------------------------------------------------------
  console.log("\nThe front page");

  await test(
    "a visitor at the address of the site gets the front page, drawn by the server",
    async () => {
      // What the server sends, before any script runs: the whole page, for readers and search engines.
      const html = await (await fetch(`${WEB}/`)).text();
      for (const part of [
        "<title>Shelfmark: a reading tracker that looks like a bookshelf</title>",
        "Keep your reading",
        "on a shelf.",
        "Scan a barcode",
        "Open Library, Google Books, Apple Books, lobid, the German National Library, K10plus and swisscovery",
        "14 things to stand between the books",
        "18 themes, 9 of them dark and 9 light",
        "Import your list from Goodreads, StoryGraph or any CSV file",
        "Friends who borrow",
        "Asked at the desk",
        "MIT",
        "Download Shelfmark 1.3.0",
      ]) {
        assert(html.includes(part), `the page the server sends holds: ${part}`);
      }
      const meta = (pattern) => pattern.exec(html)?.[1] ?? "";
      assert(meta(/<meta name="description" content="([^"]+)"/).startsWith("Keep the books you have read"), "a description for search engines");
      equal(meta(/<meta property="og:title" content="([^"]+)"/), "Shelfmark: a reading tracker that looks like a bookshelf", "the title of a link preview");
      equal(meta(/<meta property="og:locale" content="([^"]+)"/), "en_GB", "the language of a link preview");
      assert(/<link rel="alternate" hrefLang="de" href="[^"]*\/de"/i.test(html), "the German page is named as the other language");
      assert(/<link rel="canonical" href="[^"]+"/.test(html), "the page names its own address");
      const picture = new URL(meta(/<meta property="og:image" content="([^"]+)"/).replaceAll("&amp;", "&"));
      const png = Buffer.from(await (await fetch(`${WEB}${picture.pathname}${picture.search}`)).arrayBuffer());
      equal(png.subarray(1, 4).toString(), "PNG", "the picture of a link preview is a picture");
      equal(`${png.readUInt32BE(16)} x ${png.readUInt32BE(20)}`, "1200 x 630", "its size");

      const context = await newContext();
      const visitor = await context.newPage();
      await visitor.goto(`${WEB}/`);
      await visitor.getByTestId("landing").waitFor();
      equal(await visitor.evaluate(() => document.documentElement.dataset.visitor), "out", "who the page takes the visitor for");
      equal(await visitor.locator("h1").innerText(), "Keep your reading\non a shelf.", "the headline");
      // What the recording of GitHub says about the newest app is on the page.
      equal(await visitor.getByTestId("hero-facts").innerText(), "Version 1.3.0, 61 MB, Android 8 or newer", "the facts under the button");
      equal(await visitor.getByTestId("download-button").innerText(), "Download Shelfmark 1.3.0", "the button of the download section");
      equal(await visitor.getByTestId("slip-version").innerText(), "1.3.0, out since 23 November 2026", "the version on the slip");
      equal(await visitor.getByTestId("slip-file").innerText(), "Shelfmark-1.3.0-debug.apk, 61 MB", "the file on the slip");
      const section = await visitor.locator("#download").innerText();
      for (const words of ["pre-release build, signed with the project's own key", "does not come from an app store", "the phone asks once", "A newer version installs over the old one", "Android 8 or newer", "Free. No ads."]) {
        assert(section.includes(words), `near the download button it says: ${words}`);
      }
      // One way to the app and one way in, in the bar at the top and next to the headline.
      for (const id of ["front-download", "hero-download", "download-button"]) equal(await visitor.getByTestId(id).getAttribute("href"), "/download", `where ${id} leads`);
      for (const id of ["front-sign-in", "hero-sign-in"]) equal(await visitor.getByTestId(id).getAttribute("href"), "/login?lang=en", `where ${id} leads`);
      deepAudit(await audit(visitor), "front page");
      // Once the books have settled nothing on the page moves by itself: no flame flickers, nothing loops.
      const looping = await visitor.evaluate(() => Array.from(document.querySelectorAll(".landing *")).filter((element) => getComputedStyle(element).animationName !== "none" && getComputedStyle(element).animationIterationCount === "infinite").length);
      equal(looping, 0, "things on the front page that move without end");
      // Nobody is sent to the sign-in page any more.
      await visitor.waitForTimeout(700);
      equal(visitor.url(), `${WEB}/`, "the address a visitor stays on");
      await visitor.waitForTimeout(900);
      await shot(visitor, "landing-desktop");
      await shot(visitor, "landing-desktop-full", { fullPage: true, animations: "disabled" });

      await visitor.getByTestId("hero-sign-in").click();
      await visitor.getByTestId("login-form").waitFor();
      equal(await visitor.locator("h1").innerText(), "Sign in", "the page the sign-in link leads to");
      await visitor.waitForTimeout(400);
      await shot(visitor, "login");
      deepAudit(await audit(visitor), "sign-in page");
      // The name at the top leads back out.
      await visitor.getByRole("link", { name: "Shelfmark", exact: true }).click();
      await visitor.getByTestId("landing").waitFor();
      await context.close();

      const phone = await newContext({ viewport: { width: 400, height: 860 } });
      const phonePage = await phone.newPage();
      await phonePage.goto(`${WEB}/login`);
      await phonePage.getByTestId("login-form").waitFor();
      await phonePage.waitForTimeout(400);
      await shot(phonePage, "login-mobile");
      deepAudit(await audit(phonePage), "sign-in page on a phone");
      await phone.close();
    },
    null,
  );

  await test(
    "the front page in German, on a phone, with less movement, and without scripts",
    async () => {
      // A reader whose browser speaks German is taken to the German page.
      const german = await newContext({ locale: "de-CH" });
      const gp = await german.newPage();
      await gp.goto(`${WEB}/`);
      await gp.waitForURL(`${WEB}/de`);
      await gp.getByTestId("landing").waitFor();
      equal(await gp.locator("h1").innerText(), "Was du liest,\nkommt ins Regal.", "the German headline");
      equal(await gp.evaluate(() => document.documentElement.lang), "de", "the language the page says it is in");
      equal(await gp.getByTestId("hero-facts").innerText(), "Version 1.3.0, 61 MB, ab Android 8", "the facts in German");
      equal(await gp.getByTestId("front-sign-in").getAttribute("href"), "/login?lang=de", "the way in, in German");
      deepAudit(await audit(gp), "German front page");
      await gp.waitForTimeout(1500);
      await shot(gp, "landing-de");
      // Choosing English is remembered: the address of the site does not send them back.
      await gp.getByTestId("front-lang-en").click();
      await gp.waitForURL(`${WEB}/`);
      await gp.getByTestId("landing").waitFor();
      await gp.waitForTimeout(500);
      equal(gp.url(), `${WEB}/`, "the address after choosing English");
      equal(await gp.locator("h1").innerText(), "Keep your reading\non a shelf.", "the page after choosing English");
      await gp.getByTestId("front-lang-de").click();
      await gp.waitForURL(`${WEB}/de`);
      await german.close();

      const germanHtml = await (await fetch(`${WEB}/de`)).text();
      for (const part of ["<title>Shelfmark: ein Lesetagebuch, das wie ein Bücherregal aussieht</title>", 'lang="de"', "kommt ins Regal.", "7 Kataloge", "18 Designs, 9 davon dunkel und 9 hell", "An der Theke gefragt"]) {
        assert(germanHtml.includes(part), `the German page the server sends holds: ${part}`);
      }
      assert(/<meta property="og:locale" content="de_CH"/.test(germanHtml), "the language of the German link preview");

      // The German page asked for by its address stays German in any browser, and so does the sign-in behind it.
      const english = await newContext();
      const ep = await english.newPage();
      await ep.goto(`${WEB}/de`);
      await ep.getByTestId("landing").waitFor();
      equal(ep.url(), `${WEB}/de`, "the German address in an English browser");
      await ep.waitForTimeout(600);
      equal(await ep.evaluate(() => document.documentElement.lang), "de", "the language the German page says it is in, in an English browser");
      await ep.getByTestId("hero-sign-in").click();
      await ep.getByTestId("login-form").waitFor();
      equal(await ep.locator("h1").innerText(), "Anmelden", "the sign-in page after the German front page");
      await english.close();

      // Phone width: nothing wider than the screen, the bar at the top on one line, the books in several rows.
      const phone = await newContext({ viewport: PHONE });
      const pp = await phone.newPage();
      await pp.goto(`${WEB}/`);
      await pp.getByTestId("hero-shelf").locator("button.spine").first().waitFor();
      deepAudit(await audit(pp), "front page on a phone");
      assert((await pp.locator(".front-head").evaluate((head) => head.getBoundingClientRect().height)) < 90, "the bar at the top fits on one line");
      assert((await pp.getByTestId("hero-shelf").locator(".shelf-row").count()) >= 3, "the books of the hero stand in several rows on a phone");
      equal(await pp.getByTestId("hero-shelf").locator("button.spine").count(), 14, "books on the hero shelf on a phone");
      await pp.waitForTimeout(1500);
      await shot(pp, "landing-mobile-full", { fullPage: true, animations: "disabled" });
      await phone.close();

      // Less movement, when the system asks for it: nothing animates, everything works.
      const calm = await newContext({ reducedMotion: "reduce" });
      const cp = await calm.newPage();
      await cp.goto(`${WEB}/`);
      const spines = cp.getByTestId("hero-shelf").locator("button.spine");
      await spines.first().waitFor();
      await shot(cp, "landing-reduced-motion");
      const moving = await cp.evaluate(() => Array.from(document.querySelectorAll(".landing *")).filter((element) => getComputedStyle(element).animationName !== "none" || getComputedStyle(element).transitionDuration !== "0s").length);
      equal(moving, 0, "things on the front page that would move with reduced motion");
      await cp.getByTestId("hero-shelf").getByRole("button", { name: "Goals" }).click();
      assert((await cp.getByTestId("open-card").innerText()).includes("Books, pages or minutes"), "a book can still be taken off the shelf");
      // The other shelf follows without the beat in between.
      await cp.getByTestId("browser-view").selectOption("LIST");
      equal(await cp.locator('[data-testid="twin-phone"] .twin-frame').getAttribute("data-view"), "LIST", "the phone shelf follows at once with reduced motion");
      await calm.close();

      // Without scripts the page still says everything: all the cards lie open, and the download link is a plain link.
      const bare = await browser.newContext({ javaScriptEnabled: false, viewport: DESKTOP });
      const bp = await bare.newPage();
      await bp.goto(`${WEB}/`);
      equal(await bp.locator(".catalogue-card:visible").count(), 14, "cards a reader without scripts can read");
      // (Looked up by their place, not by their words: the test tool does not read inside "noscript".)
      const standIn = (selector) => bp.evaluate((css) => {
        const element = document.querySelector(css);
        return element && element.getBoundingClientRect().height > 0 ? element.textContent : null;
      }, selector);
      equal(await standIn(".shelf-plain"), "Each card below is something Shelfmark does.", "what stands where the shelf would be");
      equal(await standIn(".twin-plain"), "With scripts switched on, two shelves stand here that follow each other.", "what stands where the two shelves would be");
      equal(await bp.locator(".twin-stage:visible, .card-turn:visible, .shelf-hint:visible").count(), 0, "things that would need scripts and are shown anyway");
      equal(await bp.getByTestId("hero-download").getAttribute("href"), "/download", "the download link without scripts");
      assert(await bp.getByText("What does it cost?").isVisible(), "the questions without scripts");
      await bare.close();
    },
    null,
  );

  await test(
    "a book is taken off the shelf by mouse and by keyboard, and its card says what Shelfmark does",
    async () => {
      const context = await newContext();
      const visitor = await context.newPage();
      await visitor.goto(`${WEB}/`);
      const shelf = visitor.getByTestId("hero-shelf");
      const spines = shelf.locator("button.spine");
      await spines.first().waitFor();
      equal(await spines.count(), 14, "books on the shelf, each a button");
      equal(await shelf.locator("svg[data-ornament]").count(), 3, "ornaments between them");
      equal(await shelf.getByTestId("leaning").count(), 1, "the last book leans on its neighbour");
      // It is the shelf of the library itself: the same wooden board under the books.
      assert((await shelf.locator(".board").count()) >= 1, "the board the books stand on");
      // Every title can be read whole on its spine, in both languages.
      const cut = () => visitor.locator(".hero-shelf .spine-title span").evaluateAll((all) => all.filter((title) => title.scrollHeight > title.parentElement.clientHeight).map((title) => title.textContent));
      equal((await cut()).join(), "", "titles that do not fit their spine");
      const germanTab = await context.newPage();
      await germanTab.goto(`${WEB}/de`);
      await germanTab.locator(".hero-shelf button.spine").first().waitFor();
      equal((await germanTab.locator(".hero-shelf .spine-title span").evaluateAll((all) => all.filter((title) => title.scrollHeight > title.parentElement.clientHeight).map((title) => title.textContent))).join(), "", "German titles that do not fit their spine");
      await germanTab.close();
      const card = visitor.getByTestId("open-card");
      const pressed = () => shelf.locator('button.spine[aria-pressed="true"]').evaluateAll((all) => all.map((spine) => spine.getAttribute("aria-label")));
      equal((await pressed()).join(), "Scan a barcode", "the book that is off the shelf at first");
      assert((await card.innerText()).includes("A 1") && (await card.innerText()).includes("ISBN barcode"), "its card lies on the desk");
      equal(await visitor.locator(".catalogue-card:visible").count(), 1, "cards on the desk");

      // By mouse.
      await shelf.getByRole("button", { name: "Themes" }).click();
      equal((await pressed()).join(), "Themes", "the book that was clicked");
      const themes = await card.innerText();
      assert(themes.includes("B 4") && themes.includes("18 themes, 9 of them dark and 9 light"), `the card of the themes: ${themes}`);
      equal(await visitor.getByTestId("card-count").innerText(), "Card 7 of 14", "which card it is");
      await until(() => shelf.getByRole("button", { name: "Themes" }).evaluate((spine) => getComputedStyle(spine).translate === "0px -15px"), "the book stands out of the row");
      // The label on the spine and the corner of the card carry the same shelfmark.
      assert((await shelf.getByRole("button", { name: "Themes" }).locator(".spine-label").innerText()) === "B 4", "the shelfmark on the spine");
      await visitor.waitForTimeout(400);
      await shot(visitor, "landing-card");

      // Card by card, like flipping through a drawer.
      await visitor.getByTestId("card-next").click();
      assert((await card.innerText()).includes("Stars in half steps"), "the next card");
      equal((await pressed()).join(), "Stars and spice", "the book on the shelf follows the card");
      await visitor.getByTestId("card-previous").click();
      await visitor.getByTestId("card-previous").click();
      assert((await card.innerText()).includes("14 things to stand between the books"), "two cards back");

      // By keyboard: the skip link leads to the shelf, the arrows walk along the spines, Enter and Space take a book.
      await visitor.goto(`${WEB}/`);
      await spines.first().waitFor();
      await visitor.keyboard.press("Tab");
      equal(await visitor.evaluate(() => document.activeElement?.textContent), "Skip to the shelf", "the first stop of the keyboard");
      await visitor.keyboard.press("Enter");
      await visitor.keyboard.press("Tab");
      const focused = () => visitor.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      equal(await focused(), "Scan a barcode", "the first book takes the focus");
      assert(await visitor.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"), "the focus can be seen");
      await visitor.keyboard.press("ArrowRight");
      await visitor.keyboard.press("ArrowRight");
      equal(await focused(), "Bring your lists", "two books to the right");
      await visitor.keyboard.press("Enter");
      equal((await pressed()).join(), "Bring your lists", "Enter takes the book");
      assert((await card.innerText()).includes("Goodreads, StoryGraph or any CSV file"), "and its card is read");
      await visitor.keyboard.press("ArrowLeft");
      await visitor.keyboard.press("Space");
      equal((await pressed()).join(), "7 catalogues", "Space does the same one book to the left");
      await visitor.keyboard.press("ArrowLeft");
      await visitor.keyboard.press("ArrowLeft");
      equal(await focused(), "Friends who borrow", "left of the first book comes the last");
      await context.close();
    },
    null,
  );

  await test(
    "two shelves of one sample library follow each other: view, order and ornaments",
    async () => {
      const context = await newContext();
      const visitor = await context.newPage();
      await visitor.goto(`${WEB}/`);
      const frame = (device) => visitor.locator(`[data-testid="twin-${device}"] .twin-frame`);
      await frame("browser").locator(".spine").first().waitFor();
      await frame("phone").locator(".spine").first().waitFor();
      const titles = (device) => frame(device).locator(".spine, .cover-link").evaluateAll((all) => all.map((book) => book.getAttribute("aria-label")));
      // Books here do nothing when clicked, so they are not buttons.
      equal(await frame("browser").locator("button, a").count(), 0, "things in the sample shelf that pretend to be clickable");
      equal((await titles("browser")).join(), (await titles("phone")).join(), "both shelves hold the same books in the same order");
      // Side by side in the wide window, one under the other on the phone.
      const tops = (device) => frame(device).locator(".shelf-heading").evaluateAll((all) => all.map((heading) => Math.round(heading.getBoundingClientRect().top)));
      const [wideA, wideB] = await tops("browser");
      const [narrowA, narrowB] = await tops("phone");
      assert(wideA === wideB && narrowB > narrowA + 100, `shelves side by side in the browser (${wideA}, ${wideB}), stacked on the phone (${narrowA}, ${narrowB})`);

      // The view, changed in the browser.
      await visitor.getByTestId("browser-view").selectOption("COVERS");
      equal(await frame("browser").getAttribute("data-view"), "COVERS", "the browser shelf changes at once");
      await visitor.locator('[data-testid="twin-phone"] .twin-frame[data-view="COVERS"]').waitFor();
      equal(await visitor.getByTestId("twin-said").innerText(), "Changed in the browser. The phone has followed.", "what the page says about it");
      equal(await visitor.getByTestId("phone-view").inputValue(), "COVERS", "the phone's own control shows the new view");
      assert((await frame("phone").locator(".cover").count()) === 9, "covers on the phone shelf");
      // Ornaments stand among spines only, so their buttons rest in the other views.
      assert(await visitor.getByTestId("phone-candle-left").isDisabled(), "the candle cannot be moved where it does not stand");

      // The order, changed on the phone.
      await visitor.getByTestId("phone-sort").selectOption("TITLE");
      await visitor.locator('[data-testid="twin-browser"] .twin-frame[data-sort="TITLE"]').waitFor();
      equal(await visitor.getByTestId("twin-said").innerText(), "Changed on the phone. The browser has followed.", "what the page says the other way round");
      equal((await titles("browser")).join(), "Heidi,Middlemarch,Moby-Dick,Dracula,Effi Briest,Emma,Frankenstein,Jane Eyre,Walden", "the browser shelf by title, list by list");
      await visitor.getByTestId("phone-sort").selectOption("RATING");
      await visitor.locator('[data-testid="twin-browser"] .twin-frame[data-sort="RATING"]').waitFor();
      equal((await titles("browser"))[0], "Middlemarch", "the best rated book first");
      await visitor.getByTestId("browser-view").selectOption("LIST");
      await visitor.locator('[data-testid="twin-phone"] .twin-frame[data-view="LIST"]').waitFor();
      equal(await frame("phone").locator(".book-row").count(), 9, "rows of the list on the phone");

      // An ornament, moved on the phone and put up in the browser.
      await visitor.getByTestId("phone-view").selectOption("SPINES");
      await visitor.locator('[data-testid="twin-browser"] .twin-frame[data-view="SPINES"]').waitFor();
      const candleAfter = (device) =>
        frame(device)
          .locator(".shelf-section")
          .nth(1)
          .locator(".spine, svg[data-ornament]")
          .evaluateAll((all) => all.findIndex((thing) => thing.getAttribute("data-ornament") === "CANDLE"));
      equal(await candleAfter("phone"), 2, "books before the candle at first");
      await visitor.getByTestId("phone-candle-right").click();
      equal(await candleAfter("phone"), 3, "books before the candle after moving it on the phone");
      await until(async () => (await candleAfter("browser")) === 3, "the candle has moved in the browser as well");
      await visitor.getByTestId("browser-candle-left").click();
      await visitor.getByTestId("browser-candle-left").click();
      await until(async () => (await candleAfter("phone")) === 1, "and back again, from the browser");
      equal(await frame("phone").locator('svg[data-ornament="CAT"]').count(), 0, "cats before one was put up");
      await visitor.getByTestId("browser-cat").click();
      await frame("phone").locator('svg[data-ornament="CAT"]').waitFor();
      equal(await visitor.getByTestId("phone-cat").innerText(), "Remove the cat", "the button on the other side knows the cat is there");
      await visitor.locator(".twin").scrollIntoViewIfNeeded();
      await visitor.waitForTimeout(500);
      await shot(visitor, "landing-two-shelves");
      await context.close();
    },
    null,
  );

  await test(
    "the download link leads to the newest app in the project's releases",
    async () => {
      gateway.seen.length = 0;
      const answer = await fetch(`${WEB}/download`, { redirect: "manual" });
      equal(answer.status, 302, "the answer of the download link");
      equal(answer.headers.get("location"), "https://github.com/TRGamer-tech/shelfmark/releases/download/v1.3.0/Shelfmark-1.3.0-debug.apk", "where it leads: the .apk of the newest release, pre-release or not");
      equal(answer.headers.get("cache-control"), "no-store", "a browser does not keep the answer");
      // Asked again right away, GitHub is not bothered a second time.
      await fetch(`${WEB}/download`, { redirect: "manual" });
      assert(gateway.seen.filter((url) => url.startsWith("/api.github.com/")).length <= 1, `how often GitHub was asked for two downloads: ${gateway.seen.join(" ")}`);
      // In a browser the link on the page is that address.
      const context = await newContext();
      const visitor = await context.newPage();
      await visitor.goto(`${WEB}/`);
      const leaving = visitor.waitForRequest((request) => request.url().startsWith("https://github.com/TRGamer-tech/shelfmark/releases/download/"));
      await visitor.getByTestId("hero-download").click().catch(() => undefined);
      assert((await leaving).url().endsWith("/Shelfmark-1.3.0-debug.apk"), "the browser is sent to the file");
      await context.close();
    },
    null,
  );

  // ------------------------------------------------------------------------------
  console.log("\nAnna, on a desktop, in English");
  const annaContext = await newContext();
  const page = await annaContext.newPage();

  await test(
    "create an account and land on an empty shelf",
    async () => {
      // A page of the library asked for by somebody who is not signed in leads to the sign-in page.
      await page.goto(`${WEB}/lists`);
      await page.getByTestId("login-form").waitFor();
      assert(page.url().endsWith("/login"), "a visitor who is not signed in is sent to the sign-in page");

      await signUp(page, anna);
      await page.getByTestId("empty-library").waitFor();
      equal(await page.getByTestId("still-life").locator("svg").count(), 4, "the still life on the empty shelf");
      assert((await page.getByTestId("empty-library").innerText()).includes("Your shelf is still empty"), "the empty shelf says so");
      // The name given when signing up becomes the name of the library, and of the profile friends see.
      const vault = await untilVault(anna, (v) => v.prefs?.profileName === "Anna", "the name in the settings of the library");
      equal(vault.books.length, 0, "books of a new account");
      await until(async () => (await rpc(anna.session.token, "shelfmark_hello")).name === "Anna", "the name on the profile");
      await shot(page, "shelf-empty");
    },
    page,
  );

  await test(
    "somebody who is signed in finds their shelf at the address of the site and never sees the front page",
    async () => {
      const tab = await annaContext.newPage();
      await watchForFrontPage(tab);
      await tab.goto(`${WEB}/`);
      await tab.getByTestId("empty-library").waitFor();
      const seen = await frontPageSeen(tab);
      assert(seen.frames > 3, `the page was watched from its first frame: ${JSON.stringify(seen)}`);
      equal(seen.shown, 0, "frames in which the front page could be seen");
      equal(await tab.getByTestId("landing").count(), 0, "front pages left in the document once the shelf is there");
      equal(await tab.evaluate(() => document.documentElement.dataset.visitor), "in", "who the page takes Anna for");
      // The same at the German address, which has no shelf of its own.
      await tab.goto(`${WEB}/de`);
      await tab.getByTestId("empty-library").waitFor();
      equal(tab.url(), `${WEB}/`, "where the German address leads somebody who is signed in");
      equal((await frontPageSeen(tab)).shown, 0, "frames in which the German front page could be seen");
      await tab.close();
      // The watching itself works: a visitor does see the page.
      const visitors = await newContext();
      const visitor = await visitors.newPage();
      await watchForFrontPage(visitor);
      await visitor.goto(`${WEB}/`);
      await visitor.getByTestId("landing").waitFor();
      await visitor.waitForTimeout(300);
      assert((await frontPageSeen(visitor)).shown > 0, "a visitor sees the front page");
      await visitors.close();
    },
    page,
  );

  await test(
    "add a book by hand",
    async () => {
      await page.getByTestId("add-book").click();
      await page.getByTestId("add-page").waitFor();
      await page.getByTestId("manual-entry").click();
      await page.getByTestId("book-form").waitFor();
      await page.getByTestId("field-title").fill("Dracula");
      await page.getByTestId("field-authors").fill("Bram Stoker");
      await page.getByTestId("field-pages").fill("418");
      await page.getByTestId("field-year").fill("1897");
      await page.getByTestId("format-HARDCOVER").click();
      await page.getByTestId("field-genres").fill("Horror, Classics");
      await page.getByTestId("field-series").fill("Gothic");
      await page.getByTestId("field-series-position").fill("1.5");
      await page.getByTestId("save-book").click();
      await page.getByTestId("book-page").waitFor();
      equal(await page.getByTestId("book-title").innerText(), "Dracula", "the title on the book page");
      const vault = await untilVault(anna, (v) => bookOf(v, "Dracula"), "Dracula");
      const book = bookOf(vault, "Dracula");
      equal(book.authors, "Bram Stoker", "authors");
      equal(book.pageCount, 418, "pages");
      equal(book.format, "HARDCOVER", "format");
      equal(book.seriesPosition, 1.5, "series position");
      // New ids are the time in microseconds, far above the range a phone counts in.
      assert(book.id > 9e14 && Number.isSafeInteger(book.id), `the id ${book.id} is a website id`);
      // Fields that have their default value are left out, as the app does.
      assert(!("status" in book) && !("rating" in book) && !("lendable" in book), "defaults are not written");
    },
    page,
  );

  await test(
    "add a book through the search, with suggestions while typing",
    async () => {
      await page.goto(`${WEB}/add`);
      gateway.seen.length = 0;
      await page.getByTestId("search-field").pressSequentially("der vorl", { delay: 30 });
      await page.getByTestId("search-result").first().waitFor();
      equal(await page.getByTestId("results-heading").innerText(), "Suggestions", "the heading while typing");
      assert(gateway.seen.some((url) => url.startsWith("/openlibrary.org/search.json") && /vorl(\*|%2A)/.test(url)), "Open Library was asked with a wildcard");
      assert(gateway.seen.some((url) => url.startsWith("/lobid.org/")), "lobid was asked for suggestions");
      // The slow union catalogues are not asked on every keystroke.
      assert(!gateway.seen.some((url) => url.startsWith("/sru.k10plus.de/") || url.startsWith("/swisscovery.slsp.ch/")), "the slow catalogues were left alone");

      gateway.seen.length = 0;
      await page.getByTestId("show-all").click();
      await page.getByTestId("results-heading").filter({ hasText: "Results" }).waitFor();
      for (const host of ["openlibrary.org", "www.googleapis.com", "itunes.apple.com", "lobid.org", "services.dnb.de", "sru.k10plus.de", "swisscovery.slsp.ch"]) {
        assert(
          gateway.seen.some((url) => url.startsWith(`/${host}/`)),
          `${host} was asked in the full search`,
        );
      }
      const first = page.getByTestId("search-result").first();
      assert((await first.innerText()).includes("Der Vorleser"), "the novel itself ranks first");
      await first.click();
      await page.getByTestId("preview").waitFor();
      equal(await page.getByTestId("preview-title").innerText(), "Der Vorleser", "the preview");
      await page.getByTestId("pick-READING").click();
      await page.getByTestId("confirm-add").click();
      await page.getByTestId("book-page").waitFor();
      equal(await page.getByTestId("book-title").innerText(), "Der Vorleser", "the book that was added");
      equal(await page.getByTestId("status-READING").getAttribute("aria-pressed"), "true", "the list it was put on");
      const vault = await untilVault(anna, (v) => bookOf(v, "Der Vorleser"), "Der Vorleser");
      const book = bookOf(vault, "Der Vorleser");
      equal(book.isbn, "9783257229530", "ISBN from the catalogues");
      equal(book.authors, "Bernhard Schlink", "author from the catalogues");
      equal(book.status, "READING", "status");
      equal(book.startedOn, today, "starting a book stamps the start date");
      assert(book.pageCount > 0 && book.coverUrl.startsWith("https://"), "pages and cover came along");
      await page.locator('[data-testid="book-page"] [data-testid="cover-image"]').first().waitFor();

      // By ISBN, and the book that is already there is flagged.
      await page.goto(`${WEB}/add`);
      await page.getByTestId("search-field").fill("978-3-257-22953-0");
      await page.getByTestId("search-submit").click();
      await page.getByTestId("search-result").first().waitFor();
      await page.getByTestId("already-owned").first().waitFor();
      await page.getByTestId("search-result").first().click();
      await page.getByTestId("open-existing").waitFor();
      await page.getByTestId("open-existing").click();
      await page.getByTestId("book-page").waitFor();
      equal(await page.getByTestId("book-title").innerText(), "Der Vorleser", "the existing book is opened instead of added twice");
      equal((await vaultOf(anna)).vault.books.filter((b) => b.title === "Der Vorleser").length, 1, "copies of the book");
    },
    page,
  );

  await test(
    "change status, rating and spice, and write a review",
    async () => {
      await openBook(page, anna, "Der Vorleser");
      await page.getByTestId("star4").click();
      equal(await page.getByTestId("rating-text").innerText(), "4 / 5", "four stars");
      // Tapping the same star again takes half a star off.
      await page.getByTestId("star4").click();
      equal(await page.getByTestId("rating-text").innerText(), "3.5 / 5", "three and a half stars");
      await page.getByTestId("star5").click();
      await page.getByTestId("star5").click();
      equal(await page.getByTestId("rating-text").innerText(), "4.5 / 5", "four and a half stars");
      await page.getByTestId("spice2").click();
      assert((await page.getByTestId("spice-text").innerText()).includes("2/5"), "two chillies");
      await page.getByTestId("review").fill("Quiet and hard at once.");
      await page.getByTestId("started-on").fill("2026-11-02");
      await page.getByTestId("favourite").click();
      const vault = await untilVault(anna, (v) => bookOf(v, "Der Vorleser").review === "Quiet and hard at once." && bookOf(v, "Der Vorleser").favorite === true, "the review and the heart");
      const book = bookOf(vault, "Der Vorleser");
      equal(book.rating, 4.5, "rating");
      equal(book.spice, 2, "spice");
      equal(book.startedOn, Math.floor(Date.UTC(2026, 10, 2) / 86_400_000), "the start date that was typed in");
      // Moving a book between lists follows the rules of the app.
      await page.getByTestId("status-ABANDONED").click();
      await untilVault(anna, (v) => bookOf(v, "Der Vorleser").status === "ABANDONED", "abandoned");
      await page.getByTestId("status-READING").click();
      const again = bookOf(await untilVault(anna, (v) => bookOf(v, "Der Vorleser").status === "READING", "reading again"), "Der Vorleser");
      equal(again.startedOn, book.startedOn, "a date the reader entered is never overwritten");
      // The review is still there after loading the page anew.
      await page.reload();
      await page.getByTestId("review").waitFor();
      equal(await page.getByTestId("review").inputValue(), "Quiet and hard at once.", "the review after a reload");
      await shot(page, "book", { fullPage: true });
    },
    page,
  );

  await test(
    "log reading sessions until the book is finished",
    async () => {
      const book = await openBook(page, anna, "Der Vorleser");
      await page.getByTestId("log-session").click();
      await page.getByTestId("session-dialog").waitFor();
      equal(await page.getByTestId("session-from").inputValue(), "0", "a first session starts at the beginning");
      await page.getByTestId("session-to").fill("100");
      await page.getByTestId("session-minutes").fill("50");
      await page.getByTestId("session-save").click();
      await page.getByTestId("current-page").filter({ hasText: "100" }).waitFor();
      let vault = await untilVault(anna, (v) => v.sessions?.length === 1, "the first session");
      equal(vault.sessions[0].endPage, 100, "end page");
      equal(vault.sessions[0].minutes, 50, "minutes");
      assert(!("startPage" in vault.sessions[0]), "a start page of zero is the default and is left out");
      equal(bookOf(vault, "Der Vorleser").currentPage, 100, "the bookmark");

      // The bookmark can also be set directly.
      await page.getByTestId("page-field").fill("120");
      await page.getByTestId("page-set").click();
      await page.getByTestId("current-page").filter({ hasText: "120" }).waitFor();

      // Reading on past the end is not possible.
      await page.getByTestId("log-session").click();
      equal(await page.getByTestId("session-from").inputValue(), "120", "the next session starts where the bookmark is");
      await page.getByTestId("session-to").fill(String(book.pageCount + 5));
      assert(await page.getByTestId("session-save").isDisabled(), "a page beyond the last one cannot be saved");
      // Reaching the last page finishes the book.
      await page.getByTestId("session-to").fill(String(book.pageCount));
      await page.getByTestId("session-minutes").fill("95");
      await page.getByTestId("session-save").click();
      await page.locator('[data-testid="status-READ"][aria-pressed="true"]').waitFor();
      vault = await untilVault(anna, (v) => bookOf(v, "Der Vorleser").status === "READ", "the finished book");
      const finished = bookOf(vault, "Der Vorleser");
      equal(finished.finishedOn, today, "finishing stamps the end date");
      equal(finished.readCount, 1, "times read");
      equal(finished.currentPage, book.pageCount, "the bookmark at the end");
      equal(await page.getByTestId("finished-on").inputValue(), isoToday, "the end date on the page");
      await page.getByTestId("tab-reading").click();
      equal(await page.getByTestId("session-row").count(), 2, "sessions listed");
    },
    page,
  );

  let holidayId = 0;
  await test(
    "create lists, put a book on one, and see it as a shelf of its own",
    async () => {
      await page.goto(`${WEB}/lists`);
      await page.getByTestId("new-list").click();
      await page.getByTestId("name-field").fill("Holiday");
      await page.getByTestId("name-save").click();
      await page.getByTestId("list-row").filter({ hasText: "Holiday" }).waitFor();
      await page.getByTestId("new-list").click();
      await page.getByTestId("name-field").fill("Some day");
      await page.getByTestId("name-save").click();
      await page.getByTestId("list-row").filter({ hasText: "Some day" }).waitFor();
      // Rename one.
      await page.getByTestId("list-row").filter({ hasText: "Some day" }).getByTestId("rename-list").click();
      await page.getByTestId("name-field").fill("Someday");
      await page.getByTestId("name-save").click();
      let vault = await untilVault(anna, (v) => v.shelves.some((s) => s.name === "Someday") && v.shelves.some((s) => s.name === "Holiday"), "both lists");
      holidayId = vault.shelves.find((s) => s.name === "Holiday").id;
      const somedayId = vault.shelves.find((s) => s.name === "Someday").id;

      // Put Dracula on the holiday list, from its own page.
      const dracula = await openBook(page, anna, "Dracula");
      await page.getByTestId(`list-chip-${holidayId}`).click();
      vault = await untilVault(anna, (v) => v.links.some((l) => l.bookId === dracula.id && l.shelfId === holidayId), "the link between book and list");

      // On the shelf every list is a shelf of its own, also the empty one, which says what it waits for.
      await page.goto(`${WEB}/`);
      await page.getByTestId(`shelf-list_${holidayId}`).waitFor();
      assert((await page.getByTestId(`shelf-list_${holidayId}`).innerText()).includes("Holiday"), "the list is a shelf");
      await page.getByTestId(`empty-shelf-list_${somedayId}`).waitFor();
      assert((await page.getByTestId(`empty-shelf-list_${somedayId}`).innerText()).includes("This shelf is still empty"), "the empty shelf has its hint");
      // The books of a list by themselves.
      await page.goto(`${WEB}/lists`);
      await page.getByTestId("list-row").filter({ hasText: "Holiday" }).getByTestId("open-list").click();
      await page.getByTestId(`shelf-list_${holidayId}`).waitFor();
      assert(page.url().includes(`list=${holidayId}`), "the list is in the address");
      equal(await page.locator('[data-testid="cover"]').count(), 1, "books on the list");

      // Delete the other list. Its books would stay.
      await page.goto(`${WEB}/lists`);
      await page.getByTestId("list-row").filter({ hasText: "Someday" }).getByTestId("delete-list").click();
      await page.getByTestId("confirm").click();
      vault = await untilVault(anna, (v) => v.shelves.length === 1, "one list left");
      equal(vault.books.length, 2, "the books are untouched");
    },
    page,
  );

  await test(
    "add a quote, a note and a purchase",
    async () => {
      await page.goto(`${WEB}/quotes`);
      await page.getByTestId("add-quote").click();
      await page.getByTestId("quote-book").selectOption({ label: "Der Vorleser" });
      await page.getByTestId("quote-text").fill("I revealed nothing then that I should have kept silent about.");
      await page.getByTestId("quote-page").fill("129");
      await page.getByTestId("quote-save").click();
      await page.getByTestId("quote-card").waitFor();
      assert((await page.getByTestId("quote-card").innerText()).includes("p. 129"), "the page of the quote");
      // Edit it.
      await page.getByTestId("quote-card").locator("button").first().click();
      await page.getByTestId("quote-text").fill("I revealed nothing that I should have kept silent about.");
      await page.getByTestId("quote-save").click();
      let vault = await untilVault(anna, (v) => v.quotes[0]?.text === "I revealed nothing that I should have kept silent about.", "the edited quote");
      equal(vault.quotes.length, 1, "quotes");
      equal(vault.quotes[0].page, 129, "page of the quote");
      // A second one, which is then deleted again.
      await page.getByTestId("add-quote").click();
      await page.getByTestId("quote-book").selectOption({ label: "Dracula" });
      await page.getByTestId("quote-text").fill("Listen to them, the children of the night.");
      await page.getByTestId("quote-save").click();
      await untilVault(anna, (v) => v.quotes.length === 2, "two quotes");
      await page.getByTestId("quote-card").filter({ hasText: "children of the night" }).locator("button").first().click();
      await page.getByTestId("quote-delete").click();
      await page.getByTestId("confirm").click();
      await untilVault(anna, (v) => v.quotes.length === 1, "one quote again");

      const book = await openBook(page, anna, "Der Vorleser");
      await page.getByTestId("tab-notes").click();
      await page.getByTestId("add-note").click();
      await page.getByTestId("note-title").fill("People");
      await page.getByTestId("note-text").fill("Hanna keeps the secret to the end.");
      await page.getByTestId("note-save").click();
      await page.getByTestId("note-row").waitFor();
      await page.getByTestId("tab-quotes").click();
      equal(await page.getByTestId("quote-row").count(), 1, "the quote on the page of its book");
      await page.getByTestId("tab-overview").click();
      await page.getByTestId("add-purchase").click();
      await page.getByTestId("purchase-price").fill("14.90");
      await page.getByTestId("purchase-currency").fill("CHF");
      await page.getByTestId("purchase-store").fill("Orell");
      await page.getByTestId("purchase-save").click();
      await page.getByTestId("purchase-row").waitFor();
      assert((await page.getByTestId("purchase-row").innerText()).includes("14.90 CHF"), "the price with its currency");
      vault = await untilVault(anna, (v) => v.notes?.length === 1 && v.purchases?.length === 1, "the note and the purchase");
      equal(vault.notes[0].bookId, book.id, "the note belongs to the book");
      equal(vault.purchases[0].price, 14.9, "price");
      equal(vault.purchases[0].day, today, "the day of the purchase");
    },
    page,
  );

  await test(
    "statistics, goals, calendar, recap and milestones",
    async () => {
      await page.goto(`${WEB}/stats/goals`);
      await page.getByTestId("new-goal").click();
      await page.getByTestId("goal-dialog").waitFor();
      equal(await page.getByTestId("goal-target").inputValue(), "12", "a new goal starts as twelve books a year");
      await page.getByTestId("goal-save").click();
      await page.getByTestId("goal-card").waitFor();
      equal(await page.getByTestId("goal-done").innerText(), "1 of 12 books", "progress of the goal");
      const vault = await untilVault(anna, (v) => v.goals?.length === 1, "the goal");
      equal(vault.goals[0].repeat, "YEARLY", "repeat");
      equal(vault.goals[0].target, 12, "target");
      assert("startDay" in vault.goals[0] && "endDay" in vault.goals[0], "the days of a goal are always written, the app needs them");

      await page.goto(`${WEB}/stats`);
      await page.getByTestId("year-card").waitFor();
      const year = await page.getByTestId("year-card").innerText();
      assert(/1\s*\nBooks finished/i.test(year), `one book finished this year: ${year}`);
      const pages = bookOf(vault, "Der Vorleser").pageCount;
      // The first session read 100 pages, the second went from 120 to the end.
      assert(year.includes(String(100 + (pages - 120))), `pages read this year: ${year}`);
      assert(year.includes("2 h 25 min"), `reading time this year: ${year}`);
      assert((await page.getByTestId("goals-card").innerText()).includes("1 / 12"), "the goal on the statistics page");
      await shot(page, "stats", { fullPage: true });

      await page.getByTestId("open-calendar").click();
      await page.getByTestId("calendar-page").waitFor();
      const day = new Date().getUTCDate();
      await page.getByTestId(`day-${day}`).locator(".cover").waitFor();
      await page.getByTestId(`day-${day}`).click();
      await page.getByTestId("day-card").waitFor();
      const card = await page.getByTestId("day-card").innerText();
      assert(card.includes("Der Vorleser") && card.includes("Finished"), `the day knows what was read and finished: ${card}`);
      assert((await page.getByTestId("month-summary").innerText()).includes("1 finished"), "the summary of the month");
      await page.getByTestId("heatmap").waitFor();
      await shot(page, "calendar", { fullPage: true });
      await page.getByTestId("calendar-prev").click();
      assert((await page.getByTestId("month-summary").innerText()).startsWith("0 pages"), "nothing was read the month before");

      await page.goto(`${WEB}/stats/recap`);
      await page.getByTestId("recap-numbers").waitFor();
      const numbers = await page.getByTestId("recap-numbers").innerText();
      assert(/1\s*\nBooks finished/i.test(numbers) && /2\s*\nSessions/i.test(numbers), `the month in numbers: ${numbers}`);
      assert((await page.getByTestId("reader-type").innerText()).trim().length > 3, "the kind of reader has a name");
      assert((await page.getByTestId("recap-page").innerText()).includes("14.90 CHF"), "money spent on books");
      await shot(page, "recap", { fullPage: true });
      await page.getByTestId("recap-year").click();
      equal(await page.getByTestId("recap-period").innerText(), String(new Date().getUTCFullYear()), "the recap of the year");

      await page.goto(`${WEB}/stats/milestones`);
      await page.getByTestId("milestone-BOOKS").waitFor();
      equal(await page.getByTestId("milestone-BOOKS").getByTestId("milestone-value").innerText(), "1", "books finished");
      equal(await page.getByTestId("milestone-SESSIONS").getByTestId("milestone-value").innerText(), "2", "sessions");
      equal(await page.getByTestId("milestone-REVIEWS").getByTestId("milestone-value").innerText(), "1", "reviews");
      equal(await page.getByTestId("milestone-QUOTES").getByTestId("milestone-value").innerText(), "1", "quotes");
      assert((await page.getByTestId("timeline-item").first().innerText()).includes("Book number 1 finished"), "the journey remembers the first book");
      await shot(page, "milestones", { fullPage: true });
    },
    page,
  );

  await test(
    "view, sort and motion are kept in the library, so the shelf looks the same on every device",
    async () => {
      await addByHand(page, { title: "Faust", authors: "Johann Wolfgang von Goethe", pages: 320 });
      await addByHand(page, { title: "Emma", authors: "Jane Austen", pages: 474 });
      await page.goto(`${WEB}/`);
      // A new library opens the way the app does: covers, recently added first.
      await page.getByTestId("cover-shelf").waitFor();
      await page.getByTestId("view-menu").click();
      await page.getByTestId("view-SPINES").click();
      await page.getByTestId("spine-shelf").waitFor();
      await untilVault(anna, (v) => v.prefs.viewMode === "SPINES", "the view in the settings of the library");
      await page.getByTestId("view-menu").click();
      await page.getByTestId("sort-TITLE").click();
      await untilVault(anna, (v) => v.prefs.sort === "TITLE", "the sort order in the settings of the library");
      // Sorted by title, ignoring nothing here: Dracula, Emma, Faust stand in that order on the unread shelf.
      const unread = page.locator("section", { has: page.getByTestId("shelf-NONE") });
      const titles = await unread.locator('[data-testid="spine"], [data-testid="leaning"]').evaluateAll((spines) => spines.map((spine) => spine.getAttribute("aria-label")));
      equal(titles.join(", "), "Dracula, Emma, Faust", "the order on the shelf");
      // The last book of a shelf that is not full leans on its neighbour.
      equal(await unread.getByTestId("leaning").count(), 1, "leaning books on the unread shelf");
      equal(await unread.getByTestId("leaning").getAttribute("aria-label"), "Faust", "the book that leans");

      // A phone that changes the view is followed by the website: here the server is changed directly.
      const { vault, revision } = await vaultOf(anna);
      await rpc(anna.session.token, "shelfmark_vault_push", { p_payload: { ...vault, prefs: { ...vault.prefs, viewMode: "LIST", sort: "AUTHOR" } }, p_expected: revision });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByTestId("book-list").waitFor();
      const rows = await page.getByTestId("book-row").evaluateAll((items) => items.map((item) => item.querySelector(".book-row-title").textContent));
      equal(rows.join(", "), "Emma, Faust, Der Vorleser, Dracula", "the list sorted by surname, as the phone asked");
      // And it survives loading the page anew, because it lives in the library and not in this browser.
      await page.reload();
      await page.getByTestId("book-list").waitFor();
      equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => /view|sort|motion/i.test(key)).length), 0, "nothing about view, sort or motion is kept in the browser");
      await page.getByTestId("view-menu").click();
      await page.getByTestId("view-SPINES").click();
      await page.getByTestId("spine-shelf").waitFor();
      await page.getByTestId("view-menu").click();
      await page.getByTestId("sort-ADDED").click();
      await untilVault(anna, (v) => v.prefs.viewMode === "SPINES" && !("sort" in v.prefs), "spines again, and the default order left out");
    },
    page,
  );

  await test(
    "ornaments stand between the spines and can be added, moved and removed",
    async () => {
      await page.goto(`${WEB}/`);
      await page.getByTestId("decorate-READ").click();
      await page.getByTestId("ornament-dialog").waitFor();
      for (const kind of ["CANDLE", "MUG", "CAT"]) await page.getByTestId(`add-ornament-${kind}`).click();
      equal(await page.getByTestId("ornament-row").count(), 3, "ornaments in the dialog");
      let vault = await untilVault(anna, (v) => v.ornaments?.length === 3, "three ornaments");
      assert(
        vault.ornaments.every((o) => o.shelfKey === "READ" && o.position === 1),
        "new ornaments stand at the end of the shelf",
      );
      // Move the candle to the start of the shelf and take the mug away again.
      await page.getByTestId("ornament-row").first().getByRole("button", { name: /Move left/ }).click();
      await page.getByTestId("ornament-row").filter({ hasText: "At the start of the shelf" }).waitFor();
      await page.getByTestId("ornament-row").filter({ hasText: "Mug" }).getByRole("button", { name: /Delete/ }).click();
      vault = await untilVault(anna, (v) => v.ornaments.length === 2, "two ornaments");
      assert(!("position" in vault.ornaments.find((o) => o.kind === "CANDLE")), "position zero is the default and is left out");
      await page.getByTestId("ornament-done").click();
      const shelf = page.locator("section", { has: page.getByTestId("shelf-READ") });
      const order = await shelf.locator(".shelf-row-spines > *").evaluateAll((things) => things.map((thing) => thing.getAttribute("data-ornament") ?? thing.getAttribute("aria-label")));
      equal(order.join(", "), "CANDLE, Der Vorleser, CAT", "what stands on the shelf, in order");
      equal(await shelf.locator('svg[data-ornament="CANDLE"]').getAttribute("aria-label"), "Candle", "an ornament says what it is");
      // An ornament behind the last book holds the row up: nothing leans here.
      equal(await shelf.getByTestId("leaning").count(), 0, "leaning books next to an ornament");

      // The candle flickers, unless the reader switched the lively shelf off or the browser asks for calm.
      const flicker = () => page.locator('svg[data-ornament="CANDLE"] .flame').first().evaluate((flame) => getComputedStyle(flame).animationName);
      equal(await flicker(), "flicker", "the candle on a lively shelf");
      await page.emulateMedia({ reducedMotion: "reduce" });
      equal(await flicker(), "none", "the candle when the browser asks for reduced motion");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("motion").click();
      await untilVault(anna, (v) => v.prefs.motion === false, "motion switched off in the library");
      await page.goto(`${WEB}/`);
      await page.getByTestId("spine-shelf").waitFor();
      equal(await page.evaluate(() => document.documentElement.dataset.motion), "off", "the page knows that motion is off");
      equal(await flicker(), "none", "the candle with motion switched off");
      equal(await page.locator('svg[data-ornament="CANDLE"] .flame-glow').first().evaluate((glow) => getComputedStyle(glow).display), "none", "a candle that stands still is not lit");
      const moving = await page.evaluate(() => Array.from(document.querySelectorAll("*")).filter((element) => getComputedStyle(element).animationName !== "none").length);
      equal(moving, 0, "things that still move with motion switched off");
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("motion").click();
      await untilVault(anna, (v) => !("motion" in v.prefs), "motion on again, which is the default and left out");
    },
    page,
  );

  let uploaded = "";
  await test(
    "upload a cover picture, and see it on the shelf",
    async () => {
      // A phone photographed the cover of a book: it noted the name of its file in the book.
      const photographOnPhone = async (title, file) => {
        await waitSaved(page);
        const { vault, revision } = await vaultOf(anna);
        await rpc(anna.session.token, "shelfmark_vault_push", { p_payload: { ...vault, books: vault.books.map((b) => (b.title === title ? { ...b, coverPath: file } : b)) }, p_expected: revision });
      };
      await photographOnPhone("Dracula", "photo-dracula.jpg");
      const dracula = await openBook(page, anna, "Dracula");
      equal(dracula.coverPath, "photo-dracula.jpg", "the photo on the phone before anything is uploaded");
      await page.getByRole("link", { name: "Edit" }).click();
      await page.getByTestId("book-form").waitFor();
      // A photo as a phone takes it, far larger than a cover needs to be.
      writeFileSync(`${OUTPUT}cover-large.png`, png(1600, 2400, [110, 40, 46]));
      await page.getByTestId("cover-file").setInputFiles(`${OUTPUT}cover-large.png`);
      const picture = page.locator('[data-testid="book-form"] img[src*="/storage/v1/object/public/shelfmark-covers/"]');
      await picture.waitFor();
      uploaded = await picture.getAttribute("src");
      assert(uploaded.startsWith(`${SERVER}/storage/v1/object/public/shelfmark-covers/${anna.session.id}/`) && uploaded.endsWith(".jpg"), `the address of the picture: ${uploaded}`);
      // Nothing else in the form changed by uploading.
      equal(await page.getByTestId("field-title").inputValue(), "Dracula", "the title after uploading");
      await page.getByTestId("save-book").click();
      await page.getByTestId("book-page").waitFor();
      const vault = await untilVault(anna, (v) => bookOf(v, "Dracula").coverUrl === uploaded, "the address of the cover in the library");
      equal(bookOf(vault, "Dracula").pageCount, dracula.pageCount, "the rest of the book is untouched");
      // The phone that took the old photo would go on showing it, and upload it again over the new address.
      assert(!("coverPath" in bookOf(vault, "Dracula")), "an uploaded cover clears the name of the photo on the phone");

      // What was uploaded is a JPEG of at most 1000 pixels on the longer side, and anybody with the address can fetch it.
      const response = await fetch(uploaded);
      equal(response.status, 200, "fetching the cover without signing in");
      equal(response.headers.get("content-type"), "image/jpeg", "the kind of picture");
      const bytes = Buffer.from(await response.arrayBuffer());
      const size = jpegSize(bytes);
      assert(size && size.height === 1000 && size.width === 667, `scaled down to 667 x 1000: ${JSON.stringify(size)}`);
      assert(bytes.length < 2 * 1024 * 1024, "small enough for the server");

      // On the shelf, in every view that shows covers.
      await page.goto(`${WEB}/`);
      await page.getByTestId("view-menu").click();
      await page.getByTestId("view-COVERS").click();
      const onShelf = page.locator(`[data-testid="cover-shelf"] img[src="${uploaded}"]`).first();
      await onShelf.waitFor();
      await until(() => onShelf.evaluate((img) => img.complete && img.naturalWidth === 667), "the uploaded cover is drawn on the shelf");
      await page.waitForTimeout(600);
      await shot(page, "shelf-covers", { fullPage: true });

      // A failed upload is said in a few words and changes nothing.
      await page.goto(`${WEB}/book/edit?id=${dracula.id}`);
      await page.getByTestId("book-form").waitFor();
      await page.route("**/storage/v1/object/shelfmark-covers/**", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 400, contentType: "application/json", body: '{"statusCode":"413","error":"Payload too large"}' }) : route.continue()));
      await page.getByTestId("cover-file").setInputFiles(`${OUTPUT}cover-large.png`);
      await page.getByTestId("cover-problem").waitFor();
      equal(await page.getByTestId("cover-problem").innerText(), "The picture could not be uploaded.", "the words for a failed upload");
      equal(await picture.getAttribute("src"), uploaded, "the cover after a failed upload");
      await page.unroute("**/storage/v1/object/shelfmark-covers/**");
      // Somebody else's folder is closed, whatever the website would send.
      const foreign = await fetch(`${SERVER}/storage/v1/object/shelfmark-covers/00000000-0000-4000-8000-000000000000/x.jpg`, {
        method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${anna.session.token}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
        body: bytes,
      });
      assert(!foreign.ok, "writing below another account's folder is refused");

      // Picking a cover from the catalogues works from the same form, and clears the photo of the phone as well.
      await photographOnPhone("Faust", "photo-faust.jpg");
      const faust = bookOf((await vaultOf(anna)).vault, "Faust");
      await page.goto(`${WEB}/book/edit?id=${faust.id}`);
      await page.getByTestId("field-isbn").fill("9783257229530");
      await page.getByTestId("search-cover").click();
      await page.getByTestId("cover-choice").first().waitFor();
      await page.getByTestId("cover-choice").first().click();
      const chosen = await page.locator('[data-testid="book-form"] [data-testid="cover-image"]').getAttribute("src");
      assert(chosen.startsWith("https://covers.openlibrary.org/"), `a cover from the catalogues: ${chosen}`);
      await page.getByTestId("field-isbn").fill("");
      await page.getByTestId("save-book").click();
      await page.getByTestId("book-page").waitFor();
      const picked = bookOf(await untilVault(anna, (v) => bookOf(v, "Faust").coverUrl === chosen, "the cover from the catalogues"), "Faust");
      assert(!("coverPath" in picked), "a cover from the catalogues clears the name of the photo on the phone");
      // So does pasting an address.
      await photographOnPhone("Faust", "photo-faust-2.jpg");
      await page.goto(`${WEB}/book/edit?id=${faust.id}`);
      await page.getByTestId("book-form").waitFor();
      await page.getByTestId("cover-address").fill("https://example.org/faust.jpg");
      await page.getByTestId("cover-address-use").click();
      await page.getByTestId("save-book").click();
      await page.getByTestId("book-page").waitFor();
      const pasted = bookOf(await untilVault(anna, (v) => bookOf(v, "Faust").coverUrl === "https://example.org/faust.jpg", "the pasted address"), "Faust");
      assert(!("coverPath" in pasted), "a pasted address clears the name of the photo on the phone");

      // A book whose cover is only a photo on a phone gets the drawn cover here.
      await photographOnPhone("Emma", "cover_emma.jpg");
      const emma = bookOf((await vaultOf(anna)).vault, "Emma");
      await page.goto(`${WEB}/book?id=${emma.id}`);
      await page.getByTestId("book-page").waitFor();
      equal(await page.locator('[data-testid="book-page"] .book-head [data-testid="cover-image"]').count(), 0, "pictures on a book that has only a photo on the phone");
      assert((await page.locator('[data-testid="book-page"] .book-head .cover-title').innerText()).includes("Emma"), "the drawn cover carries the title");
      // Correcting something else about that book leaves its photo alone.
      await page.goto(`${WEB}/book/edit?id=${emma.id}`);
      await page.getByTestId("book-form").waitFor();
      await page.getByTestId("field-publisher").fill("John Murray");
      await page.getByTestId("save-book").click();
      await page.getByTestId("book-page").waitFor();
      const corrected = bookOf(await untilVault(anna, (v) => bookOf(v, "Emma").publisher === "John Murray", "the corrected publisher"), "Emma");
      equal(corrected.coverPath, "cover_emma.jpg", "the photo on the phone after another field was edited");
      assert(!corrected.coverUrl, "no address is invented for a photo that only the phone has");
    },
    page,
  );

  await test(
    "themes: the 18 of the app, the system setting, and one of my own",
    async () => {
      const background = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("theme-card").waitFor();
      equal(await page.locator('[data-testid^="theme-"][aria-pressed]').count(), 19, "the system setting and 18 themes to choose from");
      // "System" follows the browser: Paper in the light.
      equal(await background(), "#f5f1ea", "the system theme in a light browser");
      await page.emulateMedia({ colorScheme: "dark" });
      await until(async () => (await background()) === "#1f1a17", "the system theme in a dark browser is Ember");
      await page.emulateMedia({ colorScheme: "light" });

      await page.getByTestId("theme-ember").click();
      await until(async () => (await background()) === "#1f1a17", "Ember");
      await untilVault(anna, (v) => v.prefs.theme === "ember", "the theme in the library");
      await page.goto(`${WEB}/`);
      await page.getByTestId("view-menu").click();
      await page.getByTestId("view-SPINES").click();
      await page.getByTestId("spine-shelf").waitFor();
      await page.waitForTimeout(900);
      await shot(page, "shelf-dark");
      deepAudit(await audit(page), "shelf in the dark");

      // A theme of one's own, from four colours.
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("new-theme").click();
      await page.getByTestId("theme-name").fill("Moor");
      for (const [part, hex] of [["background", "#101510"], ["card", "#1C241C"], ["accent", "#7BC47F"], ["text", "#E8F0E8"]]) {
        await page.getByTestId(`colour-${part}`).click();
        await page.getByTestId("colour-hex").fill(hex);
        await page.getByTestId("colour-ok").click();
      }
      await page.getByTestId("theme-save").click();
      await until(async () => (await background()) === "#101510", "the page in my own colours");
      const vault = await untilVault(anna, (v) => v.prefs.customThemes?.length === 1 && v.prefs.theme.startsWith("custom:"), "the theme of my own in the library");
      const mine = vault.prefs.customThemes[0];
      // Colours are stored the way Android stores them: signed 32 bit numbers with the alpha on top.
      equal(mine.background, -15723248, "the background as Android writes it");
      equal(mine.accent, -8665985, "the accent as Android writes it");
      equal(vault.prefs.theme, `custom:${mine.id}`, "the key of the theme");
      await page.goto(`${WEB}/`);
      await page.getByTestId("spine-shelf").waitFor();
      await page.waitForTimeout(600);
      await shot(page, "shelf-own-theme");

      await page.goto(`${WEB}/settings`);
      await page.getByTestId("theme-paper").click();
      await until(async () => (await background()) === "#f5f1ea", "Paper");
      await untilVault(anna, (v) => v.prefs.theme === "paper", "Paper in the library");
      await page.goto(`${WEB}/`);
      await page.getByTestId("spine-shelf").waitFor();
      await page.waitForTimeout(900);
      await shot(page, "shelf-light");

      // Reading speed, by keyboard.
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("speed").focus();
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
      await untilVault(anna, (v) => v.prefs.minutesPerPage === 2, "two minutes a page");
      await shot(page, "settings", { fullPage: true });
    },
    page,
  );

  // ------------------------------------------------------------------------------
  console.log("\nBen, on a phone, in German");
  const benContext = await newContext({ viewport: PHONE, locale: "de-CH" });
  const benPage = await benContext.newPage();
  let benCode = "";
  // The id of the wish Anna makes for a book of Ben's. It becomes her borrowed copy.
  let annasMomo = 0;

  await test(
    "a second account, in German, on a phone-sized screen",
    async () => {
      await signUp(benPage, ben);
      await benPage.getByTestId("empty-library").waitFor();
      assert((await benPage.getByTestId("empty-library").innerText()).includes("Dein Regal ist noch leer"), "German on the empty shelf");
      equal(await benPage.evaluate(() => document.documentElement.lang), "de", "the language of the page");
      // On a phone the five places are in a bar at the bottom, as in the app.
      const bar = benPage.locator(".bottombar");
      assert(await bar.isVisible(), "the bottom bar");
      equal((await bar.innerText()).split("\n").filter(Boolean).join(", "), "Regal, Listen, Statistik, Zitate, Freunde", "the places in the bottom bar");
      assert(!(await benPage.locator(".sidebar").isVisible()), "no sidebar on a phone");
      deepAudit(await audit(benPage), "empty shelf on a phone");

      await addByHand(benPage, { title: "Momo", authors: "Michael Ende", pages: 304, status: "READ" });
      await benPage.getByTestId("star5").click();
      await benPage.getByTestId("star5").click();
      await benPage.getByTestId("review").fill("Zeit ist Leben.");
      await untilVault(ben, (v) => bookOf(v, "Momo")?.review === "Zeit ist Leben." && bookOf(v, "Momo").rating === 4.5, "Ben's review");
      // German words on the book page, with Swiss spelling.
      const text = await benPage.getByTestId("book-overview").innerText();
      assert(text.includes("Gelesen") && text.includes("Rezension".toUpperCase()) && text.includes("4.5 / 5"), `German on the book page: ${text.slice(0, 200)}`);
      deepAudit(await audit(benPage), "book page on a phone");

      await benPage.goto(`${WEB}/friends`);
      await benPage.getByTestId("friend-code").filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ }).waitFor();
      benCode = await benPage.getByTestId("friend-code").innerText();
      // The same words as the app for a code that cannot work.
      await benPage.getByTestId("add-friend").click();
      await benPage.getByTestId("friend-code-field").fill(benCode);
      await benPage.getByTestId("friend-code-add").click();
      await benPage.getByText("Das ist dein eigener Code.").waitFor();
      await benPage.getByTestId("friend-code-field").fill("ZZZZZ-99999");
      await benPage.getByTestId("friend-code-add").click();
      await benPage.getByText("Diesen Code hat niemand. Vielleicht vertippt?").waitFor();
      await benPage.keyboard.press("Escape");
      await benPage.getByTestId("add-friend-dialog").waitFor({ state: "detached" });
      deepAudit(await audit(benPage), "friends page on a phone");
    },
    benPage,
  );

  await test(
    "exchange the friend code, see the friend's shelf, ask for a book, and get a yes with a day",
    async () => {
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("friend-code").filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ }).waitFor();
      await page.getByTestId("add-friend").click();
      // Typed in small letters and without the hyphen: whatever is typed is accepted.
      await page.getByTestId("friend-code-field").fill(benCode.replace("-", "").toLowerCase());
      await page.getByTestId("friend-code-add").click();
      await page.getByText("You and Ben are friends now").waitFor();
      const card = page.getByTestId("friend-card").filter({ hasText: "Ben" });
      await card.filter({ hasText: "1 book" }).waitFor();
      await shot(page, "friends", { fullPage: true });
      deepAudit(await audit(page), "friends page");

      // Ben's shelf, with what Ben shares: a rating and a review.
      await card.getByTestId("open-friend").click();
      await page.getByTestId("friend-library").waitFor();
      await page.getByTestId("cover").waitFor();
      await page.waitForTimeout(500);
      await shot(page, "friend-shelf");
      await page.getByTestId("cover").click();
      await page.getByTestId("friend-book").waitFor();
      equal(await page.getByTestId("friend-review").innerText(), "Zeit ist Leben.", "the friend's review");
      assert((await page.getByTestId("friend-book").innerText()).includes("Ben owns this book"), "who owns it");

      // Anna asks for it, with a few words.
      await page.getByTestId("loan-note-field").fill("For the holidays?");
      await page.getByTestId("ask-to-borrow").click();
      const mine = page.getByTestId("my-loan");
      await mine.locator('[data-testid="loan"][data-state="asked"]').waitFor();
      equal(await mine.getByTestId("loan-standing").innerText(), `You asked on ${enDay(today)}. Waiting for Ben.`, "how the loan stands for Anna");
      equal(await mine.getByTestId("loan-note").innerText(), "“For the holidays?”", "the note she wrote");
      equal((await mine.locator(".loan-actions button").allInnerTexts()).join(" | "), "Take the question back", "what Anna can do now");
      equal(await page.getByTestId("ask-to-borrow").count(), 0, "ways to ask a second time");
      // On the server it is one record that both of them read.
      const [asked] = await loansOf(anna);
      equal([asked.state, asked.role, asked.peerName, asked.byMe].join(" "), "asked borrower Ben true", "the loan as Anna reads it");
      equal(JSON.stringify(Object.entries(asked.book).sort()), JSON.stringify(Object.entries({ title: "Momo", authors: "Michael Ende", isbn: "", coverUrl: "", pageCount: 304, format: "UNKNOWN" }).sort()), "what was noted of the book");
      equal(asked.note, "For the holidays?", "the note");
      const benVault = (await vaultOf(ben)).vault;
      const [benSees] = await loansOf(ben);
      equal([benSees.id, benSees.state, benSees.role, benSees.peerName, benSees.byMe].join(" "), `${asked.id} asked lender Anna false`, "the same loan as Ben reads it");
      equal(benSees.bookId, bookOf(benVault, "Momo").id, "the book it is about, by its id in Ben's library");
      assert(/^[0-9a-f-]{36}$/.test(asked.id), "the id of a loan is a UUID");
      // Neither library holds a copy of it: borrow requests in the vault are a thing of the past.
      assert(!("requests" in (await vaultOf(anna)).vault) && !("requests" in benVault), "no requests in either library");

      // A friend's book can go straight onto my wishlist. It is not mine, so it is not offered to others.
      await page.getByTestId("add-to-wishlist").click();
      const wished = bookOf(await untilVault(anna, (v) => bookOf(v, "Momo"), "Momo on Anna's wishlist"), "Momo");
      equal(wished.status, "WISHLIST", "the list it went on");
      equal(wished.ownership, "NOT_OWNED", "who owns it");
      equal(wished.authors, "Michael Ende", "what came along from the friend's shelf");
      annasMomo = wished.id;
      await page.keyboard.press("Escape");

      // Ben finds something waiting: on the Friends item of the bar, on the friends page, and on the page of the loans. In German.
      await benPage.goto(`${WEB}/friends`);
      const badge = benPage.locator('.bottombar [data-testid="nav-friends"] .nav-badge');
      await badge.waitFor();
      equal(await badge.innerText(), "1", "what waits for Ben, on the navigation");
      equal(await benPage.getByTestId("loans-waiting").innerText(), "1 Ausleihe wartet auf dich", "the same on the friends page");
      await benPage.getByTestId("open-loans").click();
      await benPage.getByTestId("loans-page").waitFor();
      equal(benPage.url(), `${WEB}/friends/loans`, "the address of the loans");
      equal(await benPage.locator("h1").innerText(), "Ausleihen", "the headline");
      const todo = benPage.getByTestId("loans-todo");
      await todo.getByTestId("loan-card").waitFor();
      equal((await todo.locator("h2").innerText()).toLowerCase(), "wartet auf dich", "the section it is listed in");
      equal(await todo.getByTestId("loan-line").innerText(), "«Momo» für Anna", "which book, and who");
      equal(await todo.getByTestId("loan-standing").innerText(), "Anna möchte dieses Buch ausleihen.", "how the loan stands for Ben");
      equal(await todo.getByTestId("loan-note").innerText(), "«For the holidays?»", "the note Anna wrote");
      equal((await todo.locator(".loan-actions button").allInnerTexts()).join(" | "), "Ja sagen | Nein sagen", "what Ben can do now");
      deepAudit(await audit(benPage), "loans page on a phone");
      await benPage.waitForTimeout(300);
      await shot(benPage, "loans-question-phone");

      // The page of the book shows the same question, with the same buttons.
      await todo.getByTestId("loan-open-book").click();
      await benPage.getByTestId("book-page").waitFor();
      const onBook = benPage.getByTestId("book-loans");
      equal(await onBook.getByTestId("loan-standing").innerText(), "Anna möchte dieses Buch ausleihen.", "the question on the page of the book");
      // A yes comes with the day the book is wanted back by, or with no fixed date.
      await onBook.getByTestId("loan-agree").click();
      const yes = benPage.getByTestId("loan-yes-dialog");
      await yes.waitFor();
      const asks = await yes.innerText();
      assert(asks.includes("«Momo» an Anna verleihen?") && asks.includes("Das Buch ist für Anna reserviert, bis du es übergibst. Bis wann möchtest du es zurück?"), `what the yes asks: ${asks}`);
      assert(asks.includes("Bis zu einem Datum") && asks.includes("Kein festes Datum"), "the two choices");
      assert(await benPage.getByTestId("due-pick").isChecked(), "a date is what is offered first");
      equal(await benPage.getByTestId("due-date").inputValue(), iso(today + 28), "the day offered: in four weeks");
      equal(await benPage.getByTestId("due-date").getAttribute("min"), iso(today), "the earliest day that can be picked");
      // A day that has passed is no day to ask a book back by.
      await benPage.getByTestId("due-date").fill(iso(today - 1));
      assert(await benPage.getByTestId("due-confirm").isDisabled(), "a day before today cannot be confirmed");
      deepAudit(await audit(benPage), "dialog for a yes");
      await shot(benPage, "loan-yes-dialog-phone");
      await benPage.getByTestId("due-date").fill(iso(today + 14));
      await benPage.getByTestId("due-confirm").click();
      await onBook.locator('[data-testid="loan"][data-state="agreed"]').waitFor();
      equal(await onBook.getByTestId("loan-standing").innerText(), "Reserviert für Anna.", "after the yes");
      equal(await onBook.getByTestId("loan-due").innerText(), `Zurück bis ${deDay(today + 14)}`, "the day on the loan");
      equal((await onBook.locator(".loan-actions button").allInnerTexts()).join(" | "), "Ich habe es übergeben | Datum ändern | Zusage zurücknehmen", "what Ben can do now");
      const [agreed] = await loansOf(ben);
      equal([agreed.state, agreed.dueOn, agreed.byMe].join(" "), `agreed ${today + 14} true`, "the loan on the server after the yes");
      // Reserved is not lent: the book counts as lent only once it is handed over. Lending by hand still works as it did.
      assert(!("lentTo" in bookOf((await vaultOf(ben)).vault, "Momo")), "a reserved book is not marked as lent");
      equal(await benPage.getByTestId("mark-lent").count(), 1, "the way to mark it as lent by hand");
      // But nobody else can ask for it now: Ben's shelf is published again and says so
      // ("available" is left out when it is false, as every default is).
      await until(async () => (await rpc(anna.session.token, "shelfmark_sync", { p_known: {} })).libraries[0]?.payload.library.books[0].available !== true, "the reserved book is no longer offered on Ben's shelf");

      // Anna hears of the yes while the site is open, and finds the loan on Ben's shelf.
      await lookNow(page);
      await page.locator(".toast").filter({ hasText: "Ben said yes to “Momo”" }).waitFor();
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("friend-card").getByTestId("open-friend").click();
      await page.getByTestId("cover").click();
      const reserved = page.getByTestId("my-loan").locator('[data-testid="loan"][data-state="agreed"]');
      await reserved.waitFor();
      equal(await reserved.getByTestId("loan-standing").innerText(), "Ben said yes. The book is reserved for you.", "the yes at Anna's");
      equal(await reserved.getByTestId("loan-due").innerText(), `Back by ${enDay(today + 14)}`, "the day at Anna's");
      equal(await reserved.getByTestId("loan-hint").innerText(), "Arrange the handover between you. Ben confirms it first, then you.", "who confirms the handover first");
      // The lender says first that the book was handed over: until then there is nothing for Anna to confirm.
      equal((await reserved.locator(".loan-actions button").allInnerTexts()).join(" | "), "Take the question back", "what Anna can do while it is reserved");
      equal(await page.locator('.sidebar [data-testid="nav-friends"] .nav-badge').count(), 0, "nothing waits for Anna");
      deepAudit(await audit(page), "a friend's book with a loan of mine");
      await page.waitForTimeout(300);
      await shot(page, "loan-reserved");
      await page.keyboard.press("Escape");
    },
    () => page,
  );

  await test(
    "the book changes hands when both have said so, stands on the borrower's shelf while it is out, and is back when both have said so",
    async () => {
      const loanId = (await loansOf(ben))[0].id;
      const momo = bookOf((await vaultOf(ben)).vault, "Momo");
      const atBens = (state) => benPage.locator(`[data-testid="loan"][data-loan="${loanId}"][data-state="${state}"]`);
      const atAnnas = (state) => page.locator(`[data-testid="loan"][data-loan="${loanId}"][data-state="${state}"]`);
      const buttons = (loan) => loan.locator(".loan-actions button").allInnerTexts().then((all) => all.join(" | "));

      // Ben says that he handed it over. That alone does not make it lent.
      await benPage.goto(`${WEB}/friends/loans`);
      await atBens("agreed").getByTestId("loan-hand").click();
      await atBens("handed").waitFor();
      equal(await atBens("handed").getByTestId("loan-standing").innerText(), "Du hast gesagt, du hast es übergeben. Warte auf die Bestätigung von Anna.", "after Ben's word");
      equal(await buttons(atBens("handed")), "Doch noch nicht übergeben | Datum ändern | Zusage zurücknehmen", "what Ben can do now");
      assert(!("lentTo" in bookOf((await vaultOf(ben)).vault, "Momo")), "handed over by one side is not lent yet");

      // Now it is Anna's turn, and the site says so wherever she is.
      await page.goto(`${WEB}/friends`);
      await page.locator(".toast").filter({ hasText: "Ben says “Momo” was handed over to you" }).waitFor();
      const annaBadge = page.locator('.sidebar [data-testid="nav-friends"] .nav-badge');
      await annaBadge.waitFor();
      equal(await annaBadge.innerText(), "1", "what waits for Anna, on the navigation");
      equal(await page.getByTestId("loans-waiting").innerText(), "1 loan waits for you", "the same on the friends page");
      await page.getByTestId("open-loans").click();
      await page.getByTestId("loans-todo").locator(`[data-loan="${loanId}"]`).waitFor();
      equal(await atAnnas("handed").getByTestId("loan-line").innerText(), "“Momo” from Ben", "which book, and who");
      equal(await atAnnas("handed").getByTestId("loan-standing").innerText(), "Ben says the book was handed over to you. Do you have it?", "the question to Anna");
      equal(await buttons(atAnnas("handed")), "I have it | I did not get it", "what Anna can do now");
      deepAudit(await audit(page), "loans page");
      await page.waitForTimeout(300);
      await shot(page, "loans-waiting");
      // She does not have it yet, and says so. It is reserved again, and Ben hears of it.
      await atAnnas("handed").getByTestId("loan-not_received").click();
      await atAnnas("agreed").waitFor();
      await lookNow(benPage);
      await benPage.locator(".toast").filter({ hasText: "Anna hat «Momo» nicht bekommen" }).waitFor();
      await atBens("agreed").getByTestId("loan-hand").click();
      await atBens("handed").waitFor();
      await lookNow(page);
      // The second handover is news again. It stands there once, not on top of the first, which Anna answered.
      await atAnnas("handed").waitFor();
      await page.locator(".toast").filter({ hasText: "Ben says “Momo” was handed over to you" }).first().waitFor();
      equal(await page.locator(".toast").count(), 1, "notices about the handover at Anna's");
      await atAnnas("handed").getByTestId("loan-receive").click();
      await atAnnas("on_loan").waitFor();
      // And once she has said that she has the book, the page has nothing left to say about the handover.
      equal(await page.locator(".toast").count(), 0, "notices about a handover Anna has confirmed");

      // On loan. For Anna it is listed under what she borrowed.
      await page.getByTestId("loans-borrowed").locator(`[data-loan="${loanId}"]`).waitFor();
      equal(await page.getByTestId("loans-todo").count(), 0, "things waiting for Anna");
      equal(await atAnnas("on_loan").getByTestId("loan-standing").innerText(), `Borrowed from Ben since ${enDay(today)}.`, "on loan, at Anna's");
      equal(await atAnnas("on_loan").getByTestId("loan-due").innerText(), `Back by ${enDay(today + 14)}`, "the day");
      equal(await atAnnas("on_loan").getByTestId("loan-hint").innerText(), "When you give the book back, say so here. Ben confirms it then.", "who confirms the return first");
      equal(await buttons(atAnnas("on_loan")), "I gave it back", "what Anna can do now");
      // The book stands on her own shelf as borrowed. Her wish for it is that copy: there is no second Momo.
      const withCopy = await untilVault(anna, (v) => bookOf(v, "Momo")?.ownership === "BORROWED", "Momo on Anna's shelf as borrowed");
      const copy = bookOf(withCopy, "Momo");
      equal(withCopy.books.filter((b) => b.title === "Momo").length, 1, "copies of Momo in Anna's library");
      equal(copy.id, annasMomo, "the wish became the borrowed copy");
      equal([copy.borrowedFrom, copy.loanId, copy.status].join(" "), `Ben ${loanId} WISHLIST`, "what the copy says");
      // Its page shows the loan with its steps, in the place of the free "borrowed from" field.
      await atAnnas("on_loan").getByTestId("loan-open-book").click();
      await page.getByTestId("book-page").waitFor();
      equal(page.url(), `${WEB}/book?id=${copy.id}`, "the page of the borrowed copy");
      const onCopy = page.getByTestId("book-loans");
      equal(await onCopy.getByTestId("loan-standing").innerText(), `Borrowed from Ben since ${enDay(today)}.`, "the loan on the page of the copy");
      equal(await onCopy.getByTestId("loan-give_back").innerText(), "I gave it back", "the step Anna can take there");
      equal(await page.getByTestId("borrowed-from").count(), 0, "free fields for whom it was borrowed from");
      equal(await page.getByTestId("own-BORROWED").getAttribute("aria-pressed"), "true", "what the book says about whose it is");
      assert(await page.getByTestId("own-OWNED").isDisabled(), "while the loan runs, the loan says whose book it is");
      deepAudit(await audit(page), "page of a borrowed copy");
      await page.waitForTimeout(300);
      equal(await page.locator(".toast").count(), 0, "notices on the page of the copy, about steps Anna has taken herself");
      await shot(page, "loan-borrowed-copy");
      // The copy cannot be deleted while the loan runs: the next look at the server would bring it back. The page says so.
      await page.getByTestId("delete-book").click();
      const tied = page.getByTestId("book-in-loan");
      await tied.waitFor();
      assert((await tied.innerText()).includes("This book is part of a loan. End the loan first, then the book can be removed."), "why the borrowed copy cannot be deleted");
      equal(await page.getByTestId("confirm").count(), 0, "ways to delete it all the same");
      equal(await tied.getByTestId("to-loans").getAttribute("href"), "/friends/loans", "where the loan can be ended");
      await page.keyboard.press("Escape");
      await tied.waitFor({ state: "detached" });
      assert(bookOf((await vaultOf(anna)).vault, "Momo"), "the copy is still in Anna's library");
      // And on the shelf it stands with the others.
      await page.goto(`${WEB}/?status=WISHLIST`);
      await page.getByTestId("shelf-WISHLIST").waitFor();

      // Ben hears that she has it. Now his copy is lent: to her, since today, by this loan.
      await lookNow(benPage);
      await benPage.locator(".toast").filter({ hasText: "Anna hat «Momo» jetzt" }).waitFor();
      const lent = bookOf(await untilVault(ben, (v) => bookOf(v, "Momo").lentTo === "Anna", "Momo lent to Anna in Ben's library"), "Momo");
      equal([lent.lentSince, lent.loanId].join(" "), `${today} ${loanId}`, "since when, and by which loan");
      await benPage.getByTestId("loans-lent").locator(`[data-loan="${loanId}"]`).waitFor();
      equal(await atBens("on_loan").getByTestId("loan-standing").innerText(), `Verliehen an Anna seit ${deDay(today)}.`, "on loan, at Ben's");
      equal(await buttons(atBens("on_loan")), "Ich habe es schon zurück | Datum ändern", "what Ben can do now");
      // On the page of his book the loan stands where lending by hand was.
      await benPage.goto(`${WEB}/book?id=${momo.id}`);
      await atBens("on_loan").waitFor();
      equal(await benPage.getByTestId("lent-to").count() + (await benPage.getByTestId("returned").count()) + (await benPage.getByTestId("mark-lent").count()), 0, "controls for lending by hand while the loan has the book");
      // Nor can the lender delete the book that is out: the loan would point at nothing.
      await benPage.getByTestId("delete-book").click();
      await benPage.getByTestId("book-in-loan").waitFor();
      assert((await benPage.getByTestId("book-in-loan").innerText()).includes("Dieses Buch gehört zu einer Ausleihe. Schliesse zuerst die Ausleihe ab, dann kann das Buch entfernt werden."), "why the lent book cannot be deleted, in German");
      await benPage.getByTestId("book-in-loan").getByRole("button", { name: "OK" }).click();
      await benPage.getByTestId("book-in-loan").waitFor({ state: "detached" });
      assert(bookOf((await vaultOf(ben)).vault, "Momo"), "the book is still in Ben's library");
      await benPage.goto(`${WEB}/`);
      await benPage.getByTestId("filter-lent").waitFor();
      assert((await benPage.getByTestId("filter-lent").innerText()).includes("Verliehen"), "a chip for what is lent out");

      // Ben changes the day: no fixed date after all. Anna is told.
      await benPage.goto(`${WEB}/book?id=${momo.id}`);
      await atBens("on_loan").getByTestId("loan-set_due").click();
      const change = benPage.getByTestId("loan-due-dialog");
      await change.waitFor();
      assert((await change.innerText()).includes("Bis wann möchtest du es zurück?"), "what the dialog asks");
      equal(await benPage.getByTestId("due-date").inputValue(), iso(today + 14), "the day that stands now");
      await benPage.getByTestId("due-open").check();
      equal(await benPage.getByTestId("due-date").count(), 0, "date fields for no fixed date");
      await benPage.getByTestId("due-confirm").click();
      await benPage.locator('[data-testid="loan-due"]').filter({ hasText: "Kein festes Datum" }).waitFor();
      equal((await loansOf(ben))[0].dueOn, null, "the day on the server");
      await lookNow(page);
      await page.locator(".toast").filter({ hasText: "Ben changed the date for “Momo”" }).waitFor();

      // Time passes and the day comes. (The page offers no day in the past, so the server is told directly.)
      await act(ben, loanId, "set_due", { p_due: today });
      await lookNow(benPage);
      // On the day itself the book is due, and not late yet.
      await benPage.locator('[data-testid="loan-due"][data-late="false"]').filter({ hasText: "Heute fällig" }).waitFor();
      const dueAtBens = benPage.locator('[data-testid="loan-due"][data-late="true"]');
      await act(ben, loanId, "set_due", { p_due: today - 2 });
      await lookNow(benPage);
      await dueAtBens.filter({ hasText: `War am ${deDay(today - 2)} fällig` }).waitFor();
      const warning = (locator) => locator.evaluate((line) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--danger-text)";
        document.body.appendChild(probe);
        const same = getComputedStyle(line).color === getComputedStyle(probe).color;
        probe.remove();
        return same;
      });
      assert(await warning(dueAtBens), "what is due is written in the warning colour, at the lender's");
      await benPage.waitForTimeout(300);
      await shot(benPage, "loan-overdue-phone");
      // Both sides see it, on the page of the loans and on the book.
      await page.goto(`${WEB}/friends/loans`);
      const dueAtAnnas = page.locator('[data-testid="loan-due"][data-late="true"]');
      await dueAtAnnas.waitFor();
      equal(await dueAtAnnas.innerText(), `Was due back on ${enDay(today - 2)}`, "the overdue loan at the borrower's");
      assert(await warning(dueAtAnnas), "in the warning colour there as well");
      await page.waitForTimeout(300);
      await shot(page, "loan-overdue");
      await page.goto(`${WEB}/book?id=${copy.id}`);
      await dueAtAnnas.waitFor();

      // Anna gives it back and says so. That alone does not end the loan.
      await atAnnas("on_loan").getByTestId("loan-give_back").click();
      await atAnnas("given_back").waitFor();
      equal(await atAnnas("given_back").getByTestId("loan-standing").innerText(), "You said you gave it back. Waiting for Ben to confirm.", "after Anna's word");
      equal(await buttons(atAnnas("given_back")), "Not given back yet", "what Anna can do now");
      equal(bookOf((await vaultOf(ben)).vault, "Momo").lentTo, "Anna", "still lent until Ben has it back");
      // Ben finds it waiting, and has not got it.
      await benPage.goto(`${WEB}/friends/loans`);
      await benPage.locator(".toast").filter({ hasText: "Anna sagt, «Momo» sei zurückgegeben" }).waitFor();
      await benPage.getByTestId("loans-todo").locator(`[data-loan="${loanId}"]`).waitFor();
      equal(await benPage.locator('.bottombar [data-testid="nav-friends"] .nav-badge').innerText(), "1", "what waits for Ben");
      equal(await atBens("given_back").getByTestId("loan-standing").innerText(), "Anna sagt, das Buch sei zurückgegeben. Hast du es?", "the question to Ben");
      equal(await buttons(atBens("given_back")), "Ich habe es zurück | Ich habe es nicht zurückbekommen | Datum ändern", "what Ben can do now");
      await atBens("given_back").getByTestId("loan-not_returned").click();
      await atBens("on_loan").waitFor();
      await lookNow(page);
      await page.locator(".toast").filter({ hasText: "Ben did not get “Momo” back" }).waitFor();
      await atAnnas("on_loan").getByTestId("loan-give_back").click();
      await atAnnas("given_back").waitFor();
      await lookNow(benPage);
      await atBens("given_back").getByTestId("loan-take_back").click();
      await atBens("returned").waitFor();

      // Back. Ben's copy is at home again, and can be asked for again.
      await benPage.getByTestId("loans-past").locator(`[data-loan="${loanId}"]`).waitFor();
      equal(await atBens("returned").getByTestId("loan-standing").innerText(), `Zurück von Anna seit ${deDay(today)}.`, "the loan at its end, at Ben's");
      equal(await buttons(atBens("returned")), "Weglegen", "what is left to do with it");
      equal(await atBens("returned").getByTestId("loan-due").count(), 0, "days on a loan that is over");
      const home = bookOf(await untilVault(ben, (v) => !("lentTo" in bookOf(v, "Momo")), "Momo at home in Ben's library"), "Momo");
      assert(!("loanId" in home) && !("lentSince" in home), "nothing of the loan is left on Ben's copy");
      await until(async () => (await rpc(anna.session.token, "shelfmark_sync", { p_known: {} })).libraries[0]?.payload.library.books[0].available === true, "the book is offered on Ben's shelf again");
      // Anna's copy stays with her as read and not hers, with what she noted in it.
      await lookNow(page);
      await page.locator(".toast").filter({ hasText: "Ben has “Momo” back" }).waitFor();
      const kept = bookOf(await untilVault(anna, (v) => bookOf(v, "Momo").ownership === "NOT_OWNED", "Anna's copy says: not mine"), "Momo");
      equal([kept.borrowedFrom, kept.loanId, kept.status].join(" "), `Ben ${loanId} WISHLIST`, "what the copy keeps");
      await atAnnas("returned").waitFor();
      equal(await atAnnas("returned").getByTestId("loan-standing").innerText(), `Given back to Ben on ${enDay(today)}.`, "the loan at its end, at Anna's");
      equal(await page.getByTestId("own-NOT_OWNED").getAttribute("aria-pressed"), "true", "whose the copy is now");
      assert(await page.getByTestId("own-OWNED").isEnabled(), "after the return it is hers to say whose it is");
      // A loan that is over can be put away, by each side for itself.
      await atAnnas("returned").getByTestId("loan-hide").click();
      await page.getByTestId("book-loans").waitFor({ state: "detached" });
      equal((await loansOf(anna)).length, 0, "loans Anna still sees");
      equal((await loansOf(ben)).length, 1, "loans Ben still sees");
      // The loan is put away, so the copy is a book borrowed by hand like any other. Saying by
      // hand that it is hers now (she bought it) ends what the book says about the loan.
      assert(bookOf((await vaultOf(anna)).vault, "Momo").loanId, "the copy still names the loan it came in by");
      await page.getByTestId("own-OWNED").click();
      const hers = bookOf(await untilVault(anna, (v) => bookOf(v, "Momo").ownership === undefined, "Momo is Anna's own now"), "Momo");
      assert(!("loanId" in hers), "a loan ended by hand is forgotten by the book");
      // She does not keep it after all. Deleted now, it stays deleted: the loan is over.
      await page.getByTestId("delete-book").click();
      await page.getByTestId("confirm").click();
      await untilVault(anna, (v) => !bookOf(v, "Momo"), "the copy taken off Anna's shelf");
      await lookNow(page);
      await page.waitForTimeout(600);
      assert(!bookOf((await vaultOf(anna)).vault, "Momo"), "a deleted copy does not come back after the return");

      // Ben stops sharing ratings: the review disappears from what Anna sees.
      await benPage.goto(`${WEB}/friends`);
      await benPage.getByTestId("share-ratings").click();
      await untilVault(ben, (v) => v.prefs.shareRatings === false, "ratings no longer shared");
      await until(async () => {
        const news = await rpc(anna.session.token, "shelfmark_sync", { p_known: {} });
        return news.libraries[0]?.payload.library.includesRatings === false;
      }, "the published library without ratings");
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("sync-now").click();
      await page.getByTestId("friend-card").getByTestId("open-friend").click();
      await page.getByTestId("cover").click();
      await page.getByTestId("friend-book").waitFor();
      equal(await page.getByTestId("friend-opinion").count(), 0, "the friend's opinion once they stopped sharing it");
      // After a loan that is over, the book can be asked for again.
      equal(await page.getByTestId("ask-to-borrow").count(), 1, "the way to ask again");
      await page.keyboard.press("Escape");
    },
    () => page,
  );

  await test(
    "a question taken back, a no with its reason, a yes taken back, and somebody who is told that the book went to another",
    async () => {
      const momo = bookOf((await vaultOf(ben)).vault, "Momo");
      const openMomo = async () => {
        await page.goto(`${WEB}/friends`);
        await page.getByTestId("friend-card").filter({ hasText: "Ben" }).getByTestId("open-friend").click();
        await page.getByTestId("cover").click();
        await page.getByTestId("friend-book").waitFor();
      };
      const buttons = (loan) => loan.locator(".loan-actions button").allInnerTexts().then((all) => all.join(" | "));

      // Anna asks again, and thinks better of it.
      await openMomo();
      await page.getByTestId("ask-to-borrow").click();
      const mine = page.getByTestId("my-loan");
      await mine.locator('[data-state="asked"]').waitFor();
      equal(await mine.getByTestId("loan-note").count(), 0, "notes when none was written");
      await mine.getByTestId("loan-withdraw").click();
      const last = page.getByTestId("last-loan");
      await last.locator('[data-state="withdrawn"]').waitFor();
      equal(await last.getByTestId("loan-standing").innerText(), "You took the question back.", "after taking the question back");
      equal(await buttons(last), "Put away", "what is left to do with it");
      // Asking again is possible right below.
      equal(await page.getByTestId("ask-to-borrow").count(), 1, "the way to ask again");
      await benPage.goto(`${WEB}/friends/loans`);
      const withdrawnAtBens = benPage.getByTestId("loans-past").locator('[data-state="withdrawn"]');
      await withdrawnAtBens.waitFor();
      equal(await withdrawnAtBens.getByTestId("loan-standing").innerText(), "Anna hat die Anfrage zurückgezogen.", "the question taken back, at Ben's");
      equal(await benPage.locator('.bottombar [data-testid="nav-friends"] .nav-badge').count(), 0, "nothing waits for Ben");
      await last.getByTestId("loan-hide").click();
      await last.waitFor({ state: "detached" });

      // She asks once more, and Ben says no, with a reason.
      await page.getByTestId("ask-to-borrow").click();
      await mine.locator('[data-state="asked"]').waitFor();
      await lookNow(benPage);
      await benPage.locator(".toast").filter({ hasText: "Anna möchte «Momo» ausleihen" }).waitFor();
      const question = benPage.getByTestId("loans-todo").locator('[data-testid="loan"]');
      await question.getByTestId("loan-decline").click();
      const no = benPage.getByTestId("loan-no-dialog");
      await no.waitFor();
      assert((await no.innerText()).includes("Anna absagen?"), "what the no asks");
      equal(await no.locator("label").innerText(), "Grund (optional)", "the reason may be left out");
      await benPage.getByTestId("reason-field").fill("Das lese ich gerade selbst");
      await benPage.getByTestId("reason-confirm").click();
      const declinedAtBens = benPage.getByTestId("loans-past").locator('[data-state="declined"]');
      await declinedAtBens.waitFor();
      equal(await declinedAtBens.getByTestId("loan-standing").innerText(), "Du hast Anna abgesagt.", "the no, at Ben's");
      equal(await declinedAtBens.getByTestId("loan-reason").innerText(), "Grund: Das lese ich gerade selbst", "the reason, at Ben's");
      await lookNow(page);
      await page.locator(".toast").filter({ hasText: "Ben said no to “Momo”" }).waitFor();
      await last.locator('[data-state="declined"]').waitFor();
      equal(await last.getByTestId("loan-standing").innerText(), "Ben said no.", "the no, at Anna's");
      equal(await last.getByTestId("loan-reason").innerText(), "Reason: Das lese ich gerade selbst", "the reason, at Anna's");
      await page.waitForTimeout(300);
      await shot(page, "loan-declined");
      await last.getByTestId("loan-hide").click();
      await last.waitFor({ state: "detached" });

      // Carl is a friend of Ben's too. He talks to the server directly, as another device would.
      const response = await fetch(`${SERVER}/auth/v1/signup`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: carl.email, password: carl.password }) });
      const session = await response.json();
      carl.session = { token: session.access_token, id: session.user.id };
      await rpc(carl.session.token, "shelfmark_hello", { p_name: "Carl" });
      await rpc(carl.session.token, "shelfmark_add_friend", { p_code: benCode });
      const ask = (who) => rpc(who.session.token, "shelfmark_loan_ask", { p_friend: ben.session.id, p_book: momo.id, p_info: { title: "Momo", authors: "Michael Ende" } });

      // While Anna still looks at the book as free, Carl asks and Ben says yes. Her question comes too late, and she is told why.
      const carls = await ask(carl);
      await act(ben, carls.id, "agree", { p_due: null });
      await page.getByTestId("ask-to-borrow").click();
      equal(await page.getByTestId("ask-problem").innerText(), "This book is reserved for somebody else or on loan.", "asking for a book that somebody else has reserved");
      equal(await page.getByTestId("my-loan").count(), 0, "loans made by a question that was refused");
      equal((await loansOf(anna)).length, 0, "loans of Anna's on the server");

      // Ben takes the yes back. The page asks first, and a reason can be given.
      await benPage.goto(`${WEB}/friends/loans`);
      const reservedForCarl = benPage.getByTestId("loans-open").locator(`[data-loan="${carls.id}"]`);
      await reservedForCarl.waitFor();
      equal(await reservedForCarl.getByTestId("loan-standing").innerText(), "Reserviert für Carl.", "the book reserved for Carl");
      equal(await reservedForCarl.getByTestId("loan-due").innerText(), "Kein festes Datum", "a yes without a day");
      await reservedForCarl.getByTestId("loan-cancel").click();
      const sure = benPage.getByTestId("loan-cancel-dialog");
      await sure.waitFor();
      assert((await sure.innerText()).includes("Zusage zurücknehmen?"), "the question before the yes is taken back");
      equal((await loansOf(carl))[0].state, "agreed", "nothing happens before Ben confirms");
      await benPage.getByTestId("reason-field").fill("Ich brauche es doch selbst");
      await benPage.getByTestId("reason-confirm").click();
      const cancelled = benPage.getByTestId("loans-past").locator(`[data-loan="${carls.id}"][data-state="cancelled"]`);
      await cancelled.waitFor();
      equal(await cancelled.getByTestId("loan-standing").innerText(), "Du hast die Zusage zurückgenommen.", "the yes taken back, at Ben's");
      const [told] = await loansOf(carl);
      equal([told.state, told.reason, told.byMe].join(" | "), "cancelled | Ich brauche es doch selbst | false", "what Carl is told");

      // Two people ask for the same book. Whoever does not get it is told that it went to somebody else. There is no waiting list.
      await until(async () => (await rpc(anna.session.token, "shelfmark_sync", { p_known: {} })).libraries[0]?.payload.library.books[0].available === true, "the book is offered on Ben's shelf again");
      await openMomo();
      await page.getByTestId("ask-to-borrow").click();
      await mine.locator('[data-state="asked"]').waitFor();
      const annas = (await loansOf(anna))[0];
      const second = await ask(carl);
      await benPage.goto(`${WEB}/friends`);
      const badge = benPage.locator('.bottombar [data-testid="nav-friends"] .nav-badge');
      await badge.filter({ hasText: "2" }).waitFor();
      equal(await benPage.getByTestId("loans-waiting").innerText(), "2 Ausleihen warten auf dich", "two questions wait for Ben");
      await benPage.getByTestId("open-loans").click();
      await benPage.getByTestId("loans-todo").getByTestId("loan-card").first().waitFor();
      equal(await benPage.getByTestId("loans-todo").getByTestId("loan-card").count(), 2, "questions for the same book");
      // The page of the book shows both of them.
      equal((await benPage.getByTestId("loans-todo").getByTestId("loan-line").allInnerTexts()).sort().join(" | "), "«Momo» für Anna | «Momo» für Carl", "who asked");
      await benPage.getByTestId("loans-todo").locator(`[data-loan="${second.id}"]`).getByTestId("loan-agree").click();
      await benPage.getByTestId("due-open").check();
      await benPage.getByTestId("due-confirm").click();
      await benPage.getByTestId("loans-open").locator(`[data-loan="${second.id}"][data-state="agreed"]`).waitFor();
      const passedOver = benPage.getByTestId("loans-past").locator(`[data-loan="${annas.id}"][data-state="declined"]`);
      await passedOver.waitFor();
      equal(await passedOver.getByTestId("loan-standing").innerText(), "Es ging an jemand anderen, und Anna weiss Bescheid.", "what Ben reads about the question that lost out");
      equal(await benPage.locator('.bottombar [data-testid="nav-friends"] .nav-badge').count(), 0, "nothing waits for Ben any more");
      await lookNow(page);
      await page.locator(".toast").filter({ hasText: "“Momo” went to somebody else" }).waitFor();
      await last.locator('[data-state="declined"]').waitFor();
      equal(await last.getByTestId("loan-standing").innerText(), "Somebody else got it. Ask again later.", "what Anna is told");
      equal(await last.getByTestId("loan-reason").count(), 0, "reasons quoted for a book that went to somebody else");
      const [taken] = await loansOf(anna);
      equal([taken.state, taken.reason].join(" "), "declined taken", "the loan on the server");
      // Ben's shelf says that the book cannot be had now, once it is published again.
      await until(async () => (await rpc(anna.session.token, "shelfmark_sync", { p_known: {} })).libraries[0]?.payload.library.books[0].available !== true, "the reserved book is not offered on Ben's shelf");
      await openMomo();
      equal(await page.getByTestId("not-available").innerText(), "This book cannot be borrowed at the moment.", "the book while somebody else has it reserved");
      equal(await page.getByTestId("ask-to-borrow").count(), 0, "ways to ask for it now");
      await page.waitForTimeout(300);
      await shot(page, "loan-taken");
      await last.getByTestId("loan-hide").click();
      await page.keyboard.press("Escape");

      // A step that is no longer possible: Carl took his question back while Ben's page still shows the yes.
      await act(carl, second.id, "withdraw");
      await benPage.getByTestId("loans-open").locator(`[data-loan="${second.id}"]`).getByTestId("loan-hand").click();
      await benPage.locator(".toast").filter({ hasText: "Das geht nicht mehr, die Ausleihe ist inzwischen weiter. So steht sie jetzt." }).waitFor();
      const gone = benPage.getByTestId("loans-past").locator(`[data-loan="${second.id}"][data-state="withdrawn"]`);
      await gone.waitFor();
      equal(await gone.getByTestId("loan-standing").innerText(), "Carl hat die Anfrage zurückgezogen.", "where the loan really stands");
      assert(!("lentTo" in bookOf((await vaultOf(ben)).vault, "Momo")), "a step that was refused changes no book");

      // A server from before the loans has no such function. The page says so in words.
      await page.route("**/rest/v1/rpc/shelfmark_loan_ask", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.shelfmark_loan_ask in the schema cache" }) }));
      await until(async () => (await rpc(anna.session.token, "shelfmark_sync", { p_known: {} })).libraries[0]?.payload.library.books[0].available === true, "the book is offered on Ben's shelf again");
      await openMomo();
      await page.getByTestId("ask-to-borrow").click();
      equal(await page.getByTestId("ask-problem").innerText(), "The server is not ready for this version of the app yet.", "asking on a server without loans");
      await page.unroute("**/rest/v1/rpc/shelfmark_loan_ask");
      await page.keyboard.press("Escape");
      // And an app from before the loans is told by the server that it is too old.
      const old = await fetch(`${SERVER}/rest/v1/rpc/shelfmark_send`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${carl.session.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_to: ben.session.id, p_payload: { app: "shelfmark", v: 1, type: "lend_request" } }) });
      equal(`${old.status} ${(await old.json()).message}`, "400 shelfmark:outdated", "what an old version is told when it sends a borrow request");
    },
    () => page,
  );

  await test(
    "a lender who has the book back before the borrower said so closes the loan, the old address leads to the loans, and an old file is told what it is",
    async () => {
      const momo = bookOf((await vaultOf(ben)).vault, "Momo");
      // Carl borrows Momo, and both confirm the handover. He then forgets all about it.
      const loan = await rpc(carl.session.token, "shelfmark_loan_ask", { p_friend: ben.session.id, p_book: momo.id, p_info: { title: "Momo", authors: "Michael Ende" }, p_note: "Bitte!" });
      await act(ben, loan.id, "agree", { p_due: today + 7 });
      await act(ben, loan.id, "hand");
      await act(carl, loan.id, "receive");
      // Whoever still has the address of the borrow requests is taken to the loans.
      await benPage.goto(`${WEB}/friends/requests`);
      await benPage.getByTestId("loans-page").waitFor();
      equal(benPage.url(), `${WEB}/friends/loans`, "where the old address leads");
      const out = benPage.getByTestId("loans-lent").locator(`[data-loan="${loan.id}"]`);
      await out.waitFor();
      equal(await out.getByTestId("loan-standing").innerText(), `Verliehen an Carl seit ${deDay(today)}.`, "the loan to Carl");
      equal(bookOf(await untilVault(ben, (v) => bookOf(v, "Momo").lentTo === "Carl", "Momo lent to Carl in Ben's library"), "Momo").loanId, loan.id, "the loan the book carries");
      // The book is back on Ben's shelf. Carl never said so. Ben closes the loan himself, after being asked.
      await out.getByTestId("loan-close").click();
      const sure = benPage.getByTestId("loan-close-dialog");
      await sure.waitFor();
      assert((await sure.innerText()).includes("Carl hat noch nicht gesagt, dass das Buch zurückgegeben wurde. Die Ausleihe trotzdem abschliessen?"), "the question before the loan is closed");
      equal((await loansOf(carl)).find((l) => l.id === loan.id).state, "on_loan", "nothing happens before Ben confirms");
      await sure.getByTestId("confirm").click();
      await benPage.getByTestId("loans-past").locator(`[data-loan="${loan.id}"][data-state="returned"]`).waitFor();
      await untilVault(ben, (v) => !("lentTo" in bookOf(v, "Momo")) && !("loanId" in bookOf(v, "Momo")), "Momo at home again");
      const closed = (await loansOf(carl)).find((l) => l.id === loan.id);
      equal([closed.state, String(closed.givenBackAt), closed.byMe].join(" "), "returned null false", "what Carl reads: back, without his word");
      // Ben puts away what is over. A loan both have put away is gone from the server with the next daily check.
      for (const id of (await loansOf(ben)).map((l) => l.id)) await act(ben, id, "hide");
      for (const id of (await loansOf(carl)).map((l) => l.id)) await act(carl, id, "hide");
      await rpc(ben.session.token, "shelfmark_ping");
      await benPage.getByTestId("sync-now").click();
      await benPage.getByText("Noch keine Ausleihen. Öffne das Regal von jemandem und frag nach einem Buch.").waitFor();
      equal(await benPage.getByTestId("loan-card").count(), 0, "loans left on Ben's page");

      // A file with a borrow request, as the app used to send them, cannot be opened any more. The page says where it comes from.
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("backup-file").setInputFiles(`${FIXTURES}old/lend-request.json`);
      equal(await page.getByTestId("backup-problem").innerText(), "This file comes from an older version of Shelfmark. Borrowing now works between accounts, without files.", "a file with a borrow request");
      await page.getByTestId("import-file").setInputFiles(`${FIXTURES}old/lend-answer.json`);
      equal(await page.getByTestId("import-problem").innerText(), "This file comes from an older version of Shelfmark. Borrowing now works between accounts, without files.", "a file with the answer to one");
    },
    () => page,
  );

  await test(
    "what a friend publishes under another name is ignored, and a book lent to a friend stays lent when the friendship ends",
    async () => {
      // Carl becomes Anna's friend as well, and then misbehaves.
      const annaCode = (await rpc(anna.session.token, "shelfmark_hello")).code;
      await rpc(carl.session.token, "shelfmark_add_friend", { p_code: annaCode });
      // A library that claims to be Ben's.
      await rpc(carl.session.token, "shelfmark_publish", {
        p_library: { app: "shelfmark", v: 1, type: "library", library: { ownerId: ben.session.id, ownerName: "Ben", createdAt: 1, includesStatus: true, includesRatings: true, books: [{ id: 1, title: "Forged" }] } },
      });
      // An honest question does arrive: he would like to borrow Dracula.
      const dracula = bookOf((await vaultOf(anna)).vault, "Dracula");
      const loan = await rpc(carl.session.token, "shelfmark_loan_ask", { p_friend: anna.session.id, p_book: dracula.id, p_info: { title: "Dracula", authors: "Bram Stoker", pageCount: 418, format: "PAPERBACK", rating: 5 }, p_note: "For Halloween" });
      await page.goto(`${WEB}/friends`);
      await page.locator(".toast").filter({ hasText: "Carl would like to borrow “Dracula”" }).waitFor();
      const carlCard = page.getByTestId("friend-card").filter({ hasText: "Carl" });
      await carlCard.waitFor();
      assert((await carlCard.innerText()).includes("has not shared a library yet"), "a library under a false name counts for nobody");
      // The Friends item of the navigation and the friends page say that something waits.
      const badge = page.locator('.sidebar [data-testid="nav-friends"] .nav-badge');
      await badge.waitFor();
      equal(await badge.innerText(), "1", "what waits for Anna");
      equal(await page.getByTestId("loans-waiting").innerText(), "1 loan waits for you", "the waiting question is announced");

      // The page of her book has the question, and everything that follows from it.
      await page.goto(`${WEB}/book?id=${dracula.id}`);
      const onBook = page.getByTestId("book-loans");
      const at = (state) => onBook.locator(`[data-testid="loan"][data-loan="${loan.id}"][data-state="${state}"]`);
      await at("asked").waitFor();
      equal(await at("asked").getByTestId("loan-standing").innerText(), "Carl would like to borrow this book.", "the question on the page of the book");
      equal(await at("asked").getByTestId("loan-note").innerText(), "“For Halloween”", "the note");
      await at("asked").getByTestId("loan-agree").click();
      const yes = page.getByTestId("loan-yes-dialog");
      await yes.waitFor();
      const asks = await yes.innerText();
      assert(asks.includes("Lend “Dracula” to Carl?") && asks.includes("The book is reserved for Carl until you hand it over. When would you like it back?"), `what the yes asks: ${asks}`);
      deepAudit(await audit(page), "dialog for a yes");
      await page.waitForTimeout(300);
      await shot(page, "loan-yes-dialog");
      await page.getByTestId("due-open").check();
      await page.getByTestId("due-confirm").click();
      await at("agreed").waitFor();
      equal(await at("agreed").getByTestId("loan-standing").innerText(), "Reserved for Carl.", "after the yes");
      equal(await at("agreed").getByTestId("loan-due").innerText(), "No fixed date", "a yes without a day");
      equal(await badge.count(), 0, "nothing waits for Anna any more");
      await at("agreed").getByTestId("loan-hand").click();
      await at("handed").waitFor();
      equal(await at("handed").getByTestId("loan-standing").innerText(), "You said you handed it over. Waiting for Carl to confirm.", "after Anna's word");
      // Not handed over after all: she takes that back, and hands it over the next day.
      await at("handed").getByTestId("loan-undo_hand").click();
      await at("agreed").getByTestId("loan-hand").click();
      await at("handed").waitFor();
      assert(!("lentTo" in bookOf((await vaultOf(anna)).vault, "Dracula")), "not lent before Carl has confirmed");
      equal(await page.getByTestId("mark-lent").count(), 1, "lending by hand, while no loan has the book");
      await act(carl, loan.id, "receive");
      await lookNow(page);
      await page.locator(".toast").filter({ hasText: "Carl has “Dracula” now" }).waitFor();
      await at("on_loan").waitFor();
      equal(await at("on_loan").getByTestId("loan-standing").innerText(), `Lent to Carl since ${enDay(today)}.`, "on loan");
      equal(await page.getByTestId("mark-lent").count() + (await page.getByTestId("returned").count()), 0, "controls for lending by hand while the loan has the book");
      const lent = bookOf(await untilVault(anna, (v) => bookOf(v, "Dracula").lentTo === "Carl", "Dracula lent to Carl in Anna's library"), "Dracula");
      equal([lent.lentSince, lent.loanId].join(" "), `${today} ${loan.id}`, "since when, and by which loan");
      // What Carl's device makes of it, by the rule both clients share: a copy with an id made from the loan's id.
      equal((await loansOf(carl)).find((l) => l.id === loan.id).book.title, "Dracula", "the book as the loan names it");
      deepAudit(await audit(page), "page of a book that is out on a loan");
      await page.waitForTimeout(300);
      await shot(page, "loan-lent-book");

      // Friends can be removed again. A book that is out stays a loan: it is still in somebody else's hands.
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("friend-card").filter({ hasText: "Carl" }).getByTestId("remove-friend").click();
      assert((await page.locator("dialog[open]").innerText()).includes("A book that is reserved or on loan stays a loan."), "what removing a friend does to loans");
      await page.getByTestId("confirm").click();
      await page.getByTestId("friend-card").filter({ hasText: "Carl" }).waitFor({ state: "detached" });
      equal((await rpc(anna.session.token, "shelfmark_sync", { p_known: {} })).friends.length, 1, "friends left");
      await page.getByTestId("open-loans").click();
      await page.getByTestId("loans-lent").locator(`[data-loan="${loan.id}"][data-state="on_loan"]`).waitFor();
      equal(bookOf((await vaultOf(anna)).vault, "Dracula").lentTo, "Carl", "the book is still lent");
    },
    page,
  );

  await test(
    "a friend without a name, a loan that vanishes with its account, and a friendship that ends with questions open",
    async () => {
      const nora = account("Nora");
      const context = await newContext();
      const np = await context.newPage();
      // Looks at the server until the page shows the news. One look may join a look that was on its way before the news.
      const lookUntil = (seen, what) =>
        until(async () => {
          await lookNow(np);
          return seen();
        }, what);
      await signUp(np, nora);
      await np.getByTestId("empty-library").waitFor();
      await addByHand(np, { title: "Heidi", authors: "Johanna Spyri" });
      await addByHand(np, { title: "Krabat", authors: "Otfried Preussler" });
      nora.session = await signIn(nora.email, nora.password);
      await until(async () => (await rpc(nora.session.token, "shelfmark_hello")).name === "Nora", "the name Nora gave herself reaches her profile");
      const noraCode = (await rpc(nora.session.token, "shelfmark_hello")).code;
      const heidi = bookOf((await vaultOf(nora)).vault, "Heidi");
      const krabat = bookOf((await vaultOf(nora)).vault, "Krabat");

      // Pia never gave herself a name. She borrows Heidi.
      const pia = account("Pia");
      await signUpByApi(pia, "");
      equal((await rpc(pia.session.token, "shelfmark_hello")).name, "", "the name of somebody who never gave one");
      await rpc(pia.session.token, "shelfmark_add_friend", { p_code: noraCode });
      const loan = await rpc(pia.session.token, "shelfmark_loan_ask", { p_friend: nora.session.id, p_book: heidi.id, p_info: { title: "Heidi", authors: "Johanna Spyri" } });
      equal(loan.peerName, "Nora", "the lender's name, for Pia");
      await act(nora, loan.id, "agree", { p_due: null });
      await act(nora, loan.id, "hand");
      await act(pia, loan.id, "receive");
      await np.goto(`${WEB}/book?id=${heidi.id}`);
      const onBook = np.getByTestId("book-loans").locator('[data-testid="loan"][data-state="on_loan"]');
      await onBook.waitFor();
      // The page speaks of somebody. The book carries a question mark: an empty name would mean that it is at home.
      equal(await onBook.getByTestId("loan-standing").innerText(), `Lent to Someone since ${enDay(today)}.`, "a loan to a friend without a name");
      const lent = bookOf(await untilVault(nora, (v) => bookOf(v, "Heidi").loanId === loan.id, "Heidi lent by the loan"), "Heidi");
      equal(lent.lentTo, "?", "the name the book carries for a friend who has none");
      equal(lent.lentSince, today, "the day the book carries");

      // The book cannot be deleted while it is out.
      await np.getByTestId("delete-book").click();
      await np.getByTestId("book-in-loan").waitFor();
      assert((await np.getByTestId("book-in-loan").innerText()).includes("This book is part of a loan. End the loan first, then the book can be removed."), "why the book cannot be deleted");
      deepAudit(await audit(np), "the notice for a book that is part of a loan");
      await np.waitForTimeout(300);
      await shot(np, "book-in-loan");
      await np.getByTestId("book-in-loan").getByRole("button", { name: "OK" }).click();
      await np.getByTestId("book-in-loan").waitFor({ state: "detached" });

      // Pia deletes her account. The loan is gone with it: nothing on the server tells of it any more.
      await rpc(pia.session.token, "shelfmark_delete_account");
      equal((await loansOf(nora)).length, 0, "loans Nora still reads");
      await lookUntil(async () => (await np.getByTestId("book-loans").count()) === 0, "the loan leaves the page of the book");
      // The book is lent by hand again, as to somebody without Shelfmark, with the controls for that.
      equal(await np.getByTestId("lent-to").innerText(), `Lent to ? since ${enDay(today)}`, "what the book says once its loan is gone");
      equal(bookOf((await vaultOf(nora)).vault, "Heidi").loanId, loan.id, "the book still names the loan that is gone");
      // "Got it back", said by hand, ends it and empties the loan the book carried.
      await np.getByTestId("returned").click();
      const home = bookOf(await untilVault(nora, (v) => !("lentTo" in bookOf(v, "Heidi")), "Heidi at home again"), "Heidi");
      assert(!("loanId" in home) && !("lentSince" in home), "nothing of the loan is left on the book");
      await np.getByTestId("mark-lent").waitFor();
      // Now it can be deleted like any book.
      await np.getByTestId("delete-book").click();
      await np.getByTestId("confirm").click();
      await untilVault(nora, (v) => !bookOf(v, "Heidi"), "Heidi deleted");

      // Otto is a friend with a name. He asks Nora for Krabat, and Nora asks him for a book of his.
      const otto = account("Otto");
      await signUpByApi(otto);
      await rpc(otto.session.token, "shelfmark_add_friend", { p_code: noraCode });
      const his = await rpc(otto.session.token, "shelfmark_loan_ask", { p_friend: nora.session.id, p_book: krabat.id, p_info: { title: "Krabat" } });
      const hers = await rpc(nora.session.token, "shelfmark_loan_ask", { p_friend: otto.session.id, p_book: 5, p_info: { title: "Jim Knopf" } });
      // A book somebody asked for cannot be deleted either: the question would point at nothing.
      await np.goto(`${WEB}/book?id=${krabat.id}`);
      await np.getByTestId("book-loans").locator('[data-state="asked"]').waitFor();
      await np.getByTestId("delete-book").click();
      await np.getByTestId("book-in-loan").waitFor();
      equal(await np.getByTestId("confirm").count(), 0, "ways to delete a book somebody asked for");
      await np.keyboard.press("Escape");
      await np.getByTestId("book-in-loan").waitFor({ state: "detached" });

      // Nora ends the friendship. Her own question is taken back, Otto's is answered with a no.
      await np.goto(`${WEB}/friends`);
      const card = np.getByTestId("friend-card").filter({ hasText: "Otto" });
      await card.waitFor();
      await card.getByTestId("remove-friend").click();
      assert((await np.locator("dialog[open]").innerText()).includes("Questions nobody answered yet end with it."), "what ending a friendship does to open questions");
      await np.getByTestId("confirm").click();
      await card.waitFor({ state: "detached" });
      const ottos = await loansOf(otto);
      const asOttoReads = (id) => {
        const found = ottos.find((l) => l.id === id);
        return `${found?.state} ${found?.byMe}`;
      };
      equal(asOttoReads(his.id), "declined false", "Otto's question, as Otto reads it");
      equal(asOttoReads(hers.id), "withdrawn false", "Nora's question, as Otto reads it");
      await np.getByTestId("open-loans").click();
      const past = np.getByTestId("loans-past");
      await past.locator(`[data-loan="${his.id}"][data-state="declined"]`).waitFor();
      equal(await past.locator(`[data-loan="${his.id}"]`).getByTestId("loan-standing").innerText(), "You said no to Otto.", "what Nora reads about Otto's question");
      equal(await past.locator(`[data-loan="${hers.id}"]`).getByTestId("loan-standing").innerText(), "You took the question back.", "what Nora reads about her own");
      equal(await np.locator('.sidebar [data-testid="nav-friends"] .nav-badge').count(), 0, "nothing waits for Nora");

      // The other way round. Paul ends the friendship while a question of his and one of Nora's are open:
      // his is taken back, hers is answered with a no, and Nora is told both.
      const paul = account("Paul");
      await signUpByApi(paul);
      await rpc(paul.session.token, "shelfmark_add_friend", { p_code: noraCode });
      const pauls = await rpc(paul.session.token, "shelfmark_loan_ask", { p_friend: nora.session.id, p_book: krabat.id, p_info: { title: "Krabat" } });
      const noras = await rpc(nora.session.token, "shelfmark_loan_ask", { p_friend: paul.session.id, p_book: 7, p_info: { title: "Tintenherz" } });
      const waiting = np.getByTestId("loans-todo").locator(`[data-loan="${pauls.id}"][data-state="asked"]`);
      await lookUntil(async () => (await waiting.count()) === 1, "Paul's question on Nora's page");
      await np.getByTestId("loans-open").locator(`[data-loan="${noras.id}"][data-state="asked"]`).waitFor();
      await rpc(paul.session.token, "shelfmark_remove_friend", { p_friend: nora.session.id });
      const told = np.locator(".toast").filter({ hasText: "Paul said no to “Tintenherz”" });
      await lookUntil(async () => (await told.count()) === 1, "Nora is told that her question was answered with a no");
      await np.locator(".toast").filter({ hasText: "Paul no longer asks for “Krabat”" }).waitFor();
      equal(await past.locator(`[data-loan="${noras.id}"]`).getByTestId("loan-standing").innerText(), "Paul said no.", "Nora's question after Paul ended the friendship");
      equal(await past.locator(`[data-loan="${pauls.id}"]`).getByTestId("loan-standing").innerText(), "Paul took the question back.", "Paul's question after he ended the friendship");
      equal(await np.locator('.sidebar [data-testid="nav-friends"] .nav-badge').count(), 0, "nothing waits for Nora after that either");

      // With the questions gone, the book can be deleted.
      await np.goto(`${WEB}/book?id=${krabat.id}`);
      await np.getByTestId("book-overview").waitFor();
      await np.getByTestId("delete-book").click();
      await np.getByTestId("confirm").click();
      await untilVault(nora, (v) => v.books.length === 0, "Krabat deleted");
      await context.close();
    },
    null,
  );

  await test(
    "each step of a loan is announced once, and not at all once the reader has acted on it",
    async () => {
      // Rita reads in a browser. Lars lends, and talks to the server as his phone would.
      const rita = account("Rita");
      const lars = account("Lars");
      await signUpByApi(rita);
      await signUpByApi(lars);
      await rpc(rita.session.token, "shelfmark_add_friend", { p_code: (await rpc(lars.session.token, "shelfmark_hello")).code });
      const loan = await rpc(rita.session.token, "shelfmark_loan_ask", { p_friend: lars.session.id, p_book: 1, p_info: { title: "Tschick", authors: "Wolfgang Herrndorf" } });
      const context = await newContext();
      const rp = await context.newPage();
      await signInOnPage(rp, rita);
      await rp.getByTestId("empty-library").waitFor();
      await rp.goto(`${WEB}/friends/loans`);
      const card = (state, on = rp) => on.locator(`[data-testid="loan"][data-loan="${loan.id}"][data-state="${state}"]`);
      await card("asked").waitFor();
      const notices = rp.locator(".toast");
      const said = (words) => notices.filter({ hasText: words });
      /** Looks at the server until the page shows what happened there. One look may join a look that was on its way before the news. */
      const shows = (check, what, on = rp) =>
        until(async () => {
          await lookNow(on);
          return check();
        }, what);
      const stands = (state) => shows(async () => (await card(state).count()) === 1, `the loan stands as ${state}`);
      const dueSays = (words, on = rp) => shows(async () => (await on.getByTestId("loan-due").innerText()) === words, `the day reads: ${words}`, on);
      const settle = () => rp.waitForTimeout(700);
      equal(await notices.count(), 0, "news on the first look after signing in");

      // Lars says yes. Rita is told once, however often and from wherever her browser looks.
      await act(lars, loan.id, "agree", { p_due: today + 14 });
      await stands("agreed");
      await said("Lars said yes to “Tschick”").waitFor();
      await rp.evaluate(() => {
        for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("focus"));
      });
      await rp.getByTestId("sync-now").click();
      await rp.locator('.sidebar [data-testid="nav-friends"]').click();
      await rp.getByTestId("open-loans").click();
      await card("agreed").waitFor();
      await lookNow(rp);
      await settle();
      equal(await said("Lars said yes").count(), 1, "times the yes is announced");
      equal(await notices.count(), 1, "notices on the page");
      // A second window of the same browser has nothing to add: the browser was told already.
      const second = await context.newPage();
      await second.goto(`${WEB}/friends/loans`);
      await card("agreed", second).waitFor();
      await second.waitForTimeout(700);
      equal(await second.locator(".toast").count(), 0, "news in a second window about what the first one told");
      // Once the notice has gone, no later look brings it back, and no reload either.
      await said("Lars said yes").waitFor({ state: "detached", timeout: 9000 });
      await lookNow(rp);
      await settle();
      equal(await notices.count(), 0, "the yes, announced again by a later look");
      await rp.reload();
      await card("agreed").waitFor();
      await settle();
      equal(await notices.count(), 0, "the yes, announced again after a reload");

      // Two looks that race. The second window asks first and gets its answer last: an answer
      // from before Lars changed the day, arriving after the first window told of the change.
      let release;
      const held = new Promise((resolve) => (release = resolve));
      let asked;
      const fetched = new Promise((resolve) => (asked = resolve));
      await second.route("**/rest/v1/rpc/shelfmark_sync", async (route) => {
        const response = await route.fetch();
        asked();
        await held;
        await route.fulfill({ response });
      });
      await lookNow(second);
      await fetched;
      await act(lars, loan.id, "set_due", { p_due: today + 21 });
      await dueSays(`Back by ${enDay(today + 21)}`);
      await said("Lars changed the date for “Tschick”").waitFor();
      equal(await notices.count(), 1, "times the new day is announced");
      await said("Lars changed the date").waitFor({ state: "detached", timeout: 9000 });
      release();
      await second.waitForTimeout(500);
      await second.unroute("**/rest/v1/rpc/shelfmark_sync");
      await lookNow(rp);
      await settle();
      equal(await notices.count(), 0, "old news made new again by an answer that came in late");
      equal(await card("agreed").getByTestId("loan-due").innerText(), `Back by ${enDay(today + 21)}`, "the day the first window shows after that");
      // The second window catches up with its next look, and has nothing to announce either.
      await dueSays(`Back by ${enDay(today + 21)}`, second);
      await second.waitForTimeout(400);
      equal(await second.locator(".toast").count(), 0, "news in the second window about what the first one told");
      await second.close();

      // Lars says he handed the book over. Rita is told, and answers that she did not get it:
      // the notice is about a question she has answered, and goes at once.
      await act(lars, loan.id, "hand");
      await stands("handed");
      await said("Lars says “Tschick” was handed over to you").waitFor();
      equal(await notices.count(), 1, "times the handover is announced");
      await card("handed").getByTestId("loan-not_received").click();
      await card("agreed").waitFor();
      equal(await notices.count(), 0, "notices about a step the reader has answered");
      // He hands it over again. That is news again, and stands there once, not on top of the first.
      await act(lars, loan.id, "hand");
      await stands("handed");
      await said("Lars says “Tschick” was handed over to you").first().waitFor();
      await settle();
      equal(await said("was handed over to you").count(), 1, "times the second handover is announced");
      // Then he changes the day. The latest step of a loan takes the place of the one before.
      await act(lars, loan.id, "set_due", { p_due: null });
      await dueSays("No fixed date");
      await said("Lars changed the date for “Tschick”").waitFor();
      equal(await notices.count(), 1, "notices about one loan");
      // Rita has the book and says so. Nothing is left to announce about it.
      await card("handed").getByTestId("loan-receive").click();
      await card("on_loan").waitFor();
      equal(await notices.count(), 0, "notices about a loan the reader has just acted on");
      await lookNow(rp);
      await settle();
      equal(await notices.count(), 0, "notices after the look that follows her step");

      // The same when she acts somewhere else. She gives the book back here, Lars says he did not get it ...
      await card("on_loan").getByTestId("loan-give_back").click();
      await card("given_back").waitFor();
      await act(lars, loan.id, "not_returned");
      await stands("on_loan");
      await said("Lars did not get “Tschick” back").waitFor();
      // ... and she answers on her phone. The notice in the browser is about something she has dealt with.
      await act(rita, loan.id, "give_back");
      await stands("given_back");
      equal(await notices.count(), 0, "notices about a step the reader answered on another device");
      // What Lars does next is news again.
      await act(lars, loan.id, "take_back");
      await stands("returned");
      await said("Lars has “Tschick” back").waitFor();
      await settle();
      equal(await notices.count(), 1, "times the return is announced");
      await context.close();
    },
    null,
  );

  await test(
    "the friend code can be copied and replaced",
    async () => {
      await annaContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: WEB });
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("friend-code").filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ }).waitFor();
      const before = await page.getByTestId("friend-code").innerText();
      await page.getByTestId("copy-code").click();
      await page.getByText("Code copied").waitFor();
      equal(await page.evaluate(() => navigator.clipboard.readText()), before, "the code in the clipboard");
      await page.getByTestId("new-code").click();
      await page.getByTestId("confirm").click();
      await until(async () => (await page.getByTestId("friend-code").innerText()) !== before, "a new code on the page");
      const after = await page.getByTestId("friend-code").innerText();
      equal((await rpc(anna.session.token, "shelfmark_hello")).code, after.replace("-", ""), "the new code on the server");
      // The name friends see can be changed here too.
      await page.getByTestId("change-name").click();
      await page.getByTestId("name-field").fill("Anna B.");
      await page.getByTestId("name-save").click();
      await until(async () => (await rpc(anna.session.token, "shelfmark_hello")).name === "Anna B.", "the new name on the profile");
      await page.getByTestId("change-name").click();
      await page.getByTestId("name-field").fill("Anna");
      await page.getByTestId("name-save").click();
      await until(async () => (await rpc(anna.session.token, "shelfmark_hello")).name === "Anna", "the old name again");
    },
    page,
  );

  await test(
    "two tabs change the same book at the same time and neither change is lost",
    async () => {
      const dracula = await openBook(page, anna, "Dracula");
      const second = await annaContext.newPage();
      await second.goto(`${WEB}/book?id=${dracula.id}`);
      await second.getByTestId("book-page").waitFor();
      let conflicts = 0;
      const watch = (tab) =>
        tab.on("response", async (response) => {
          if (!response.url().endsWith("/rpc/shelfmark_vault_push") || response.status() !== 400) return;
          if ((await response.text().catch(() => "")).includes("shelfmark:conflict")) conflicts++;
        });
      watch(page);
      watch(second);
      const click = (tab, id) => tab.evaluate((testId) => document.querySelector(`[data-testid="${testId}"]`).click(), id);
      // Both tabs hold the same revision. One save wins, the other is refused and has to start over.
      const rounds = [
        ["star5", "spice2", (b) => b.rating === 5 && b.spice === 2],
        ["star3", "spice4", (b) => b.rating === 3 && b.spice === 4],
        ["star2", "spice1", (b) => b.rating === 2 && b.spice === 1],
      ];
      for (const [star, spice, check] of rounds) {
        await Promise.all([click(page, star), click(second, spice)]);
        await untilVault(anna, (v) => check(bookOf(v, "Dracula")), `both ${star} and ${spice} on the server`);
        await waitSaved(page);
        await waitSaved(second);
        if (conflicts > 0) break;
        // Both tabs have to be at the same revision again before the next round.
        for (const tab of [page, second]) await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
        await page.waitForTimeout(500);
      }
      assert(conflicts > 0, "a save was refused because the other tab was first, which is the case this test is about");
      // Typing while the other tab saves: the words survive the conflict too.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await second.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(500);
      const before = conflicts;
      await page.getByTestId("review").pressSequentially("Fangs.", { delay: 20 });
      await click(second, "own-BORROWED");
      const both = await untilVault(anna, (v) => bookOf(v, "Dracula").review === "Fangs." && bookOf(v, "Dracula").ownership === "BORROWED", "the typed review and the other tab's change");
      equal(bookOf(both, "Dracula").review, "Fangs.", "what was typed");
      assert(conflicts >= before, "conflicts are counted");
      await click(second, "own-OWNED");
      await untilVault(anna, (v) => !("ownership" in bookOf(v, "Dracula")), "owned again");
      // Each tab shows the other's change once it looks at the server again.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.locator('[data-testid="own-OWNED"][aria-pressed="true"]').waitFor();
      await second.evaluate(() => window.dispatchEvent(new Event("focus")));
      await until(async () => (await second.getByTestId("review").inputValue()) === "Fangs.", "the review in the other tab");
      await second.close();
    },
    page,
  );

  await test(
    "without a connection the page says so, keeps what was typed, and saves later",
    async () => {
      await openBook(page, anna, "Dracula");
      await page.route("**/rest/v1/rpc/shelfmark_vault_push", (route) => route.abort());
      await page.getByTestId("review").fill("Fangs. Written on a train, in a tunnel.");
      const state = page.locator('[data-testid="save-state"]:visible');
      await page.locator('[data-testid="save-state"][data-state="error"]:visible').waitFor();
      assert((await state.innerText()).includes("Could not save"), "the page says that it could not save");
      // Nothing is lost meanwhile: the words are on the page, and a second change joins the queue.
      await page.getByTestId("spice5").click();
      equal(await page.getByTestId("review").inputValue(), "Fangs. Written on a train, in a tunnel.", "what was typed");
      assert(!bookOf((await vaultOf(anna)).vault, "Dracula").review.includes("tunnel"), "the server has not seen it yet");
      await page.unroute("**/rest/v1/rpc/shelfmark_vault_push");
      await state.getByRole("button", { name: "Try again" }).click();
      const vault = await untilVault(anna, (v) => bookOf(v, "Dracula").review === "Fangs. Written on a train, in a tunnel." && bookOf(v, "Dracula").spice === 5, "both changes, once the connection is back");
      assert(vault, "saved");
      await page.locator('[data-testid="save-state"][data-state="saved"]:visible, [data-testid="save-state"][data-state="idle"]:visible').waitFor();
    },
    page,
  );

  await test(
    "search and filter within the library",
    async () => {
      await page.goto(`${WEB}/`);
      await page.getByTestId("spine-shelf").waitFor();
      await page.getByTestId("filter-READ").click();
      await page.waitForURL(/status=READ/);
      equal(await page.locator('[data-testid="spine"], [data-testid="leaning"]').count(), 1, "books on the read list");
      await page.getByTestId("filter-all").click();
      await page.getByTestId("greeting").waitFor();
      assert(/Anna/.test(await page.getByTestId("greeting").innerText()), "the greeting knows the name");
      assert((await page.getByTestId("greeting").innerText()).includes("4 books on your shelves"), "and how many books there are");
      await page.getByTestId("toggle-search").click();
      await page.getByTestId("library-search").fill("stoker");
      equal(await page.getByTestId("book-count").innerText(), "1 book", "books that match the search");
      await page.getByTestId("library-search").fill("nothing like this");
      await page.getByTestId("nothing-matches").waitFor();
      await page.getByTestId("toggle-search").click();
      await page.getByTestId("greeting").waitFor();
      // Sorting by rating puts the best rated first.
      await page.getByTestId("view-menu").click();
      await page.getByTestId("view-LIST").click();
      await page.getByTestId("view-menu").click();
      await page.getByTestId("sort-RATING").click();
      const best = (await vaultOf(anna)).vault.books.slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0].title;
      await until(async () => (await page.getByTestId("book-row").first().innerText()).includes(best), `the best rated book first (${best})`);
      await page.getByTestId("view-menu").click();
      await page.getByTestId("sort-ADDED").click();
      await page.getByTestId("view-menu").click();
      await page.getByTestId("view-SPINES").click();
      await waitSaved(page);
    },
    page,
  );

  await test(
    "a backup can be downloaded and brought back",
    async () => {
      await page.goto(`${WEB}/settings`);
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-download").click()]);
      const path = `${OUTPUT}backup.json`;
      await download.saveAs(path);
      assert(/^shelfmark-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), `the name of the file: ${download.suggestedFilename()}`);
      const { readFileSync } = await import("node:fs");
      const file = JSON.parse(readFileSync(path, "utf8"));
      // The envelope of the app's own backup.
      equal(Object.keys(file).join(","), "app,v,type,backup", "the parts of the file");
      equal(file.app, "shelfmark", "app");
      equal(file.v, 1, "version");
      equal(file.type, "backup", "type");
      equal(file.backup.books.length, 4, "books in the backup");
      equal(file.backup.prefs.profileName, "Anna", "the settings travel in the backup");

      // Lose a book, then restore.
      const faust = bookOf(file.backup, "Faust");
      await page.goto(`${WEB}/book?id=${faust.id}`);
      await page.getByTestId("delete-book").click();
      assert((await page.locator("dialog[open]").innerText()).includes("quotes, notes, purchases and reading sessions"), "deleting names what goes with the book");
      await page.getByTestId("confirm").click();
      await page.waitForURL(`${WEB}/`);
      await untilVault(anna, (v) => v.books.length === 3, "one book fewer");
      await page.goto(`${WEB}/settings`);
      // Something that is no backup is refused in words.
      writeFileSync(`${OUTPUT}not-a-backup.json`, JSON.stringify({ hello: "there" }));
      await page.getByTestId("backup-file").setInputFiles(`${OUTPUT}not-a-backup.json`);
      equal(await page.getByTestId("backup-problem").innerText(), "This is not a Shelfmark backup.", "a wrong file");
      await page.getByTestId("backup-file").setInputFiles(path);
      await page.getByTestId("restore-dialog").waitFor();
      assert((await page.getByTestId("restore-dialog").innerText()).includes("replaces your current books"), "restoring asks first and says what it does");
      await page.getByTestId("confirm").click();
      const restored = await untilVault(anna, (v) => v.books.length === 4, "all four books again");
      assert(bookOf(restored, "Faust"), "the lost book is back");
      equal(restored.quotes.length, 1, "quotes after restoring");
      equal(restored.sessions.length, 2, "sessions after restoring");
      // The book that is out on a loan came back with what the loan wrote on it.
      equal(bookOf(restored, "Dracula").lentTo, "Carl", "who has the lent book, after restoring");
      assert(bookOf(restored, "Dracula").loanId, "the loan it carries, after restoring");
      assert(!("requests" in restored), "borrow requests are no part of a library any more");
    },
    page,
  );

  await test(
    "every page can be used by keyboard and names its controls",
    async () => {
      const dracula = bookOf((await vaultOf(anna)).vault, "Dracula");
      for (const path of ["/", `/book?id=${dracula.id}`, `/book/edit?id=${dracula.id}`, "/add", "/add/manual", "/lists", "/quotes", "/stats", "/stats/goals", "/stats/calendar", "/stats/recap", "/stats/milestones", "/friends", "/friends/loans", "/settings"]) {
        await page.goto(`${WEB}${path}`);
        await page.locator("main#content h1").first().waitFor();
        await page.waitForTimeout(250);
        deepAudit(await audit(page), path);
      }
      // The first stop of the Tab key is a way past the menu.
      await page.goto(`${WEB}/`);
      await page.getByTestId("spine-shelf").waitFor();
      await page.keyboard.press("Tab");
      equal(await page.evaluate(() => document.activeElement.className), "skip-link", "where the Tab key lands first");
      await page.keyboard.press("Tab");
      // Whatever has the focus shows it.
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert(outline !== "none", `the focused link has a visible outline (${outline})`);
      // A book on the shelf is a real link, reachable and usable by keyboard.
      const spine = page.locator('[data-testid="spine"], [data-testid="leaning"]').first();
      equal(await spine.evaluate((element) => element.tagName), "A", "a spine is a link");
      await spine.focus();
      await page.keyboard.press("Enter");
      await page.getByTestId("book-page").waitFor();
      await openBook(page, anna, "Dracula");
      // Dialogs keep the keyboard inside and close with Escape.
      await page.getByTestId("delete-book").focus();
      await page.keyboard.press("Enter");
      await page.locator("dialog[open]").waitFor();
      assert(await page.evaluate(() => document.querySelector("dialog[open]").contains(document.activeElement)), "the focus is inside the dialog");
      await page.keyboard.press("Escape");
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      equal(await page.evaluate(() => document.activeElement.getAttribute("data-testid")), "delete-book", "the focus goes back to where it came from");
      // Within the tabs of a book the arrow keys move from one to the next.
      await page.getByTestId("tab-overview").focus();
      await page.keyboard.press("ArrowRight");
      await page.getByTestId("book-reading").waitFor();
      equal(await page.evaluate(() => document.activeElement.getAttribute("data-testid")), "tab-reading", "the tab the arrow key moved to");
      await page.keyboard.press("ArrowLeft");
      await page.getByTestId("book-overview").waitFor();
      // Stars can be given by keyboard.
      await page.getByTestId("star1").focus();
      await page.keyboard.press("Enter");
      await untilVault(anna, (v) => bookOf(v, "Dracula").rating === 1, "a star given by keyboard");
      await page.getByTestId("star4").click();
      await untilVault(anna, (v) => bookOf(v, "Dracula").rating === 4, "four stars");
    },
    page,
  );

  await test(
    "sign out and in again and find everything still there",
    async () => {
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("account-card").waitFor();
      assert((await page.getByTestId("account-card").innerText()).includes(anna.email), "the settings say who is signed in");
      await page.getByTestId("sign-out").click();
      await page.getByTestId("login-form").waitFor();
      equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("shelfmark.auth")).length), 0, "nothing of the sign-in stays in the browser");
      // The wrong password is answered with the words of the app.
      await page.getByTestId("email").fill(anna.email);
      await page.getByTestId("password").fill("not the password");
      await page.getByTestId("submit").click();
      equal(await page.getByTestId("login-problem").innerText(), "E-mail or password is not right.", "a wrong password");
      await page.getByTestId("password").fill(anna.password);
      await page.getByTestId("submit").click();
      await page.getByTestId("greeting").waitFor();
      assert((await page.getByTestId("greeting").innerText()).includes("4 books on your shelves"), "the books are there");
      await page.getByTestId("spine-shelf").waitFor();
      await page.getByTestId(`shelf-list_${holidayId}`).waitFor();
      equal(await page.locator('svg[data-ornament="CANDLE"]').count(), 1, "the candle is still on its shelf");
      await page.goto(`${WEB}/quotes`);
      await page.getByTestId("quote-card").waitFor();
      // The loans are on the server, so they are there after signing in again. A browser that
      // was signed out remembers nothing of them, and so has no news to tell: this is how things stand.
      await page.goto(`${WEB}/friends/loans`);
      await page.getByTestId("loans-lent").getByTestId("loan-card").waitFor();
      equal(await page.getByTestId("loan-card").count(), 1, "loans after signing in again");
      equal(await page.getByTestId("loan-line").innerText(), "“Dracula” for Carl", "the loan that is still running");
      equal(await page.locator(".toast").count(), 0, "notices about loans that are no news");
    },
    page,
  );

  await test(
    "on a phone-sized screen Anna's shelf fits and looks like the app",
    async () => {
      const phone = await newContext({ viewport: PHONE });
      const phonePage = await phone.newPage();
      await signInOnPage(phonePage, anna);
      await phonePage.getByTestId("spine-shelf").waitFor();
      await phonePage.waitForTimeout(900);
      await shot(phonePage, "shelf-mobile");
      await shot(phonePage, "shelf-mobile-full", { fullPage: true });
      deepAudit(await audit(phonePage), "shelf on a phone");
      // The spines are packed into rows that fit the narrow screen.
      const overflow = await phonePage.evaluate(() => Array.from(document.querySelectorAll(".shelf-row-spines")).filter((row) => row.scrollWidth > row.clientWidth + 1).length);
      equal(overflow, 0, "shelf rows wider than the screen");
      for (const path of ["/stats", "/friends", "/settings", "/lists", "/quotes", "/add"]) {
        await phonePage.goto(`${WEB}${path}`);
        await phonePage.locator("main#content h1").first().waitFor();
        await phonePage.waitForTimeout(250);
        deepAudit(await audit(phonePage), `${path} on a phone`);
      }
      const dracula = bookOf((await vaultOf(anna)).vault, "Dracula");
      await phonePage.goto(`${WEB}/book?id=${dracula.id}`);
      await phonePage.getByTestId("book-page").waitFor();
      await phonePage.waitForTimeout(400);
      await shot(phonePage, "book-mobile");
      await phone.close();

      // And on a desktop the width is used: a sidebar, and shelves side by side.
      await page.goto(`${WEB}/`);
      await page.getByTestId("spine-shelf").waitFor();
      assert(await page.locator(".sidebar").isVisible(), "a sidebar on a desktop");
      assert(!(await page.locator(".bottombar").isVisible()), "no bottom bar on a desktop");
      const columns = await page.locator(".bookcase").evaluate((bookcase) => getComputedStyle(bookcase).gridTemplateColumns.split(" ").length);
      equal(columns, 2, "bays of the bookcase side by side");
      await page.waitForTimeout(600);
      await shot(page, "shelf-desktop", { fullPage: true });
    },
    page,
  );

  // ------------------------------------------------------------------------------
  console.log("\nAccounts");

  await test(
    "a new account that has to confirm its e-mail address is told so clearly",
    async () => {
      const context = await newContext();
      // This browser talks to a server on which new accounts have to confirm their address.
      await context.route(`${SERVER}/**`, (route) => route.continue({ url: route.request().url().replace(`:${SERVER_PORT}/`, `:${CONFIRM_PORT}/`) }));
      const fresh = account("Dora");
      const freshPage = await context.newPage();
      await signUp(freshPage, fresh);
      const notice = freshPage.getByTestId("confirm-notice");
      await notice.waitFor();
      const text = await notice.innerText();
      assert(text.includes("Confirm your e-mail address") && text.includes(fresh.email), `the notice says what to do: ${text}`);
      assert(freshPage.url().endsWith("/login"), "nobody is signed in yet");
      // The mail did not arrive: it can be asked for again.
      const resent = freshPage.waitForRequest((request) => request.url().includes("/auth/v1/resend") && request.method() === "POST");
      await notice.getByRole("button", { name: "Send the mail again" }).click();
      const resend = await resent;
      equal(JSON.parse(resend.postData()).email, fresh.email, "whose mail is sent again");
      equal(JSON.parse(resend.postData()).type, "signup", "which mail is sent again");
      equal((await resend.response()).status(), 200, "the server's answer to sending the mail again");
      equal(await freshPage.getByTestId("login-notice").innerText(), "The mail was sent again.", "the notice after sending again");
      // Trying to sign in before confirming gives the same clear notice, not a bare error.
      await freshPage.getByTestId("password").fill(fresh.password);
      await freshPage.getByTestId("submit").click();
      await notice.waitFor();
      equal(await freshPage.getByTestId("login-problem").count(), 0, "no scolding for an address that is not confirmed yet");
      assert(freshPage.url().endsWith("/login"), "still not signed in");
      // The link in the mail is clicked.
      await fetch(`${CONFIRM_SERVER}/auth/v1/dev/confirm`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: fresh.email }) });
      await freshPage.getByTestId("submit").click();
      await freshPage.getByTestId("empty-library").waitFor();
      // The name typed in before confirming was kept for this moment.
      await untilVault(fresh, (v) => v.prefs?.profileName === "Dora", "the name given at sign-up");
      await freshPage.goto(`${WEB}/settings`);
      await freshPage.getByTestId("sign-out").click();
      await freshPage.getByTestId("login-form").waitFor();
      // Somebody signs up with an address that has an account already. Such a server does not
      // give away who has an account: it answers as if a mail went out, with nobody signed in.
      const again = await context.newPage();
      const answered = again.waitForResponse((response) => response.url().includes("/auth/v1/signup"));
      await signUp(again, { ...fresh, name: "Somebody Else", password: "another-password-9" });
      const answer = await answered;
      equal(answer.status(), 200, "the server's answer for an address that is taken");
      assert(!("access_token" in (await answer.json())), "that answer signs nobody in");
      await again.getByTestId("confirm-notice").waitFor();
      assert((await again.getByTestId("confirm-notice").innerText()).includes(fresh.email), "the same notice as for a new address");
      equal(await again.getByTestId("login-problem").count(), 0, "nothing is given away about the address");
      assert(again.url().endsWith("/login"), "and nobody is signed in");
      equal(await again.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("shelfmark.auth")).length), 0, "no sign-in is kept in the browser");
      // The account is what it was: its password still opens it, and the name typed in by the other person is not taken over.
      await again.getByTestId("password").fill(fresh.password);
      await again.getByTestId("submit").click();
      await again.getByTestId("empty-library").waitFor();
      await waitSaved(again);
      equal((await vaultOf(fresh)).vault.prefs.profileName, "Dora", "the name of the account after somebody else tried to sign up with its address");
      await context.close();

      // A server that lets new accounts in at once says plainly that the address is taken.
      const plain = await newContext();
      const taken = await plain.newPage();
      await signUp(taken, { ...anna, password: "another-password-9" });
      equal(await taken.getByTestId("login-problem").innerText(), "There is an account for this address already. Sign in instead.", "an address that is taken");
      await plain.close();
    },
    null,
  );

  await test(
    "the link in a confirmation mail leads to a page of its own that says what happened, and Back does not play it again",
    async () => {
      const context = await newContext();
      // This browser talks to a server on which new accounts have to confirm their address.
      await context.route(`${SERVER}/**`, (route) => route.continue({ url: route.request().url().replace(`:${SERVER_PORT}/`, `:${CONFIRM_PORT}/`) }));
      const fay = account("Fay");
      const first = await context.newPage();
      // Signing up names the confirmation page as the place the link in the mail is to lead to.
      const asked = first.waitForRequest((request) => request.url().includes("/auth/v1/signup") && request.method() === "POST");
      await signUp(first, fay);
      equal(new URL((await asked).url()).searchParams.get("redirect_to"), `${WEB}/confirmed`, "where the confirmation mail is to lead");
      await first.getByTestId("confirm-notice").waitFor();
      // So does "send the mail again".
      const resent = first.waitForRequest((request) => request.url().includes("/auth/v1/resend") && request.method() === "POST");
      await first.getByTestId("confirm-notice").getByRole("button", { name: "Send the mail again" }).click();
      equal(new URL((await resent).url()).searchParams.get("redirect_to"), `${WEB}/confirmed`, "where the mail that is sent again is to lead");

      // The click in the mail: Supabase confirms the address and sends the browser to that page,
      // with a sign-in behind the "#". The stand-in hands out that address.
      const { link } = await (await post(CONFIRM_SERVER, "/auth/v1/dev/confirm", { email: fay.email, redirect_to: `${WEB}/confirmed` })).json();
      assert(link.startsWith(`${WEB}/confirmed#access_token=`) && link.endsWith("&type=signup"), `where the click in the mail leads: ${link.slice(0, 56)}`);
      const mail = await context.newPage();
      await watchForFrontPage(mail);
      // The reader was somewhere else before the click.
      await mail.goto(`${WEB}/imprint`);
      await mail.getByTestId("legal-imprint").waitFor();
      const before = await mail.evaluate(() => history.length);
      await mail.goto(link);
      const card = mail.getByTestId("confirmed-card");
      await card.waitFor();
      equal(await card.getAttribute("data-state"), "confirmed-in", "what the slip is about");
      equal(await mail.locator("h1").innerText(), "Your e-mail address is confirmed", "the headline");
      const words = await card.innerText();
      assert(words.includes(`You are signed in on this device, as ${fay.email}.`), `the slip says that this device is signed in: ${words}`);
      // The same page has to serve somebody who signed up in the Android app and opened the mail wherever it arrived.
      assert(words.includes("Did you create your account in the Android app?"), "the slip speaks to those who came from the app");
      assert(words.includes("Go back to the app. It signs you in by itself when you return. If it does not, tap “Sign in” there."), "and says what to do there");
      equal(await mail.getByTestId("confirmed-open").innerText(), "Open my shelf", "the one thing to do");
      equal(await mail.getByTestId("confirmed-sign-in").count(), 0, "sign-in buttons for somebody who is signed in");
      equal(await mail.locator(".receipt .btn-filled").count(), 1, "primary actions on the slip");
      equal(mail.url(), `${WEB}/confirmed`, "nothing of the link stays in the address");
      equal(await mail.evaluate(() => history.length), before + 1, "entries in the history after the click in the mail");
      const seen = await frontPageSeen(mail);
      assert(seen.frames > 3, "the page was watched from its first frame");
      equal(seen.shown, 0, "frames in which the front page could be seen on the way");
      equal(seen.signIn, 0, "frames in which the sign-in page could be seen on the way");
      equal(await mail.evaluate(() => document.documentElement.dataset.world), "front", "the look of the page");
      equal(await mail.title(), "Your e-mail address is confirmed - Shelfmark", "the title of the page");
      deepAudit(await audit(mail), "confirmation page");
      await mail.waitForTimeout(400);
      await shot(mail, "confirmed-page");

      // Back leads to where the reader was before the click, not into the link again.
      await mail.goBack();
      await mail.getByTestId("legal-imprint").waitFor();
      equal(mail.url(), `${WEB}/imprint`, "where Back leads");
      // Forward again there is the page without its link: signed in, and nothing left to confirm.
      await mail.goForward();
      await card.waitFor();
      equal(mail.url(), `${WEB}/confirmed`, "the address going forward again");
      equal(await card.getAttribute("data-state"), "plain-in", "the slip without a link, signed in");
      equal(await mail.locator("h1").innerText(), "You are signed in", "its headline");
      assert((await card.innerText()).includes(`This device is signed in as ${fay.email}. There is nothing left to confirm.`), "what it says");
      equal(await mail.getByTestId("confirmed-app").count(), 0, "words about the app when no link was opened");

      // "Open my shelf" opens it, without the front page on the way. The shelf has no notice of its own any more.
      await mail.getByTestId("confirmed-open").click();
      await mail.getByTestId("empty-library").waitFor();
      equal(mail.url(), `${WEB}/`, "where the shelf is");
      assert(!(await mail.title()).includes("confirm"), `the title of the shelf says nothing of a confirmation: ${await mail.title()}`);
      equal((await frontPageSeen(mail)).shown, 0, "frames in which the front page could be seen on the way to the shelf");
      equal(await mail.getByTestId("confirmed-notice").count(), 0, "confirmation notices on the shelf");
      // The name given when signing up is put into the new library.
      await untilVault(fay, (v) => v.prefs?.profileName === "Fay", "the name given at sign-up");

      // The link clicked a second time. Supabase then says it is used up. Whoever is signed in is told so, and that they are.
      const twice = await context.newPage();
      await watchForFrontPage(twice);
      await twice.goto(`${WEB}/confirmed${USED_UP}`);
      const second = twice.getByTestId("confirmed-card");
      await second.waitFor();
      equal(await second.getAttribute("data-state"), "stale-in", "the slip after a used link, signed in");
      equal(await twice.locator("h1").innerText(), "This link does not work any more", "its headline");
      assert((await second.innerText()).includes(`It was used before, or it is too old. You are signed in on this device all the same, as ${fay.email}.`), "what it says");
      equal(await twice.getByTestId("confirmed-open").count(), 1, "the way to the shelf");
      equal(twice.url(), `${WEB}/confirmed`, "the address after a used link");
      equal((await frontPageSeen(twice)).signIn, 0, "frames in which the sign-in page could be seen");
      await context.close();
    },
    null,
  );

  await test(
    "a confirmation link that lands on the address of the site itself is taken on to the confirmation page, here in German on a phone",
    async () => {
      // An account made in the Android app: no browser has seen the website for it. Older versions
      // of the app name no page for the mail to lead to, so Supabase sends the click to the site itself.
      const hana = account("Hana");
      const made = await post(CONFIRM_SERVER, "/auth/v1/signup", { email: hana.email, password: hana.password });
      equal(made.status, 200, "Hana's account");
      assert(!("access_token" in (await made.json())), "nobody is signed in before the address is confirmed");
      const { link } = await (await post(CONFIRM_SERVER, "/auth/v1/dev/confirm", { email: hana.email, redirect_to: `${WEB}/` })).json();
      assert(link.startsWith(`${WEB}/#access_token=`) && link.endsWith("&type=signup"), `where the click in the mail leads: ${link.slice(0, 48)}`);

      const context = await newContext({ viewport: PHONE, locale: "de-CH" });
      await context.route(`${SERVER}/**`, (route) => route.continue({ url: route.request().url().replace(`:${SERVER_PORT}/`, `:${CONFIRM_PORT}/`) }));
      const mail = await context.newPage();
      await watchForFrontPage(mail);
      await mail.goto(`${WEB}/de/datenschutz`);
      await mail.getByTestId("legal-privacy").waitFor();
      const before = await mail.evaluate(() => history.length);
      await mail.goto(link);
      const card = mail.getByTestId("confirmed-card");
      await card.waitFor();
      equal(mail.url(), `${WEB}/confirmed`, "the address the reader ends up at");
      equal(await card.getAttribute("data-state"), "confirmed-in", "what the slip is about");
      equal(await mail.locator("h1").innerText(), "Deine E-Mail-Adresse ist bestätigt", "the headline, in the language of the browser");
      const words = await card.innerText();
      assert(words.includes(`Du bist auf diesem Gerät angemeldet, als ${hana.email}.`), `the slip says that this device is signed in: ${words}`);
      assert(words.includes("Hast du dein Konto in der Android-App erstellt?") && words.includes("Geh zurück in die App. Sie meldet dich von selbst an, sobald du zurückkommst. Falls nicht, tippe dort auf «Anmelden»."), "and what to do in the app");
      equal(await mail.getByTestId("confirmed-open").innerText(), "Mein Regal öffnen", "the one thing to do");
      equal(await mail.evaluate(() => document.documentElement.lang), "de", "the language the page says it is in");
      const seen = await frontPageSeen(mail);
      assert(seen.frames > 3, "the page was watched from its first frame");
      equal(seen.shown, 0, "frames in which the front page could be seen on the way");
      equal(seen.signIn, 0, "frames in which the sign-in page could be seen on the way");
      // The entry of the link was replaced, twice over: by the clean address, then by the confirmation page.
      equal(await mail.evaluate(() => history.length), before + 1, "entries in the history after the click in the mail");
      deepAudit(await audit(mail), "confirmation page on a phone, in German");
      await mail.waitForTimeout(400);
      await shot(mail, "confirmed-page-phone-de");
      // The other language is one tap away, as on the sign-in page.
      await mail.getByTestId("lang-en").click();
      equal(await mail.locator("h1").innerText(), "Your e-mail address is confirmed", "the headline in English");
      await mail.getByTestId("lang-de").click();
      // Back leads to where the reader was before the click, not into the link again.
      await mail.goBack();
      await mail.getByTestId("legal-privacy").waitFor();
      equal(mail.url(), `${WEB}/de/datenschutz`, "where Back leads");
      // A reload of the confirmation page finds no link either.
      await mail.goto(`${WEB}/confirmed`);
      await card.waitFor();
      equal(await card.getAttribute("data-state"), "plain-in", "the slip after the link is gone");
      await context.close();
    },
    null,
  );

  await test(
    "confirmed without a sign-in, a link that is used up, and the confirmation page opened by itself: each says what to do",
    async () => {
      const made = (type) => `#access_token=made.up.token&expires_in=3600&refresh_token=nothing&token_type=bearer&type=${type}`;
      // An account whose address is confirmed, to sign in with further down.
      const ida = account("Ida");
      equal((await post(SERVER, "/auth/v1/signup", { email: ida.email, password: ida.password })).status, 200, "Ida's account");

      // A confirmation link whose sign-in does not take. Supabase only hands such a link out
      // once the address is confirmed, so the page says so, and the way on is to sign in.
      const cold = await newContext();
      const lost = await cold.newPage();
      await watchForFrontPage(lost);
      await lost.goto(`${WEB}/confirmed${made("signup")}`);
      const lostCard = lost.getByTestId("confirmed-card");
      await lostCard.waitFor();
      equal(await lostCard.getAttribute("data-state"), "confirmed-out", "the slip after a confirmation without a sign-in");
      equal(await lost.locator("h1").innerText(), "Your e-mail address is confirmed", "the same headline");
      const lostWords = await lostCard.innerText();
      assert(lostWords.includes("You can sign in now, with your e-mail address and your password."), `what it says: ${lostWords}`);
      assert(lostWords.includes("Did you create your account in the Android app?") && lostWords.includes("Go back to the app."), "the same words about the app");
      equal(await lost.getByTestId("confirmed-sign-in").innerText(), "Sign in", "the one thing to do");
      equal(await lost.getByTestId("confirmed-open").count(), 0, "ways to a shelf for somebody who is not signed in");
      equal(lost.url(), `${WEB}/confirmed`, "nothing of the link stays in the address");
      equal((await frontPageSeen(lost)).signIn, 0, "frames in which the sign-in page could be seen");
      // The same link on the address of the site itself.
      const lostAtRoot = await cold.newPage();
      await watchForFrontPage(lostAtRoot);
      await lostAtRoot.goto(`${WEB}/${made("signup")}`);
      await lostAtRoot.getByTestId("confirmed-card").waitFor();
      equal(lostAtRoot.url(), `${WEB}/confirmed`, "where it is taken on to");
      equal(await lostAtRoot.getByTestId("confirmed-card").getAttribute("data-state"), "confirmed-out", "the slip");
      const lostSeen = await frontPageSeen(lostAtRoot);
      equal(lostSeen.shown, 0, "frames in which the front page could be seen on the way");
      equal(lostSeen.signIn, 0, "frames in which the sign-in page could be seen on the way");
      // "Sign in" leads to the sign-in page, which has nothing to add.
      await lostAtRoot.getByTestId("confirmed-sign-in").click();
      await lostAtRoot.getByTestId("login-form").waitFor();
      equal(lostAtRoot.url(), `${WEB}/login`, "where the button leads");
      equal(await lostAtRoot.getByTestId("login-notice").count(), 0, "notices on the sign-in page after the confirmation page said it all");
      await cold.close();

      // A link that does not work any more, in a browser where nobody is signed in.
      const elsewhere = await newContext();
      const stale = await elsewhere.newPage();
      await watchForFrontPage(stale);
      await stale.goto(`${WEB}/confirmed${USED_UP}`);
      const staleCard = stale.getByTestId("confirmed-card");
      await staleCard.waitFor();
      equal(await staleCard.getAttribute("data-state"), "stale-out", "the slip after a link that is used up");
      equal(await stale.locator("h1").innerText(), "This link does not work any more", "the headline");
      const staleWords = await staleCard.innerText();
      // What that usually means: it was used already, and then the address is confirmed.
      assert(staleWords.includes("Most of the time that means it was used already. Some mail programs open the links in a mail before you do, to check them. Your address is confirmed then, and you can sign in."), `what it usually means: ${staleWords}`);
      // And how to have the mail sent again.
      assert(staleWords.includes("If signing in tells you to confirm your address first, the link had grown too old instead. The sign-in page then offers to send the mail again."), "how to get the mail again");
      assert(staleWords.includes("Were you after a new password? Choose “Forgot the password?” on the sign-in page for a fresh mail."), "and what to do when the link was one for a password");
      assert(!staleWords.includes("Your e-mail address is confirmed"), "no claim that this address is confirmed");
      equal(await stale.getByTestId("confirmed-sign-in").innerText(), "Sign in", "the one thing to do");
      equal(await stale.locator(".receipt .btn-filled").count(), 1, "primary actions on the slip");
      equal(await stale.locator(".receipt-stamp").count(), 0, "stamps on a slip that confirms nothing");
      equal(stale.url(), `${WEB}/confirmed`, "nothing of the link stays in the address");
      equal(await stale.title(), "This link does not work any more - Shelfmark", "the title of the page");
      deepAudit(await audit(stale), "confirmation page after a stale link");
      await stale.waitForTimeout(400);
      await shot(stale, "confirmed-stale");

      // The same on the address of the site itself, where a mail from an older app leads. Nobody sees the front page or the sign-in page on the way.
      const staleAtRoot = await elsewhere.newPage();
      await watchForFrontPage(staleAtRoot);
      await staleAtRoot.goto(`${WEB}/privacy`);
      await staleAtRoot.getByTestId("legal-privacy").waitFor();
      await staleAtRoot.goto(`${WEB}/${USED_UP}`);
      await staleAtRoot.getByTestId("confirmed-card").waitFor();
      equal(staleAtRoot.url(), `${WEB}/confirmed`, "where a stale link on the address of the site is taken on to");
      equal(await staleAtRoot.getByTestId("confirmed-card").getAttribute("data-state"), "stale-out", "the slip");
      const staleSeen = await frontPageSeen(staleAtRoot);
      assert(staleSeen.frames > 3, "the page was watched from its first frame");
      equal(staleSeen.shown, 0, "frames in which the front page could be seen on the way");
      equal(staleSeen.signIn, 0, "frames in which the sign-in page could be seen on the way");
      await staleAtRoot.goBack();
      await staleAtRoot.getByTestId("legal-privacy").waitFor();
      equal(staleAtRoot.url(), `${WEB}/privacy`, "where Back leads after a stale link");
      // Some versions of the server say it behind the "?" as well. Nothing of that stays either.
      await staleAtRoot.goto(`${WEB}/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired${USED_UP}`);
      await staleAtRoot.getByTestId("confirmed-card").waitFor();
      equal(staleAtRoot.url(), `${WEB}/confirmed`, "the address after a failure that was said twice");
      // "The address is confirmed then, and you can sign in": it is, so that works.
      await staleAtRoot.getByTestId("confirmed-sign-in").click();
      await staleAtRoot.getByTestId("login-form").waitFor();
      equal(await staleAtRoot.getByTestId("login-notice").count(), 0, "notices on the sign-in page");
      await staleAtRoot.getByTestId("email").fill(ida.email);
      await staleAtRoot.getByTestId("password").fill(ida.password);
      await staleAtRoot.getByTestId("submit").click();
      await staleAtRoot.getByTestId("empty-library").waitFor();
      equal(await staleAtRoot.getByTestId("confirmed-notice").count(), 0, "confirmation notices after an ordinary sign-in");

      // Opened without any link, by somebody who is signed in: it says so and offers the shelf.
      const direct = await elsewhere.newPage();
      await direct.goto(`${WEB}/confirmed`);
      const directCard = direct.getByTestId("confirmed-card");
      await directCard.waitFor();
      equal(await directCard.getAttribute("data-state"), "plain-in", "the slip without a link, signed in");
      equal(await direct.locator("h1").innerText(), "You are signed in", "its headline");
      assert((await directCard.innerText()).includes(`This device is signed in as ${ida.email}.`), "who is signed in");
      await direct.getByTestId("confirmed-open").click();
      await direct.getByTestId("empty-library").waitFor();
      await elsewhere.close();

      // Opened without any link, by a visitor: a few neutral words and the way to sign in.
      const nobody = await newContext();
      const visitor = await nobody.newPage();
      await watchForFrontPage(visitor);
      await visitor.goto(`${WEB}/confirmed`);
      const plainCard = visitor.getByTestId("confirmed-card");
      await plainCard.waitFor();
      equal(await plainCard.getAttribute("data-state"), "plain-out", "the slip without a link, signed out");
      equal(await visitor.locator("h1").innerText(), "Confirming your e-mail address", "its headline");
      assert((await plainCard.innerText()).includes("The link in the confirmation mail leads to this page. Opened without it, there is nothing to confirm here. If you have an account already, sign in."), "what it says");
      equal(await visitor.getByTestId("confirmed-app").count(), 0, "words about the app when no link was opened");
      equal(await visitor.locator(".receipt-stamp").count(), 0, "stamps on a slip that confirms nothing");
      equal(visitor.url(), `${WEB}/confirmed`, "a visitor is not sent away from it");
      equal((await frontPageSeen(visitor)).signIn, 0, "frames in which the sign-in page could be seen");
      deepAudit(await audit(visitor), "confirmation page opened by itself");
      await visitor.getByTestId("confirmed-sign-in").click();
      await visitor.getByTestId("login-form").waitFor();
      await nobody.close();

      // A link that was simply too old: the address is not confirmed, the sign-in is refused, and
      // the sign-in page offers to send the mail again, as the confirmation page said it would.
      const waiting = await newContext();
      await waiting.route(`${SERVER}/**`, (route) => route.continue({ url: route.request().url().replace(`:${SERVER_PORT}/`, `:${CONFIRM_PORT}/`) }));
      const jo = account("Jo");
      equal((await post(CONFIRM_SERVER, "/auth/v1/signup", { email: jo.email, password: jo.password })).status, 200, "Jo's account");
      const late = await waiting.newPage();
      await late.goto(`${WEB}/${USED_UP}`);
      await late.getByTestId("confirmed-sign-in").click();
      await late.getByTestId("email").fill(jo.email);
      await late.getByTestId("password").fill(jo.password);
      await late.getByTestId("submit").click();
      const offer = late.getByTestId("confirm-notice");
      await offer.waitFor();
      assert((await offer.innerText()).includes("Confirm your e-mail address"), "the sign-in page says that the address is not confirmed");
      const resent = late.waitForRequest((request) => request.url().includes("/auth/v1/resend") && request.method() === "POST");
      await offer.getByRole("button", { name: "Send the mail again" }).click();
      const resend = await resent;
      equal(JSON.parse(resend.postData()).email, jo.email, "whose mail is sent again");
      equal(new URL(resend.url()).searchParams.get("redirect_to"), `${WEB}/confirmed`, "where that mail is to lead");
      await waiting.close();
    },
    null,
  );

  await test(
    "the other links a mail can carry keep their ways, and none of them ends in silence",
    async () => {
      const made = (type) => `#access_token=made.up.token&expires_in=3600&refresh_token=nothing&token_type=bearer&type=${type}`;
      const kim = account("Kim");
      equal((await post(SERVER, "/auth/v1/signup", { email: kim.email, password: kim.password })).status, 200, "Kim's account");
      // Links whose sign-in does not take: the sign-in page says what became of them.
      const cold = await newContext();
      const change = await cold.newPage();
      await watchForFrontPage(change);
      await change.goto(`${WEB}/${made("email_change")}`);
      equal(await change.getByTestId("login-notice").innerText(), "Your new e-mail address is confirmed. Sign in with it.", "a change of address without a sign-in");
      equal((await frontPageSeen(change)).shown, 0, "frames in which the front page could be seen on the way to the sign-in page");
      equal(change.url(), `${WEB}/login`, "nothing of the link stays in the address");
      const half = await cold.newPage();
      await half.goto(`${WEB}/#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email`);
      equal(await half.getByTestId("login-notice").innerText(), "That link was accepted. One step is left: open the link in the mail that went to your other address.", "the first half of a change of address");
      const magic = await cold.newPage();
      await magic.goto(`${WEB}/${made("magiclink")}`);
      equal(await magic.getByTestId("login-notice").innerText(), FRONT_LINK_FAILED, "a sign-in link that did not work");
      equal(await magic.getByTestId("confirmed-card").count(), 0, "confirmation pages for a link that confirms nothing");
      await cold.close();

      // The same kinds with a sign-in that does take, as the stand-in hands them out for Kim.
      const working = async (type) => (await (await post(SERVER, "/auth/v1/dev/recovery", { email: kim.email, redirect_to: `${WEB}/` })).json()).link.replace("type=recovery", `type=${type}`);
      const warm = await newContext();
      const signedIn = await warm.newPage();
      await signedIn.goto(`${WEB}/imprint`);
      await signedIn.goto(await working("magiclink"));
      await signedIn.getByTestId("empty-library").waitFor();
      await signedIn.getByText("You are signed in.", { exact: true }).waitFor();
      equal(signedIn.url(), `${WEB}/`, "the sign-in does not stay in the address");
      equal(await signedIn.getByTestId("confirmed-card").count(), 0, "confirmation pages after a plain sign-in link");
      // No link of any kind is played again by the Back button.
      await signedIn.goBack();
      await signedIn.getByTestId("legal-imprint").waitFor();
      equal(signedIn.url(), `${WEB}/imprint`, "where Back leads after a sign-in link");
      await warm.close();
      const moved = await newContext();
      const newAddress = await moved.newPage();
      await newAddress.goto(await working("email_change"));
      await newAddress.getByText("Your new e-mail address is confirmed.", { exact: true }).waitFor();
      await moved.close();
      // Somebody invited has no password yet, so they are taken to choose one.
      const invited = await newContext();
      const guest = await invited.newPage();
      await guest.goto(await working("invite"));
      await guest.getByTestId("new-password").waitFor();
      assert(guest.url().startsWith(`${WEB}/reset`), `where an invitation leads: ${guest.url()}`);
      await invited.close();
    },
    null,
  );

  await test(
    "the imprint and the privacy notice: plain pages in two languages that name who answers and talk to nobody",
    async () => {
      // What the server sends, before any script runs: the whole text.
      const drawn = {
        "/imprint": [
          "<title>Imprint - Shelfmark</title>",
          "private, non-commercial project and open source under the MIT licence",
          'href="https://github.com/TRGamer-tech/shelfmark"',
          'href="mailto:martin@schmidtbit.ch"',
          "Whoever is named under Contact answers for what this website says.",
          "Open Library, Google Books, Apple Books, lobid, the German National Library, K10plus and swisscovery",
          "can be incomplete or wrong",
          'href="/privacy"',
        ],
        "/privacy": [
          "<title>Privacy notice - Shelfmark</title>",
          "As of 24 November 2026",
          'href="mailto:martin@schmidtbit.ch"',
          "Vercel (Vercel Inc., USA)",
          "Shelfmark itself sets no cookies.",
          "Supabase (Supabase Inc., USA)",
          "to 7 catalogues: Open Library, Google Books, Apple Books, lobid, the German National Library, K10plus and swisscovery",
          "GitHub (GitHub Inc., USA)",
          "According to Google, ML Kit sends usage and diagnostic figures about itself to Google.",
          "Federal Data Protection and Information Commissioner (FDPIC)",
          "General Data Protection Regulation of the EU (GDPR)",
          'href="/imprint"',
        ],
        "/de/impressum": ["<title>Impressum - Shelfmark</title>", "privates, nicht kommerzielles Projekt und Open Source unter der MIT-Lizenz", 'href="mailto:martin@schmidtbit.ch"', "Deutsche Nationalbibliothek", 'href="/de/datenschutz"'],
        "/de/datenschutz": [
          "<title>Datenschutzerklärung - Shelfmark</title>",
          "Stand: 24. November 2026",
          "Shelfmark selbst setzt keine Cookies.",
          "an 7 Kataloge: Open Library, Google Books, Apple Books, lobid, Deutsche Nationalbibliothek, K10plus und swisscovery",
          "Laut Google sendet das ML Kit Nutzungs- und Diagnosezahlen über sich selbst an Google.",
          "Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB)",
          "Datenschutz-Grundverordnung der EU (DSGVO)",
          'href="/de/impressum"',
        ],
      };
      for (const base of [WEB, PLAIN]) {
        for (const [path, parts] of Object.entries(drawn)) {
          const answer = await fetch(`${base}${path}`);
          equal(answer.status, 200, `the answer of the server for ${base}${path}`);
          const html = (await answer.text()).replaceAll("&#x27;", "'");
          for (const part of parts) assert(html.includes(part), `${base}${path} as the server sends it holds: ${part}`);
          // Name and postal address are not filled in yet, so none is shown, and none is made up.
          assert(!html.includes('data-testid="operator-line"'), `${path} shows no name or postal address`);
          equal(answer.headers.get("set-cookie"), null, `cookies the server sets with ${path}`);
        }
      }
      // Each page names its other language to search engines.
      const english = await (await fetch(`${WEB}/privacy`)).text();
      assert(/<link rel="alternate" hrefLang="de" href="[^"]*\/de\/datenschutz"/i.test(english), "the German notice is named as the other language");

      // Somebody opens the privacy notice from a link, in a browser that has never seen the site.
      const context = await newContext();
      const page = await context.newPage();
      const asked = [];
      page.on("request", (request) => asked.push(request.url()));
      await page.goto(`${WEB}/privacy`);
      await page.getByTestId("legal-privacy").waitFor();
      equal(await page.locator("h1").innerText(), "Privacy notice", "the headline");
      equal(await page.getByTestId("as-of").innerText(), "As of 24 November 2026", "the day the notice is from");
      equal(await page.getByTestId("operator").innerText(), "E-mail: martin@schmidtbit.ch", "who answers, as far as it is filled in");
      equal(await page.evaluate(() => document.documentElement.lang), "en", "the language the page says it is in");
      equal(await page.evaluate(() => document.documentElement.dataset.world), "front", "the look of the page");
      // It is organised by the reader's questions, and each of them is a way into the text.
      const questions = await page.locator(".legal-contents a").allInnerTexts();
      equal(questions.length, 12, "questions the notice answers");
      equal(questions.join(" | "), (await page.locator(".sheet h2").allInnerTexts()).join(" | "), "the list of questions is the list of sections");
      for (const question of ["What happens when I just look at this website?", "What does the website keep in my browser?", "What do friends see?", "What is kept when I lend or borrow a book?", "What about the Android app?", "How long is it kept, and how do I delete it?", "What are my rights?"]) {
        assert(questions.includes(question), `the notice answers: ${question}`);
      }
      deepAudit(await audit(page), "privacy notice");
      await page.waitForTimeout(300);
      await shot(page, "privacy", { fullPage: true, animations: "disabled" });
      await page.getByRole("link", { name: "What do friends see?" }).click();
      equal(page.url(), `${WEB}/privacy#friends`, "where a question leads");
      const topOf = () => page.locator("#friends").evaluate((section) => section.getBoundingClientRect().top);
      await until(async () => (await topOf()) >= 0 && (await topOf()) < 200, "the answer comes to the top of the window");
      // The page is what it says: it talks to nobody but the site, and leaves nothing behind.
      await page.waitForTimeout(600);
      const elsewhere = asked.filter((url) => !url.startsWith(`${WEB}/`));
      equal(elsewhere.join(" "), "", "requests the privacy notice sent anywhere but to the site");
      equal(await page.evaluate(() => Object.keys(localStorage).join(" ") + Object.keys(sessionStorage).join(" ")), "", "what reading the notice leaves in the browser");
      equal((await context.cookies()).length, 0, "cookies after reading the notice");

      // The language switch leads to the same page in the other language, and remembers the choice.
      await page.getByTestId("front-lang-de").click();
      await page.getByTestId("legal-privacy").waitFor();
      equal(page.url(), `${WEB}/de/datenschutz`, "the address of the German notice");
      equal((await page.locator("h1").innerText()).replaceAll(String.fromCharCode(0xad), ""), "Datenschutzerklärung", "its headline");
      equal(await page.getByTestId("as-of").innerText(), "Stand: 24. November 2026", "the day, in German");
      equal(await page.getByTestId("operator").innerText(), "E-Mail: martin@schmidtbit.ch", "who answers");
      equal(await page.evaluate(() => document.documentElement.lang), "de", "the language the page says it is in");
      equal(await page.evaluate(() => localStorage.getItem("shelfmark.lang")), "de", "the choice of language is remembered");
      equal(await page.locator(".legal-contents a").count(), 12, "questions the German notice answers");
      deepAudit(await audit(page), "privacy notice in German");
      await page.waitForTimeout(300);
      await shot(page, "privacy-de", { fullPage: true, animations: "disabled" });
      // From the notice to the imprint and back, staying in the language.
      await page.locator(".front-foot").getByTestId("link-imprint").click();
      await page.getByTestId("legal-imprint").waitFor();
      equal(page.url(), `${WEB}/de/impressum`, "the address of the German imprint");
      equal(await page.locator("h1").innerText(), "Impressum", "its headline");
      await page.getByTestId("front-lang-en").click();
      await page.getByTestId("legal-imprint").waitFor();
      equal(page.url(), `${WEB}/imprint`, "the address of the English imprint");
      equal(await page.locator("h1").innerText(), "Imprint", "its headline");
      const imprint = await page.locator(".sheet").innerText();
      for (const part of ["What Shelfmark is", "Contact", "E-mail: martin@schmidtbit.ch", "Who answers for the content", "Book data and covers", "github.com/TRGamer-tech/shelfmark"]) assert(imprint.includes(part), `the imprint holds: ${part}`);
      equal(await page.getByTestId("operator-line").count(), 0, "lines with a name or a postal address while none is filled in");
      equal(await page.locator(".legal-contents").count(), 0, "lists of questions on a page that short");
      deepAudit(await audit(page), "imprint");
      await page.waitForTimeout(300);
      await shot(page, "imprint");
      await page.getByRole("link", { name: "privacy notice" }).click();
      await page.getByTestId("legal-privacy").waitFor();
      equal(page.url(), `${WEB}/privacy`, "the imprint leads to the notice");
      // The name at the top leads out to the front page.
      await page.getByRole("link", { name: "Shelfmark", exact: true }).click();
      await page.getByTestId("landing").waitFor();
      equal((await context.cookies()).length, 0, "cookies after all of this");
      await context.close();

      // On a phone, in both languages: nothing is wider than the window, the long German word included.
      const phone = await newContext({ viewport: PHONE });
      const small = await phone.newPage();
      for (const path of ["/privacy", "/de/datenschutz", "/imprint", "/de/impressum"]) {
        await small.goto(`${WEB}${path}`);
        await small.locator(".sheet").waitFor();
        deepAudit(await audit(small), `${path} on a phone`);
      }
      await small.goto(`${WEB}/de/datenschutz`);
      await small.waitForTimeout(300);
      await shot(small, "privacy-de-phone");
      await phone.close();

      // Without scripts the text is all there, in the look of the page.
      const plain = await browser.newContext({ viewport: DESKTOP, javaScriptEnabled: false });
      const still = await plain.newPage();
      await still.goto(`${WEB}/de/datenschutz`);
      assert(await still.locator(".sheet h2").first().isVisible(), "the text can be read without scripts");
      equal(await still.locator(".sheet section").count(), 12, "sections of the notice without scripts");
      equal(await still.locator(".legal").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(42, 29, 23)", "the dark wood of the room, without scripts");
      equal(await still.locator(".legal").getAttribute("lang"), "de", "the language of the text is said without scripts as well");
      await plain.close();
    },
    null,
  );

  await test(
    "the imprint and the privacy notice are one step away from the front page, the sign-in page, the sign-up form, the settings and every page before the sign-in",
    async () => {
      const context = await newContext();
      const page = await context.newPage();
      const footOf = async (scope) => [await page.locator(scope).getByTestId("link-imprint").getAttribute("href"), await page.locator(scope).getByTestId("link-privacy").getAttribute("href")].join(" ");
      // The foot of the front page, in each language.
      await page.goto(`${WEB}/`);
      await page.getByTestId("landing").waitFor();
      equal(await footOf(".front-foot"), "/imprint /privacy", "the foot of the front page");
      equal(await page.locator(".front-foot").getByTestId("link-imprint").innerText(), "Imprint", "the word for the imprint");
      equal(await page.locator(".front-foot").getByTestId("link-privacy").innerText(), "Privacy", "the word for the privacy notice");
      await page.goto(`${WEB}/de`);
      await page.getByTestId("landing").waitFor();
      equal(await footOf(".front-foot"), "/de/impressum /de/datenschutz", "the foot of the German front page");
      equal(await page.locator(".front-foot").getByTestId("link-privacy").innerText(), "Datenschutz", "the German word for the privacy notice");
      await page.locator(".front-foot").getByTestId("link-imprint").click();
      await page.getByTestId("legal-imprint").waitFor();
      equal(page.url(), `${WEB}/de/impressum`, "where the foot of the German front page leads");

      // The foot of the sign-in page, of the page for a new password, of the confirmation page and of a page that does not exist.
      await page.goto(`${WEB}/login?lang=en`);
      await page.getByTestId("login-form").waitFor();
      equal(await footOf(".desk-foot"), "/imprint /privacy", "the foot of the sign-in page");
      for (const [path, mark] of [
        ["/reset", "reset-box"],
        ["/confirmed", "confirmed-card"],
        ["/no/such/page", "not-found"],
      ]) {
        await page.goto(`${WEB}${path}`);
        await page.getByTestId(mark).waitFor();
        equal(await footOf(".desk-foot"), "/imprint /privacy", `the foot of ${path}`);
      }
      await page.goto(`${WEB}/login`);
      await page.locator(".desk-foot").getByTestId("link-imprint").click();
      await page.getByTestId("legal-imprint").waitFor();
      equal(page.url(), `${WEB}/imprint`, "where the foot of the sign-in page leads");
      await page.goBack();
      await page.getByTestId("login-form").waitFor();

      // The form for a new account says in one sentence what an account stores, with the way to the notice. No box to tick.
      equal(await page.getByTestId("signup-privacy").count(), 0, "the sentence is for those who create an account");
      await page.getByTestId("mode-up").click();
      const typed = `leo.${stamp}@example.org`;
      await page.getByTestId("email").fill(typed);
      await page.getByTestId("password").fill("not-sent-anywhere-1");
      equal(await page.getByTestId("signup-privacy").innerText(), "Creating an account stores your e-mail address and your library on the server. The privacy notice says what exactly.", "the sentence on the form for a new account");
      equal(await page.getByTestId("signup-privacy-link").getAttribute("href"), "/privacy", "where its link leads");
      equal(await page.locator('[data-testid="login-form"] input[type="checkbox"]').count(), 0, "boxes to tick on the form");
      deepAudit(await audit(page), "form for a new account");
      await page.waitForTimeout(300);
      await shot(page, "signup-privacy-line");
      // The notice opens next to the form, so that what was typed in is still there afterwards.
      const [notice] = await Promise.all([context.waitForEvent("page"), page.getByTestId("signup-privacy-link").click()]);
      await notice.getByTestId("legal-privacy").waitFor();
      equal(notice.url(), `${WEB}/privacy`, "the page the sentence leads to");
      await notice.close();
      equal(await page.getByTestId("email").inputValue(), typed, "the address typed in before reading the notice");
      equal(await page.getByTestId("password").inputValue(), "not-sent-anywhere-1", "the password typed in before reading the notice");
      // In German the sentence and every link lead to the German pages.
      await page.getByTestId("lang-de").click();
      equal(await page.getByTestId("signup-privacy").innerText(), "Mit einem Konto werden deine E-Mail-Adresse und deine Bibliothek auf dem Server gespeichert. Was genau, steht in der Datenschutzerklärung.", "the sentence in German");
      equal(await page.getByTestId("signup-privacy-link").getAttribute("href"), "/de/datenschutz", "where its link leads in German");
      equal(await footOf(".desk-foot"), "/de/impressum /de/datenschutz", "the foot of the German sign-in page");
      equal(await page.locator(".desk-foot").getByTestId("link-imprint").innerText(), "Impressum", "the German word for the imprint");
      await page.getByTestId("lang-en").click();

      // The settings of the library end with the same two links. From there the name at the top leads back to the shelf.
      const max = account("Max");
      equal((await post(SERVER, "/auth/v1/signup", { email: max.email, password: max.password })).status, 200, "Max's account");
      await signInOnPage(page, max);
      await page.getByTestId("empty-library").waitFor();
      await page.goto(`${WEB}/settings`);
      await page.getByTestId("settings-page").waitFor();
      equal(await footOf('[data-testid="legal-row"]'), "/imprint /privacy", "the last row of the settings");
      const lastCard = await page.locator('[data-testid="settings-page"] .card').last().evaluate((card) => card.getBoundingClientRect().bottom);
      const row = await page.getByTestId("legal-row").evaluate((element) => element.getBoundingClientRect().top);
      assert(row >= lastCard, "the row stands at the end of the settings");
      await page.getByTestId("legal-row").getByTestId("link-privacy").click();
      await page.getByTestId("legal-privacy").waitFor();
      equal(page.url(), `${WEB}/privacy`, "where the settings lead");
      await watchForFrontPage(page);
      await page.getByRole("link", { name: "Shelfmark", exact: true }).click();
      await page.getByTestId("empty-library").waitFor();
      equal((await frontPageSeen(page)).shown, 0, "frames in which the front page could be seen on the way back to the shelf");
      // Signed in and after all of that: still no cookie.
      equal((await context.cookies()).length, 0, "cookies after signing in and looking around");
      await context.close();
    },
    null,
  );

  await test(
    "an address that leads nowhere says so, to a visitor and to somebody signed in",
    async () => {
      const context = await newContext();
      const visitor = await context.newPage();
      const answer = await visitor.goto(`${WEB}/no/such/page`);
      equal(answer.status(), 404, "the answer of the server for a page that does not exist");
      await visitor.getByTestId("not-found").waitFor();
      equal(await visitor.locator("h1").innerText(), "Nothing stands here.", "the headline");
      // The books on its shelf spell out what happened.
      const spines = visitor.locator('[data-testid="not-found"] .spine');
      await spines.first().waitFor();
      equal((await spines.evaluateAll((all) => all.map((spine) => spine.getAttribute("aria-label")))).join(" "), "This page is out on loan", "what the spines say, read along the shelf");
      assert((await visitor.getByTestId("not-found").innerText()).includes("a gap on the shelf"), "the words under it");
      equal(visitor.url(), `${WEB}/no/such/page`, "nobody is sent to the sign-in page for a page that does not exist");
      deepAudit(await audit(visitor), "missing page");
      await visitor.waitForTimeout(900);
      await shot(visitor, "not-found");
      await visitor.getByRole("link", { name: "To the entrance" }).click();
      await visitor.getByTestId("landing").waitFor();
      await context.close();
      // Somebody signed in gets the same page, and the way out leads to their shelf.
      const tab = await annaContext.newPage();
      await tab.goto(`${WEB}/no/such/page`);
      await tab.getByTestId("not-found").waitFor();
      await tab.getByRole("link", { name: "To the entrance" }).click();
      await tab.getByTestId("greeting").waitFor();
      await tab.close();
    },
    null,
  );

  await test(
    "forgot the password: the link in the mail sets a new one, and only the new one signs in",
    async () => {
      // Erin has an account and no idea what its password was.
      const erin = account("Erin");
      const post = (path, body) => fetch(`${SERVER}${path}`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      equal((await post("/auth/v1/signup", { email: erin.email, password: erin.password })).status, 200, "Erin's account");
      // What the stand-in server hands out is the address the link in the mail ends up at.
      const linkTo = async (target) => (await (await post("/auth/v1/dev/recovery", { email: erin.email, redirect_to: target })).json()).link;
      const refused = async (password) => {
        try {
          await signIn(erin.email, password);
          return false;
        } catch {
          return true;
        }
      };

      const context = await newContext();
      const visitor = await context.newPage();
      await visitor.goto(`${WEB}/login`);
      await visitor.getByTestId("forgot").click();
      await visitor.getByTestId("email").fill(erin.email);
      const asked = visitor.waitForRequest((request) => request.url().includes("/auth/v1/recover") && request.method() === "POST");
      await visitor.getByTestId("submit").click();
      const request = await asked;
      // The link in the mail is to lead to the page of this site that sets the new password.
      assert(decodeURIComponent(request.url()).includes(`redirect_to=${WEB}/reset`), `where the link will lead: ${request.url()}`);
      equal(JSON.parse(request.postData()).email, erin.email, "whose password");
      equal(await visitor.getByTestId("login-notice").innerText(), "A mail with a link for a new password is on its way.", "the notice");
      // That page opened without a link says so in words, with a way back.
      await visitor.goto(`${WEB}/reset`);
      await visitor.getByTestId("reset-invalid").waitFor();
      await visitor.getByRole("link", { name: "Back to signing in" }).click();
      await visitor.getByTestId("login-form").waitFor();

      // The link is opened, in a tab of its own as a mail program does.
      const link = await linkTo(`${WEB}/reset`);
      assert(link.startsWith(`${WEB}/reset#access_token=`) && link.includes("type=recovery"), `the link in the mail: ${link.slice(0, 60)}`);
      const mail = await context.newPage();
      await mail.goto(link);
      await mail.getByTestId("new-password").waitFor();
      assert((await mail.getByTestId("reset-box").innerText()).includes(erin.email), "the page says whose password is set");
      assert(!mail.url().includes("access_token"), `the sign-in does not stay in the address: ${mail.url()}`);
      await mail.getByTestId("new-password").fill("short");
      assert(await mail.getByTestId("reset-save").isDisabled(), "a password that is too short cannot be saved");
      const first = "a-new-password-1";
      const changed = mail.waitForResponse((response) => response.url().endsWith("/auth/v1/user") && response.request().method() === "PUT");
      await mail.getByTestId("new-password").fill(first);
      await mail.getByTestId("reset-save").click();
      const change = await changed;
      equal(change.status(), 200, "the server's answer to the new password");
      equal(JSON.parse(change.request().postData()).password, first, "the new password is what was sent");
      await mail.getByTestId("reset-done").waitFor();
      await mail.getByRole("link", { name: "To the shelf" }).click();
      await mail.getByTestId("empty-library").waitFor();

      // Signed out again, the old password is refused and the new one opens the account.
      await mail.goto(`${WEB}/settings`);
      await mail.getByTestId("sign-out").click();
      await mail.getByTestId("login-form").waitFor();
      await mail.getByTestId("email").fill(erin.email);
      await mail.getByTestId("password").fill(erin.password);
      await mail.getByTestId("submit").click();
      equal(await mail.getByTestId("login-problem").innerText(), "E-mail or password is not right.", "the old password after it was replaced");
      assert(mail.url().endsWith("/login"), "the old password signs nobody in");
      await mail.getByTestId("password").fill(first);
      await mail.getByTestId("submit").click();
      await mail.getByTestId("empty-library").waitFor();
      assert(await refused(erin.password), "the server refuses the old password");
      await context.close();

      // A mail asked for in the Android app names no page, so its link leads to the address
      // of the site itself. The reader is taken to the new password from there as well.
      const second = "another-password-2";
      const other = await newContext();
      const fromApp = await other.newPage();
      const library = [];
      fromApp.on("request", (r) => {
        if (r.url().includes("/rest/v1/rpc/shelfmark_vault_")) library.push(r.url());
      });
      const rootLink = await linkTo(`${WEB}/`);
      assert(rootLink.startsWith(`${WEB}/#access_token=`), `the link of a mail asked for in the app: ${rootLink.slice(0, 50)}`);
      await fromApp.goto(`${WEB}/imprint`);
      const entries = await fromApp.evaluate(() => history.length);
      await fromApp.goto(rootLink);
      await fromApp.getByTestId("new-password").waitFor();
      assert(fromApp.url().startsWith(`${WEB}/reset`) && !fromApp.url().includes("access_token"), `where the reader was taken: ${fromApp.url()}`);
      // The link took one entry in the history and left nothing of itself in it: Back would not play it again.
      equal(await fromApp.evaluate(() => history.length), entries + 1, "entries in the history after the link of a password mail");
      assert((await fromApp.getByTestId("reset-box").innerText()).includes(erin.email), "whose password is set, coming from the address of the site");
      equal(library.length, 0, "the library is not opened on the way to the new password");
      await fromApp.getByTestId("new-password").fill(second);
      await fromApp.getByTestId("reset-save").click();
      await fromApp.getByTestId("reset-done").waitFor();
      await fromApp.getByRole("link", { name: "To the shelf" }).click();
      await fromApp.getByTestId("empty-library").waitFor();
      await signIn(erin.email, second);
      assert((await refused(first)) && (await refused(erin.password)), "both earlier passwords are refused");

      await other.close();

      // A link that is too old: Supabase says so behind the "#". On the page for a new password,
      // where a mail asked for on the website leads, that page says so itself, with a way back.
      const stranger = await newContext();
      const stale = await stranger.newPage();
      await stale.goto(`${WEB}/reset${USED_UP}`);
      await stale.getByTestId("reset-invalid").waitFor();
      equal(await stale.getByTestId("reset-invalid").innerText(), "This link does not work any more. Ask for a new one.", "an expired link on the page for a new password");
      equal(stale.url(), `${WEB}/reset`, "nothing of the expired link stays in the address");
      equal(await stale.getByTestId("confirmed-card").count(), 0, "confirmation pages for a link that was one for a password");
      // On the address of the site itself, where a mail asked for in the app leads, nobody can tell
      // what kind of link it was. The page it is taken to says what to do for a password as well.
      await stale.goto(`${WEB}/${USED_UP}`);
      await stale.getByTestId("confirmed-card").waitFor();
      equal(stale.url(), `${WEB}/confirmed`, "where an expired link on the address of the site leads");
      assert((await stale.getByTestId("confirmed-more").innerText()).includes("Were you after a new password? Choose “Forgot the password?” on the sign-in page for a fresh mail."), "what to do when it was a link for a password");
      // The sign-in page has nothing to add, then or later.
      await stale.getByTestId("confirmed-sign-in").click();
      await stale.getByTestId("login-form").waitFor();
      equal(await stale.getByTestId("login-notice").count(), 0, "notices on the sign-in page after the page that explained the link");
      await stale.getByTestId("forgot").click();
      equal(await stale.locator("h1").innerText(), "Forgot the password?", "the way to a fresh mail is where the page said");
      // And a sign-in somebody made up opens nothing.
      const forged = await stranger.newPage();
      await forged.goto(`${WEB}/#access_token=made.up.token&expires_in=3600&refresh_token=nothing&token_type=bearer&type=recovery`);
      await forged.getByTestId("login-form").waitFor();
      equal(await forged.getByTestId("login-notice").innerText(), FRONT_LINK_FAILED, "a made-up link");
      equal(await forged.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("shelfmark.auth")).length), 0, "a made-up link signs nobody in");
      // It is said once, not on every later visit of the sign-in page.
      await forged.goto(`${WEB}/login`);
      await forged.getByTestId("login-form").waitFor();
      equal(await forged.getByTestId("login-notice").count(), 0, "the notice about the link on a later visit");
      await forged.goto(`${WEB}/reset#access_token=made.up.token&expires_in=3600&refresh_token=nothing&token_type=bearer&type=recovery`);
      await forged.getByTestId("reset-invalid").waitFor();
      await stranger.close();
    },
    null,
  );

  await test(
    "the catalogue routes and the daily check answer as they should",
    async () => {
      const search = await (await fetch(`${WEB}/api/books/search?q=der+vorleser+schlink&lang=de`)).json();
      equal(search.results[0].title, "Der Vorleser", "the first result");
      equal(search.results[0].isbn, "9783257229530", "its ISBN");
      assert(search.results[0].authors.includes("Bernhard Schlink"), "its author");
      // One catalogue knows the pages, another the blurb: the merged record has both.
      assert(search.results[0].pageCount > 0 && search.results[0].description.startsWith("Sie ist reizbar"), "what several catalogues know is merged");
      equal((await (await fetch(`${WEB}/api/books/search?q=`)).json()).results.length, 0, "an empty search");

      const byIsbn = await fetch(`${WEB}/api/books/isbn/978-3-257-22953-0?lang=de`);
      equal(byIsbn.status, 200, "a known ISBN");
      const { book } = await byIsbn.json();
      equal(book.title, "Der Vorleser", "the book");
      equal(book.format, "PAPERBACK", "its binding, from the edition record");
      equal(book.subtitle, "Roman", "its subtitle, which only some catalogues know");
      equal((await fetch(`${WEB}/api/books/isbn/12345`)).status, 400, "something that is no ISBN");

      const covers = await (await fetch(`${WEB}/api/books/covers?title=Der+Vorleser&authors=Bernhard+Schlink&isbn=9783257229530`)).json();
      assert(covers.covers.includes("https://covers.openlibrary.org/b/isbn/9783257229530-L.jpg?default=false"), `covers by ISBN: ${JSON.stringify(covers)}`);
      assert(covers.covers.length >= 2, "and from the catalogues");
      equal((await (await fetch(`${WEB}/api/books/covers`)).json()).covers.length, 0, "covers of nothing");

      const before = (await rpc(anna.session.token, "shelfmark_hello")).id && Date.now();
      const keepalive = await fetch(`${WEB}/api/keepalive`);
      equal(keepalive.status, 200, "the daily check");
      const body = await keepalive.json();
      equal(body.ok, true, "the server answered the daily check");
      assert(body.time >= before - 5000, "with its own time");
      // The browser said hello once today as well, and remembers that it did.
      equal(await page.evaluate(() => localStorage.getItem("shelfmark.ping")), String(today), "the day of the last check from this browser");
    },
    null,
  );

  await test(
    "what the website wrote is kept for the Android app to read",
    async () => {
      await waitSaved(page);
      const { vault } = await vaultOf(anna);
      const rated = vault.books.find((b) => b.rating > 0 && b.review && b.startedOn && b.finishedOn);
      assert(vault.books.length >= 2 && rated, "two books, one of them rated, reviewed and dated");
      assert(vault.shelves.length >= 1 && vault.links.some((l) => vault.shelves.some((s) => s.id === l.shelfId)), "a list with a book on it");
      for (const part of ["quotes", "sessions", "notes", "purchases", "goals", "ornaments"]) assert(vault[part]?.length >= 1, `at least one of ${part}`);
      // Borrow requests are gone from the library. What a loan between friends leaves in it is on the book.
      assert(!("requests" in vault), "no requests in the document");
      const lent = vault.books.find((b) => b.loanId);
      assert(lent && lent.lentTo === "Carl" && Number.isSafeInteger(lent.lentSince) && /^[0-9a-f-]{36}$/.test(lent.loanId), "a book that is out on a loan, with who has it, since when, and the loan");
      assert(vault.prefs && vault.prefs.profileName === "Anna" && vault.prefs.viewMode === "SPINES", "the settings");
      const text = JSON.stringify(vault, null, 2) + "\n";
      // The app reads strictly: a null where it expects a value, or a missing field without a default, and it reads nothing.
      assert(!/\bnull\b/.test(text), "no nulls in the document");
      for (const book of vault.books) assert(typeof book.title === "string" && Number.isSafeInteger(book.id), "books have a title and a whole number as id");
      for (const goal of vault.goals) for (const key of ["target", "startDay", "endDay"]) assert(key in goal, `a goal has ${key}`);
      for (const theme of vault.prefs.customThemes) for (const key of ["id", "name", "background", "card", "accent", "text"]) assert(Number.isInteger(theme[key]) || typeof theme[key] === "string", `a theme has ${key}`);
      writeFileSync(`${WEB_DIR}e2e/fixtures/vault-from-web.json`, text);
    },
    page,
  );

  // ------------------------------------------------------------------------------
  console.log("\nThe reading timer, and lists from other apps");

  await test(
    "the reading timer counts through other pages and a reload, and what it measured is logged",
    async () => {
      const tess = account("Tess");
      const context = await newContext();
      const tp = await context.newPage();
      await signUp(tp, tess);
      await tp.getByTestId("empty-library").waitFor();
      await addByHand(tp, { title: "Middlemarch", authors: "George Eliot", pages: 880, status: "READING" });
      await addByHand(tp, { title: "Silas Marner", authors: "George Eliot", pages: 200, status: "READING" });
      const library = (await vaultOf(tess)).vault;
      const book = bookOf(library, "Middlemarch");
      const other = bookOf(library, "Silas Marner");
      const key = `shelfmark.timer.${tess.session.id}`;
      const stored = () => tp.evaluate((name) => JSON.parse(localStorage.getItem(name)), key);
      const clock = () => tp.getByTestId("timer-clock").innerText();
      const line = tp.locator('[data-testid="timer-line"]:visible');

      // The stopwatch is reached from the book, next to "Log session".
      await tp.goto(`${WEB}/book?id=${book.id}`);
      await tp.getByTestId("book-page").waitFor();
      await tp.getByTestId("tab-reading").click();
      equal(await tp.getByTestId("open-timer").getAttribute("aria-label"), "Reading timer", "the name of the way to the timer");
      await tp.getByTestId("open-timer").click();
      await tp.getByTestId("timer-page").waitFor();
      equal(await tp.getByTestId("timer-book").innerText(), "Middlemarch", "whose timer this is");
      equal(await clock(), "00:00:00", "the clock before the start");
      assert((await tp.getByTestId("timer-discard").isDisabled()) && (await tp.getByTestId("timer-stop").isDisabled()), "nothing to discard or to log before the start");
      equal(await tp.getByTestId("timer-toggle").getAttribute("aria-label"), "Start", "the round button before the start");
      equal(await stored(), null, "nothing is kept before the start");
      deepAudit(await audit(tp), "timer page");

      // Start.
      const before = Date.now();
      await tp.getByTestId("timer-toggle").click();
      await until(async () => (await clock()) >= "00:00:02", "the clock counts");
      equal(await tp.getByTestId("timer-toggle").getAttribute("aria-label"), "Pause", "the round button while it runs");
      const running = await stored();
      assert(running.bookId === book.id && running.runningSince >= before && running.startedAt === running.runningSince && running.accumulatedSeconds === 0, `what the browser keeps: ${JSON.stringify(running)}`);

      // It goes on counting on other pages, and a line in the frame of the site says so and leads back.
      await tp.goto(`${WEB}/`);
      await line.waitFor();
      assert((await line.innerText()).includes("Middlemarch"), "the line names the book");
      const first = (await line.innerText()).match(/\d\d:\d\d:\d\d/)[0];
      assert(first >= "00:00:02", `the clock was not set back by loading another page: ${first}`);
      await until(async () => (await line.innerText()).match(/\d\d:\d\d:\d\d/)[0] > first, "the clock in the line counts");
      await tp.locator('[data-testid="nav-stats"]:visible').click();
      await tp.waitForURL(/\/stats$/);
      await tp.locator("main#content h1").first().waitFor();
      await line.waitFor();
      await shot(tp, "timer-line");
      await tp.setViewportSize(PHONE);
      await line.waitFor();
      deepAudit(await audit(tp), "a page with the timer line on a phone");
      await tp.goto(`${WEB}/`);
      await line.waitFor();
      await tp.waitForTimeout(500);
      await shot(tp, "timer-line-mobile");
      await tp.setViewportSize(DESKTOP);
      await line.click();
      await tp.getByTestId("timer-page").waitFor();
      assert(tp.url().endsWith(`/book/timer?id=${book.id}`), `where the line leads: ${tp.url()}`);
      equal(await line.count(), 0, "lines on the timer page of the book itself");

      // Pause: the clock stands still, also through a reload. Going on adds to what was counted.
      await tp.getByTestId("timer-toggle").click();
      equal(await tp.getByTestId("timer-toggle").getAttribute("aria-label"), "Start", "the round button while paused");
      const paused = await clock();
      assert(paused >= "00:00:03", `what was counted before the pause: ${paused}`);
      await tp.waitForTimeout(1300);
      equal(await clock(), paused, "the clock during a pause");
      equal((await stored()).runningSince, null, "a paused timer has no running start");
      await tp.reload();
      await tp.getByTestId("timer-page").waitFor();
      equal(await clock(), paused, "the paused clock after a reload");
      await tp.getByTestId("timer-toggle").click();
      await until(async () => (await clock()) > paused, "the clock goes on");

      // The reader reads on for 25 minutes. The test cannot wait that long, so the start is moved back instead.
      await tp.evaluate(
        ([name, minutes]) => {
          const timer = JSON.parse(localStorage.getItem(name));
          timer.runningSince -= minutes * 60_000;
          timer.startedAt -= minutes * 60_000;
          localStorage.setItem(name, JSON.stringify(timer));
        },
        [key, 25],
      );
      await tp.reload();
      await tp.getByTestId("timer-page").waitFor();
      await until(async () => (await clock()).startsWith("00:25:"), "the clock 25 minutes on");
      await tp.waitForTimeout(300);
      await shot(tp, "timer");
      const startedAt = (await stored()).startedAt;

      // There is one timer. The page of another book starts from nothing and points at the one that runs.
      await tp.goto(`${WEB}/book/timer?id=${other.id}`);
      await tp.getByTestId("timer-page").waitFor();
      equal(await clock(), "00:00:00", "the clock of a book without a timer");
      assert((await line.innerText()).includes("Middlemarch"), "the running timer is pointed at");
      await line.click();
      await until(async () => (await clock()).startsWith("00:25:"), "back at the running timer");

      // Stop and log: the form the site has for sessions, with the minutes filled in.
      await tp.getByTestId("timer-stop").click();
      await tp.getByTestId("session-dialog").waitFor();
      equal(await tp.getByTestId("session-minutes").inputValue(), "25", "the minutes the timer measured");
      equal(await tp.getByTestId("session-from").inputValue(), "0", "the page the session starts on");
      await tp.getByTestId("session-to").fill("42");
      await tp.getByTestId("session-save").click();
      await tp.getByTestId("book-page").waitFor();
      const logged = await untilVault(tess, (v) => v.sessions?.length === 1, "the session in the library");
      const [session] = logged.sessions;
      equal(session.bookId, book.id, "the book of the session");
      equal(session.minutes, 25, "its minutes");
      equal(session.startPage ?? 0, 0, "where it started");
      equal(session.endPage, 42, "where it ended");
      equal(session.startedAt, startedAt, "the session starts when the timer was started");
      equal(bookOf(logged, "Middlemarch").currentPage, 42, "the page the book is on now");
      // The timer is gone, and nothing of it was ever part of the library.
      equal(await tp.evaluate((name) => localStorage.getItem(name), key), null, "what the browser keeps after logging");
      equal(await tp.locator('[data-testid="timer-line"]').count(), 0, "timer lines after logging");
      assert(!/runningSince|accumulatedSeconds/.test(JSON.stringify(logged)), "the timer is not in the library");

      // Discard throws a timer away without a trace.
      await tp.getByTestId("tab-reading").click();
      equal(await tp.getByTestId("session-row").count(), 1, "sessions on the book page");
      await tp.getByTestId("open-timer").click();
      await tp.getByTestId("timer-toggle").click();
      await until(async () => (await clock()) >= "00:00:01", "the second timer counts");
      await tp.getByTestId("timer-discard").click();
      equal(await clock(), "00:00:00", "the clock after discarding");
      equal(await stored(), null, "what the browser keeps after discarding");
      await waitSaved(tp);
      equal((await vaultOf(tess)).vault.sessions.length, 1, "sessions after a discarded timer");
      await context.close();
    },
    null,
  );

  await test(
    "lists from Goodreads and StoryGraph are imported after a preview, each as one save, and never twice",
    async () => {
      const gina = account("Gina");
      const context = await newContext();
      const gp = await context.newPage();
      await signUp(gp, gina);
      await gp.getByTestId("empty-library").waitFor();
      // Dune is here already, with Gina's own opinion of it, and so is a list.
      await addByHand(gp, { title: "Dune", authors: "Frank Herbert" });
      const start = await vaultOf(gina);
      const mine = bookOf(start.vault, "Dune");
      await rpc(gina.session.token, "shelfmark_vault_push", {
        p_payload: { ...start.vault, books: start.vault.books.map((b) => (b.id === mine.id ? { ...b, rating: 3, review: "My own words" } : b)), shelves: [{ id: 21, name: "Sci-Fi", position: 0, createdAt: 1 }] },
        p_expected: start.revision,
      });
      const saves = [];
      gp.on("request", (r) => {
        if (r.url().endsWith("/rest/v1/rpc/shelfmark_vault_push")) saves.push(r.postDataJSON());
      });
      const choose = async (file) => {
        await gp.getByTestId("import-file").setInputFiles(file);
      };
      const text = (id) => gp.getByTestId(id).innerText();

      await gp.goto(`${WEB}/settings`);
      await gp.getByTestId("import-card").waitFor();
      assert((await text("import-card")).includes("Goodreads, StoryGraph or any CSV list"), "the card says what it is for");
      equal(await text("import-csv"), "Choose CSV file", "the button");

      // ---- Goodreads ----
      await choose(`${FIXTURES}goodreads_export.csv`);
      const dialog = gp.getByTestId("import-dialog");
      await dialog.waitFor();
      assert((await dialog.innerText()).includes("Import from Goodreads"), "the kind of list is recognised");
      equal(await text("import-found"), "3 books found in the file", "books found");
      assert((await text("import-new")).startsWith("2 new books"), `new books: ${await text("import-new")}`);
      assert((await text("import-known")).startsWith("1 book is already here and only gets its gaps filled"), `known books: ${await text("import-known")}`);
      await gp.getByTestId("import-new").locator("summary").click();
      assert((await text("import-new")).includes("Der Vorleser") && (await text("import-new")).includes("Momo") && !(await text("import-new")).includes("Dune"), "which books are new");
      await gp.getByTestId("import-known").locator("summary").click();
      assert((await text("import-known")).includes("Dune"), "which book is skipped as already there");
      equal(await text("import-lists"), "New lists: favorites", "the list that will be created");
      const columns = await text("import-columns");
      for (const column of ["Title", "Author", "ISBN13", "My Rating", "Exclusive Shelf", "Bookshelves", "Date Read"]) assert(columns.includes(column), `the column ${column} is recognised: ${columns}`);
      assert((await text("import-ignored")).includes("Average Rating") && !columns.includes("Average Rating"), "what is not used is said too");
      deepAudit(await audit(gp), "import preview");
      await gp.waitForTimeout(300);
      await shot(gp, "import-preview");
      // Nothing is saved before the reader says so.
      equal(saves.length, 0, "saves before the import is confirmed");
      equal((await vaultOf(gina)).vault.books.length, 1, "books before the import is confirmed");

      await gp.getByTestId("import-confirm").click();
      await gp.getByTestId("import-done-dialog").waitFor();
      equal(await text("import-added"), "2 books added", "what was added");
      equal(await text("import-completed"), "1 existing book completed", "what was completed");
      const first = await untilVault(gina, (v) => v.books.length === 3, "the books of the Goodreads list");
      await waitSaved(gp);
      equal(saves.length, 1, "the whole import is one save");
      equal(saves[0].p_payload.books.length, 3, "and that save holds all of it");
      const dune = bookOf(first, "Dune");
      equal(dune.id, mine.id, "the book that was here is the same book");
      equal(dune.rating, 3, "Gina's own stars stay");
      equal(dune.review, "My own words", "and so does their review");
      equal(dune.isbn, "9780441172719", "the ISBN the file knew is filled in");
      equal(dune.pageCount, 896, "and the pages");
      const vorleser = bookOf(first, "Der Vorleser");
      equal(vorleser.status, "WISHLIST", "wanted but not owned is a wish");
      equal(vorleser.ownership, "NOT_OWNED", "and not owned");
      equal(vorleser.lendable, false, "nothing to lend there");
      const momo = bookOf(first, "Momo");
      equal(momo.status, "READING", "the state of a book that is being read");
      equal(momo.authors, "Michael Ende, Lucas Zwirner, Marcel Dzama", "all authors");
      for (const b of [vorleser, momo]) assert(b.id > 9e14 && Number.isSafeInteger(b.id), `the id ${b.id} is a website id`);
      assert(vorleser.id !== momo.id, "every book its own id");
      equal(first.shelves.map((s) => s.name).sort().join(","), "Sci-Fi,favorites", "the list that was there is used again, the other is new");
      equal(first.links.filter((l) => l.bookId === dune.id).length, 2, "Dune is on both lists");
      equal(first.links.length, 2, "and nothing else is on a list");
      assert(!/\bnull\b/.test(JSON.stringify(first)), "no nulls in the document after an import");

      // The done notice offers the covers, which such lists rarely bring. Not now.
      assert((await gp.getByTestId("import-done-dialog").innerText()).includes("Shelfmark can look them up now"), "covers are offered");
      await gp.getByTestId("import-done-close").click();
      await gp.getByTestId("import-done-dialog").waitFor({ state: "detached" });

      // The same file again: everything is known, nothing is added and nothing is saved.
      await choose(`${FIXTURES}goodreads_export.csv`);
      await dialog.waitFor();
      equal(await text("import-new"), "0 new books", "new books the second time");
      assert((await text("import-known")).startsWith("3 books are already here and only get their gaps filled"), "known books the second time");
      equal(await gp.getByTestId("import-lists").count(), 0, "lists to create the second time");
      await gp.getByTestId("import-confirm").click();
      await gp.getByTestId("import-done-dialog").waitFor();
      equal(await text("import-added"), "0 books added", "added the second time");
      equal(await text("import-completed"), "0 existing books completed", "completed the second time");
      await gp.getByTestId("import-done-close").click();
      await gp.waitForTimeout(800);
      equal(saves.length, 1, "saves after importing the same file again");
      const second = await vaultOf(gina);
      equal(second.vault.books.length, 3, "books after importing the same file again");
      equal(second.vault.shelves.length, 2, "lists after importing the same file again");

      // ---- StoryGraph ----
      await choose(`${FIXTURES}storygraph_export.csv`);
      await dialog.waitFor();
      assert((await dialog.innerText()).includes("Import from StoryGraph"), "the other kind of list is recognised");
      equal(await text("import-found"), "4 books found in the file", "books found in the StoryGraph list");
      assert((await text("import-new")).startsWith("4 new books"), "new books in the StoryGraph list");
      equal(await text("import-known"), "0 books are already here and only get their gaps filled", "known books in the StoryGraph list");
      assert((await text("import-columns")).includes("Read Status") && (await text("import-ignored")).includes("Moods"), "its columns");
      await gp.getByTestId("import-confirm").click();
      await gp.getByTestId("import-done-dialog").waitFor();
      equal(await text("import-added"), "4 books added", "added from StoryGraph");
      equal(await text("import-completed"), "0 existing books completed", "completed from StoryGraph");
      await gp.getByTestId("import-done-close").click();
      const third = await untilVault(gina, (v) => v.books.length === 7, "the books of both lists");
      await waitSaved(gp);
      equal(saves.length, 2, "the second import is one save as well");
      const hobbit = bookOf(third, "The Hobbit");
      equal(hobbit.status, "READ", "a book that was read");
      equal(hobbit.rating, 4.5, "half stars");
      equal(hobbit.finishedOn - hobbit.startedOn, 17, "from the 3rd to the 20th of January");
      equal(hobbit.review, "Cosy.", "the review without its markup");
      equal(bookOf(third, "Project Hail Mary").format, "AUDIOBOOK", "an audiobook");
      equal(bookOf(third, "Piranesi").status, "ABANDONED", "a book that was given up");
      equal(bookOf(third, "Piranesi").rating, 2.25, "quarter stars are kept as they are");
      equal(bookOf(third, "Babel").status, "WISHLIST", "a wish");
      await choose(`${FIXTURES}storygraph_export.csv`);
      await dialog.waitFor();
      equal(await text("import-new"), "0 new books", "new books when the StoryGraph list comes again");
      await gp.getByTestId("import-confirm").click();
      await gp.getByTestId("import-done-dialog").waitFor();
      equal(await text("import-added"), "0 books added", "added when the StoryGraph list comes again");
      await gp.getByTestId("import-done-close").click();
      await gp.waitForTimeout(800);
      equal(saves.length, 2, "saves after the StoryGraph list came again");
      equal((await vaultOf(gina)).vault.books.length, 7, "books after the StoryGraph list came again");

      // On the shelf: a shelf for every state the lists brought, and the two lists.
      await gp.goto(`${WEB}/`);
      await gp.getByTestId("greeting").waitFor();
      assert((await text("greeting")).includes("7 books on your shelves"), `the greeting: ${await text("greeting")}`);
      for (const shelf of ["READING", "NONE", "READ", "WISHLIST", "ABANDONED", "list_21", `list_${third.shelves.find((s) => s.name === "favorites").id}`]) await gp.getByTestId(`shelf-${shelf}`).waitFor();
      for (const title of ["Dune", "Der Vorleser", "Momo", "The Hobbit", "Project Hail Mary", "Piranesi", "Babel"]) {
        assert((await gp.locator(`.bookcase [aria-label="${title}"]`).count()) >= 1, `${title} stands on a shelf`);
      }
      await gp.waitForTimeout(600);
      await shot(gp, "shelf-imported", { fullPage: true });

      // The covers such lists do not bring are looked up for the whole library at once.
      await gp.goto(`${WEB}/settings`);
      equal(await text("find-covers"), "Find missing covers", "the button for the covers");
      await gp.getByTestId("find-covers").click();
      await gp.getByText(/^\d+ covers? found$/).waitFor();
      equal(await text("find-covers"), "Find missing covers", "the button once the search is over");
      const covered = await untilVault(gina, (v) => Boolean(bookOf(v, "Der Vorleser").coverUrl), "covers in the library");
      await waitSaved(gp);
      // Every book that has an ISBN gets a cover from the catalogues. Without one, the title has to match, and here it does not.
      for (const title of ["Dune", "Der Vorleser", "The Hobbit", "Project Hail Mary", "Babel"]) assert(/^https:\/\//.test(bookOf(covered, title).coverUrl ?? ""), `${title} has a cover now`);
      for (const title of ["Momo", "Piranesi"]) assert(!bookOf(covered, title).coverUrl, `${title} still has none`);
      equal(saves.length, 3, "the covers that were found are one more save, not one each");

      // ---- what is no list of books ----
      writeFileSync(`${OUTPUT}sentence.csv`, "just a sentence, with a comma\n");
      await choose(`${OUTPUT}sentence.csv`);
      assert((await text("import-problem")).startsWith("No list of books was found in this file."), "a file without a title column");
      writeFileSync(`${OUTPUT}archive.zip`, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0]));
      await choose(`${OUTPUT}archive.zip`);
      assert((await text("import-problem")).startsWith("This is a zip file."), "a zip file");
      // A list as a spreadsheet on Windows saves it: semicolons, and umlauts that are no UTF-8.
      writeFileSync(`${OUTPUT}liste.csv`, Buffer.from("Titel;Autor;Seiten;Status\r\nDer Schwarm;Frank Sch\u00e4tzing;987;Gelesen\r\n", "latin1"));
      await choose(`${OUTPUT}liste.csv`);
      await dialog.waitFor();
      equal(await gp.getByTestId("import-problem").count(), 0, "the earlier complaint is gone");
      assert((await dialog.innerText()).includes("Import from CSV"), "any list with a title column");
      assert((await text("import-columns")).includes("Titel, Autor, Seiten, Status"), "German column names");
      await gp.getByTestId("import-confirm").click();
      await gp.getByTestId("import-done-dialog").waitFor();
      equal(await text("import-added"), "1 book added", "one book, in the singular");
      await gp.getByTestId("import-done-close").click();
      const last = await untilVault(gina, (v) => bookOf(v, "Der Schwarm"), "the book from the German list");
      equal(bookOf(last, "Der Schwarm").authors, "Frank Sch\u00e4tzing", "the umlaut survived");
      equal(bookOf(last, "Der Schwarm").status, "READ", "the German word for read");
      await context.close();
    },
    null,
  );

  await test(
    "a library the website cannot read is not opened and never replaced, and a word it does not know passes through untouched",
    async () => {
      const push = (who, document, expected) => rpc(who.session.token, "shelfmark_vault_push", { p_payload: document, p_expected: expected });
      const onServer = (who) => rpc(who.session.token, "shelfmark_vault_pull", { p_known: 0 });
      // The same thing whatever order its fields are written in.
      const canon = (value) => JSON.stringify(value, (key, part) => (part && typeof part === "object" && !Array.isArray(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => (a < b ? -1 : 1))) : part));

      // A library as a newer version of the app could write it: with words nobody here has
      // heard of, wherever a fixed set is expected, and with fields this website does not know.
      const future = {
        exportedAt: 5,
        books: [
          { id: 1, title: "Paused", authors: "A. Writer", pageCount: 200, format: "COMIC", status: "PAUSED", ownership: "LIBRARY", mood: "bright" },
          { id: 2, title: "Plain", authors: "B. Writer", status: "READ" },
        ],
        shelves: [{ id: 3, name: "Later" }],
        links: [{ bookId: 1, shelfId: 3 }],
        quotes: [],
        goals: [{ id: 4, kind: "CHAPTERS", target: 30, startDay: today - 10, endDay: today + 10, repeat: "QUARTERLY" }],
        ornaments: [
          { id: 5, shelfKey: "READ", kind: "TEAPOT", position: 1 },
          { id: 6, shelfKey: "attic", kind: "ROBOT" },
        ],
        prefs: { profileName: "Quin", theme: "aurora", viewMode: "GRID", sort: "COLOUR" },
        shelfColour: "oak",
      };
      const quin = account("Quin");
      await signUpByApi(quin);
      await push(quin, future, 0);
      // Rosa is a friend, and sees what Quin's website shows to friends.
      const rosa = account("Rosa");
      await signUpByApi(rosa);
      await rpc(rosa.session.token, "shelfmark_add_friend", { p_code: (await rpc(quin.session.token, "shelfmark_hello")).code });
      const shelfForRosa = async () => (await rpc(rosa.session.token, "shelfmark_sync", { p_known: {} })).libraries[0]?.payload.library.books ?? [];

      const context = await newContext();
      const qp = await context.newPage();
      await signInOnPage(qp, quin);
      await qp.getByTestId("greeting").waitFor();
      // A view nobody here knows is drawn as the usual one.
      await qp.getByTestId("cover-shelf").first().waitFor();
      await until(async () => (await shelfForRosa()).length === 2, "Quin's shelf, as a friend sees it");
      equal((await shelfForRosa()).map((b) => `${b.status} ${b.ownership ?? "OWNED"} ${b.format ?? "UNKNOWN"}`).join(", "), "PAUSED LIBRARY COMIC, READ OWNED UNKNOWN", "the words a friend is shown");
      // Every page that shows such a thing copes with it. What a page chokes on, the browser reports.
      for (const path of ["/", "/lists", "/stats", "/stats/goals", "/stats/recap", "/stats/milestones", "/settings", "/book?id=1", "/book/edit?id=1"]) {
        await qp.goto(`${WEB}${path}`);
        await qp.locator("main#content h1").first().waitFor();
        await qp.waitForTimeout(250);
      }
      // Looking changed nothing.
      equal((await onServer(quin)).revision, 1, "saves made by looking at a library with unknown words");

      // The reader corrects the book and rates it, gives the goal another target and themselves another name.
      await qp.getByTestId("field-publisher").fill("Press");
      await qp.getByTestId("save-book").click();
      await qp.getByTestId("book-page").waitFor();
      await qp.getByTestId("star4").click();
      await waitSaved(qp);
      // They read in it, too. That moves the bookmark, and leaves alone a status nobody here knows:
      // a book that is "not started" would count as being read from here on, this one is something else.
      await qp.getByTestId("tab-reading").click();
      await qp.getByTestId("log-session-reading").click();
      await qp.getByTestId("session-to").fill("50");
      await qp.getByTestId("session-minutes").fill("30");
      await qp.getByTestId("session-save").click();
      await waitSaved(qp);
      await qp.goto(`${WEB}/stats/goals`);
      await qp.getByTestId("goal-card").locator("button.entry-button").click();
      await qp.getByTestId("goal-target").fill("40");
      await qp.getByTestId("goal-save").click();
      await qp.goto(`${WEB}/settings`);
      await qp.getByTestId("profile-name-field").fill("Quin Q.");
      await qp.getByTestId("profile-name-field").blur();
      await untilVault(quin, (v) => v.prefs.profileName === "Quin Q." && v.books[0].rating === 4 && v.books[0].publisher === "Press" && v.books[0].currentPage === 50 && v.goals[0].target === 40, "the five changes saved");
      await waitSaved(qp);
      const after = (await onServer(quin)).payload;
      const expected = structuredClone(future);
      Object.assign(expected.books[0], { rating: 4, publisher: "Press", currentPage: 50 });
      expected.goals[0].target = 40;
      expected.prefs.profileName = "Quin Q.";
      // Everything else is what it was, word for word: nothing was turned into a word this website knows.
      for (const part of ["shelves", "links", "quotes", "goals", "ornaments", "prefs", "shelfColour"]) equal(canon(after[part]), canon(expected[part]), `${part} as the website saved them`);
      const paused = { ...after.books[0] };
      delete paused.updatedAt;
      equal(canon(paused), canon(expected.books[0]), "the book with the words this website does not know");
      equal(canon(after.books[1]), canon(expected.books[1]), "the book nobody touched");
      equal(after.sessions.length, 1, "the reading session");
      equal(Object.keys(after).sort().join(","), "books,exportedAt,goals,links,ornaments,prefs,quotes,sessions,shelfColour,shelves", "the parts of the library as the website saved it");

      // While the site is open, another device with a newer app saves in a format this website does not know.
      // The reader, who cannot know, rates the book once more: that save meets the other one.
      await qp.goto(`${WEB}/book?id=1`);
      await qp.getByTestId("book-page").waitFor();
      const revision = (await onServer(quin)).revision;
      const newer = { ...after, format: 2, volumes: [1, 2, 3] };
      await push(quin, newer, revision);
      await qp.getByTestId("star5").click();
      const closed = qp.getByTestId("load-failed");
      await closed.waitFor();
      equal(await closed.getAttribute("data-problem"), "newer", "why the library was closed");
      equal(await closed.locator("h2").innerText(), "Your library was not opened", "the headline");
      equal(await qp.getByTestId("load-problem").innerText(), "It was last saved by a newer version of Shelfmark than this website knows. The website needs an update before it can open it. Nothing was changed.", "what the page says");
      deepAudit(await audit(qp), "page for a library that was not opened");
      await qp.waitForTimeout(300);
      await shot(qp, "library-not-opened");
      // The message stays, after asking again and on every page of the library, and nothing is written.
      await qp.getByRole("button", { name: "Try again" }).click();
      await qp.waitForTimeout(500);
      await closed.waitFor();
      equal(await closed.getAttribute("data-problem"), "newer", "the reason after asking again");
      await qp.goto(`${WEB}/book?id=1`);
      await closed.waitFor();
      equal(await qp.getByTestId("book-page").count(), 0, "pages of a library that is not open");
      await qp.goto(`${WEB}/friends`);
      await closed.waitFor();
      await qp.waitForTimeout(800);
      const untouched = await onServer(quin);
      equal(untouched.revision, revision + 1, "the revision after the library became unreadable");
      equal(canon(untouched.payload), canon(newer), "the library of the newer version, as it was left");
      // Friends are not shown an empty shelf in its place either.
      equal((await shelfForRosa()).length, 2, "books a friend still sees");

      // A damaged library: the same, in other words. Here in German, for somebody who signs in fresh.
      const damaged = { ...after, books: "lost" };
      await push(quin, damaged, revision + 1);
      const german = await newContext({ locale: "de-CH" });
      const gp = await german.newPage();
      await signInOnPage(gp, quin);
      const kaputt = gp.getByTestId("load-failed");
      await kaputt.waitFor();
      equal(await kaputt.getAttribute("data-problem"), "unreadable", "why the library was not opened");
      equal(await kaputt.locator("h2").innerText(), "Deine Bibliothek wurde nicht geöffnet", "the headline, in German");
      equal(await gp.getByTestId("load-problem").innerText(), "Sie lässt sich nicht lesen: Sie ist beschädigt oder so geschrieben, wie es diese Website nicht kennt. Es wurde nichts verändert, und von hier aus wird nichts darüber geschrieben.", "what the page says, in German");
      await gp.waitForTimeout(800);
      equal(canon((await onServer(quin)).payload), canon(damaged), "the damaged library, as it was left");
      equal((await onServer(quin)).revision, revision + 2, "the revision of the damaged library");
      // Signing out still works from there. At the address of the site that leads to the front page.
      await gp.getByRole("button", { name: "Abmelden" }).click();
      await gp.getByTestId("landing").waitFor();
      equal(await gp.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("shelfmark.auth")).length), 0, "nothing of the sign-in stays in the browser");
      await german.close();

      // Once the library can be read again, asking again opens it.
      await push(quin, after, revision + 2);
      await qp.getByRole("button", { name: "Try again" }).click();
      await qp.getByTestId("friends-page").waitFor();
      // The same when it happens while the site is only looked at: the next look at the server closes the library ...
      const halfWritten = { ...after, books: [{ id: 1, title: "Paused", pageCount: "many" }] };
      await push(quin, halfWritten, revision + 3);
      await lookNow(qp);
      await closed.waitFor();
      equal(await closed.getAttribute("data-problem"), "unreadable", "why the library was closed while it was looked at");
      await qp.waitForTimeout(600);
      equal(canon((await onServer(quin)).payload), canon(halfWritten), "the half-written library, as it was left");
      equal((await onServer(quin)).revision, revision + 4, "the revision of the half-written library");
      // ... and the look after it was repaired opens it again, without anybody pressing anything.
      await push(quin, after, revision + 4);
      await lookNow(qp);
      await qp.getByTestId("friends-page").waitFor();
      await qp.goto(`${WEB}/`);
      await qp.getByTestId("greeting").waitFor();
      assert((await qp.getByTestId("greeting").innerText()).includes("Quin Q."), "the library is open again");

      // A backup file is held to the same: a newer or damaged one is not restored as what could be made of it.
      await qp.goto(`${WEB}/settings`);
      writeFileSync(`${OUTPUT}backup-newer.json`, JSON.stringify({ app: "shelfmark", v: 1, type: "backup", backup: newer }));
      await qp.getByTestId("backup-file").setInputFiles(`${OUTPUT}backup-newer.json`);
      equal(await qp.getByTestId("backup-problem").innerText(), "This file comes from a newer version of Shelfmark. Please update the app.", "a backup in a newer format");
      writeFileSync(`${OUTPUT}backup-damaged.json`, JSON.stringify({ app: "shelfmark", v: 1, type: "backup", backup: halfWritten }));
      await qp.getByTestId("backup-file").setInputFiles(`${OUTPUT}backup-damaged.json`);
      await until(async () => (await qp.getByTestId("backup-problem").innerText()) === "This is not a Shelfmark backup.", "a damaged backup is refused");
      equal(await qp.getByTestId("restore-dialog").count(), 0, "offers to restore what cannot be read");
      await context.close();
    },
    null,
  );

  await test(
    "a cover picture goes with its book: when the book is deleted, when it gets another cover, and with the account at the latest",
    async () => {
      const sven = account("Sven");
      const context = await newContext();
      const sp = await context.newPage();
      await signUp(sp, sven);
      await sp.getByTestId("empty-library").waitFor();
      sven.session = await signIn(sven.email, sven.password);
      const answers = async (address) => (await fetch(address)).status;
      const gone = (address, what) => until(async () => (await answers(address)) !== 200, what);
      /** What the server says is in Sven's folder. */
      const folder = async () => {
        const listed = await fetch(`${SERVER}/storage/v1/object/list/shelfmark-covers`, {
          method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${sven.session.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: sven.session.id, limit: 100, offset: 0 }),
        });
        return (await listed.json()).map((entry) => entry.name);
      };
      const nameOf = (address) => address.split("/").pop();
      let colour = 40;
      /** Uploads a picture in the form that is open, and returns the address the form shows for it. */
      const upload = async (shownBefore = null) => {
        writeFileSync(`${OUTPUT}cover-sven.png`, png(300, 450, [colour, 90, 120]));
        colour += 30;
        await sp.getByTestId("cover-file").setInputFiles(`${OUTPUT}cover-sven.png`);
        const picture = sp.locator('[data-testid="book-form"] img[src*="/storage/v1/object/public/shelfmark-covers/"]');
        await until(async () => (await picture.count()) === 1 && (await picture.getAttribute("src")) !== shownBefore, "the uploaded picture in the form");
        return picture.getAttribute("src");
      };
      const edit = async (title) => {
        await sp.goto(`${WEB}/book/edit?id=${bookOf((await vaultOf(sven)).vault, title).id}`);
        await sp.getByTestId("book-form").waitFor();
      };
      const save = async () => {
        await sp.getByTestId("save-book").click();
        await sp.getByTestId("book-page").waitFor();
        await waitSaved(sp);
      };
      const remove = async () => {
        await sp.getByTestId("delete-book").click();
        await sp.getByTestId("confirm").click();
      };

      // A book gets a picture.
      await addByHand(sp, { title: "Ronja", authors: "Astrid Lindgren" });
      await edit("Ronja");
      const first = await upload();
      await save();
      await untilVault(sven, (v) => bookOf(v, "Ronja").coverUrl === first, "the first picture in the library");
      equal(await answers(first), 200, "the picture while its book shows it");
      equal((await folder()).join(), nameOf(first), "what is in the folder of the account");
      // Nobody else is told what is in that folder.
      const tilda = account("Tilda");
      await signUpByApi(tilda);
      const asTilda = await fetch(`${SERVER}/storage/v1/object/list/shelfmark-covers`, {
        method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${tilda.session.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: sven.session.id, limit: 100, offset: 0 }),
      });
      equal(JSON.stringify(await asTilda.json()), "[]", "what another account is told about the folder");

      // The book gets another cover: the old picture is removed once that is saved, the new one is there.
      await edit("Ronja");
      const second = await upload(first);
      assert(second !== first, "another upload has another address");
      equal(await answers(first), 200, "the old picture while the change is not saved");
      await save();
      await untilVault(sven, (v) => bookOf(v, "Ronja").coverUrl === second, "the second picture in the library");
      await gone(first, "the address of the replaced picture stops answering");
      equal(await answers(second), 200, "the new picture");

      // A picture that was uploaded and then not used is not left behind either.
      await edit("Ronja");
      const unused = await upload(second);
      equal(await answers(unused), 200, "the picture that is only in the form");
      await sp.locator('[data-testid="book-form"] header a').first().click();
      await sp.getByTestId("book-page").waitFor();
      await gone(unused, "the address of the picture that was never saved stops answering");
      equal(await answers(second), 200, "the cover the book still shows");
      equal(bookOf((await vaultOf(sven)).vault, "Ronja").coverUrl, second, "the cover in the library after leaving the form");

      // Another book shows the same picture, by its address. Deleting one of the two leaves it.
      await addByHand(sp, { title: "Ronja, second copy", authors: "Astrid Lindgren" });
      await edit("Ronja, second copy");
      await sp.getByTestId("cover-address").fill(second);
      await sp.getByTestId("cover-address-use").click();
      await save();
      await untilVault(sven, (v) => v.books.filter((b) => b.coverUrl === second).length === 2, "two books with the same picture");
      await remove();
      await untilVault(sven, (v) => v.books.length === 1, "one of the two deleted");
      await sp.waitForTimeout(800);
      equal(await answers(second), 200, "a picture another book still shows");
      // The last book that shows it is deleted: now the picture goes.
      await openBook(sp, sven, "Ronja");
      await remove();
      await untilVault(sven, (v) => v.books.length === 0, "the book deleted");
      await gone(second, "the address of the picture stops answering once its book is deleted");
      equal((await folder()).length, 0, "pictures left in the folder of the account");

      // A picture that cannot be removed does not stop its book from being deleted.
      await addByHand(sp, { title: "Emil", authors: "Erich Kaestner" });
      await edit("Emil");
      const stuck = await upload();
      await save();
      await untilVault(sven, (v) => bookOf(v, "Emil").coverUrl === stuck, "the picture of the third book");
      await sp.route("**/storage/v1/object/shelfmark-covers/**", (route) => (route.request().method() === "DELETE" ? route.abort() : route.continue()));
      await remove();
      await untilVault(sven, (v) => v.books.length === 0, "the book is deleted although its picture could not be removed");
      await sp.getByTestId("empty-library").waitFor();
      await sp.waitForTimeout(600);
      equal(await answers(stuck), 200, "the picture that could not be removed");
      await sp.unroute("**/storage/v1/object/shelfmark-covers/**");

      // The account is deleted. No book names that picture any more, but the folder is asked what it holds, and everything in it goes.
      const asked = [];
      sp.on("request", (r) => {
        if (r.url().endsWith("/storage/v1/object/list/shelfmark-covers")) asked.push(`list ${r.postData()}`);
        if (r.method() === "DELETE" && r.url().includes("/storage/v1/object/shelfmark-covers/")) asked.push(`remove ${nameOf(r.url())}`);
        if (r.url().endsWith("/rest/v1/rpc/shelfmark_delete_account")) asked.push("account");
      });
      await sp.goto(`${WEB}/settings`);
      await sp.getByTestId("delete-account").click();
      await sp.getByTestId("delete-account-check").check();
      await sp.getByTestId("delete-account-confirm").click();
      await sp.getByTestId("login-notice").waitFor();
      equal(await sp.getByTestId("login-notice").innerText(), "Your account is deleted.", "the notice after deleting");
      equal(asked.join(" | "), `list ${JSON.stringify({ prefix: sven.session.id, limit: 100, offset: 0 })} | remove ${nameOf(stuck)} | account`, "what was asked of the server, in this order");
      assert((await answers(stuck)) !== 200, "the picture of a book that was removed earlier no longer answers once the account is deleted");
      await context.close();
    },
    null,
  );

  await test(
    "delete the account, after a confirmation that names what goes, and its pictures with it",
    async () => {
      const context = await newContext();
      const zedPage = await context.newPage();
      await signUp(zedPage, zed);
      await zedPage.getByTestId("empty-library").waitFor();
      await addByHand(zedPage, { title: "Goodbye", authors: "Zed" });
      zed.session = await signIn(zed.email, zed.password);
      // The book carries a picture Zed uploaded. It has to go with the account.
      const goodbye = bookOf((await vaultOf(zed)).vault, "Goodbye");
      await zedPage.goto(`${WEB}/book/edit?id=${goodbye.id}`);
      await zedPage.getByTestId("book-form").waitFor();
      writeFileSync(`${OUTPUT}cover-zed.png`, png(300, 450, [60, 70, 120]));
      await zedPage.getByTestId("cover-file").setInputFiles(`${OUTPUT}cover-zed.png`);
      const picture = zedPage.locator('[data-testid="book-form"] img[src*="/storage/v1/object/public/shelfmark-covers/"]');
      await picture.waitFor();
      const address = await picture.getAttribute("src");
      assert(address.startsWith(`${SERVER}/storage/v1/object/public/shelfmark-covers/${zed.session.id}/`), `the address of Zed's picture: ${address}`);
      await zedPage.getByTestId("save-book").click();
      await zedPage.getByTestId("book-page").waitFor();
      await untilVault(zed, (v) => bookOf(v, "Goodbye").coverUrl === address, "the address of Zed's cover in their library");
      equal((await fetch(address)).status, 200, "the picture while the account exists");
      const steps = [];
      let removal = null;
      zedPage.on("request", (r) => {
        if (r.method() === "DELETE" && r.url().includes("/storage/v1/object/shelfmark-covers/")) {
          steps.push("picture");
          removal = r;
        }
        if (r.url().endsWith("/rest/v1/rpc/shelfmark_delete_account")) steps.push("account");
      });
      await zedPage.goto(`${WEB}/settings`);
      await zedPage.getByTestId("delete-account").click();
      const dialog = zedPage.getByTestId("delete-account-dialog");
      await dialog.waitFor();
      const text = await dialog.innerText();
      for (const word of ["library", "books", "lists", "quotes", "friends", "cannot be undone", zed.email]) assert(text.includes(word), `the confirmation names: ${word}`);
      assert(await zedPage.getByTestId("delete-account-confirm").isDisabled(), "nothing is deleted before the box is ticked");
      await zedPage.getByTestId("delete-account-check").check();
      await zedPage.getByTestId("delete-account-confirm").click();
      await zedPage.getByTestId("login-notice").waitFor();
      equal(await zedPage.getByTestId("login-notice").innerText(), "Your account is deleted.", "the notice after deleting");
      // The picture was removed first, while there was still somebody allowed to remove it.
      equal(steps.join(", "), "picture, account", "what was asked of the server, in this order");
      equal(removal.url(), address.replace("/object/public/", "/object/"), "which picture was removed");
      equal(removal.headers().apikey, KEY, "the key of the project goes along");
      assert(/^Bearer .+\..+\..+$/.test(removal.headers().authorization ?? ""), "and so does Zed's sign-in");
      assert((await fetch(address)).status !== 200, "the address of the picture no longer answers");
      // The sign-in is gone with everything else.
      await zedPage.getByTestId("email").fill(zed.email);
      await zedPage.getByTestId("password").fill(zed.password);
      await zedPage.getByTestId("submit").click();
      equal(await zedPage.getByTestId("login-problem").innerText(), "E-mail or password is not right.", "signing in to a deleted account");
      await context.close();

      // A picture that cannot be removed does not keep anybody from leaving.
      const yuri = account("Yuri");
      const created = await (await fetch(`${SERVER}/auth/v1/signup`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: yuri.email, password: yuri.password }) })).json();
      yuri.session = { token: created.access_token, id: created.user.id };
      await rpc(yuri.session.token, "shelfmark_hello", { p_name: "Yuri" });
      const file = `${SERVER}/storage/v1/object/shelfmark-covers/${yuri.session.id}/kept.jpg`;
      const stored = await fetch(file, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${yuri.session.token}`, "Content-Type": "image/png", "x-upsert": "true" }, body: COVER_PNG });
      equal(stored.status, 200, "Yuri's picture is on the server");
      const kept = file.replace("/object/", "/object/public/");
      await rpc(yuri.session.token, "shelfmark_vault_push", { p_payload: { exportedAt: 1, books: [{ id: 1, title: "Stuck", coverUrl: kept }], shelves: [], links: [], quotes: [] }, p_expected: 0 });
      const second = await newContext();
      const yuriPage = await second.newPage();
      await yuriPage.route("**/storage/v1/object/shelfmark-covers/**", (route) => (route.request().method() === "DELETE" ? route.abort() : route.continue()));
      await signInOnPage(yuriPage, yuri);
      await yuriPage.getByTestId("greeting").waitFor();
      await yuriPage.goto(`${WEB}/settings`);
      await yuriPage.getByTestId("delete-account").click();
      await yuriPage.getByTestId("delete-account-check").check();
      await yuriPage.getByTestId("delete-account-confirm").click();
      await yuriPage.getByTestId("login-notice").waitFor();
      equal(await yuriPage.getByTestId("login-notice").innerText(), "Your account is deleted.", "the account goes although its picture could not be removed");
      let gone = false;
      try {
        await signIn(yuri.email, yuri.password);
      } catch {
        gone = true;
      }
      assert(gone, "Yuri's sign-in is gone");
      await second.close();
    },
    null,
  );

  await benContext.close();
  await annaContext.close();
}

/** Turns what the audit found into a failure that names the page. */
function deepAudit(found, where) {
  if (found.length > 0) throw new Error(`Accessibility on ${where}:\n${found.join("\n")}`);
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error(`\nThe run could not be completed: ${error?.stack ?? error}`);
} finally {
  await browser?.close().catch(() => undefined);
  gateway?.close();
  stopAll();
}

const passed = results.filter((r) => r.ok).length;
const broken = results.filter((r) => !r.ok);
console.log(`\n${results.length} tests, ${passed} passed, ${broken.length} failed${leftOut > 0 ? `, ${leftOut} left out by --only` : ""}`);
if (problems.length > 0) {
  console.log(`\nThe browsers reported ${problems.length} error(s) of their own:`);
  for (const problem of Array.from(new Set(problems)).slice(0, 20)) console.log(`  ${problem}`);
}
process.exit(failed || broken.length > 0 || problems.length > 0 ? 1 : 0);
