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
    window.__frontPage = { frames: 0, shown: 0 };
    const look = () => {
      const landing = document.querySelector('[data-testid="landing"]');
      window.__frontPage.frames++;
      if (landing && getComputedStyle(landing).display !== "none") window.__frontPage.shown++;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

const frontPageSeen = (page) => page.evaluate(() => window.__frontPage);

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
    "exchange the friend code, see the friend's shelf, ask to borrow, answer yes",
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
      await page.getByTestId("request-note").fill("For the holidays?");
      await page.getByTestId("ask-to-borrow").click();
      await page.getByTestId("request-state").waitFor();
      equal(await page.getByTestId("request-state").innerText(), "Request sent, waiting for Ben", "the request is on its way");
      await until(async () => (await rpc(ben.session.token, "shelfmark_sync", { p_known: {}, p_ack: [] })).messages.length === 1, "the request waits on the server for Ben");
      const asked = await untilVault(anna, (v) => v.requests?.length === 1, "the request in Anna's library");
      equal(asked.requests[0].incoming, false, "an outgoing request");
      equal(asked.requests[0].bookTitle, "Momo", "the book asked for");
      equal(asked.requests[0].peerName, "Ben", "whom it was asked of");
      assert(/^[0-9a-f-]{36}$/.test(asked.requests[0].id), "the id of a request is a UUID");
      assert(!("status" in asked.requests[0]), "waiting is the default and is left out");
      // A friend's book can go straight onto my wishlist. It is not mine, so it is not offered to others.
      await page.getByTestId("add-to-wishlist").click();
      const wished = bookOf(await untilVault(anna, (v) => bookOf(v, "Momo"), "Momo on Anna's wishlist"), "Momo");
      equal(wished.status, "WISHLIST", "the list it went on");
      equal(wished.ownership, "NOT_OWNED", "who owns it");
      equal(wished.authors, "Michael Ende", "what came along from the friend's shelf");
      await page.keyboard.press("Escape");
      await page.goto(`${WEB}/?status=WISHLIST`);
      await page.getByTestId("shelf-WISHLIST").waitFor();
      await page.locator('[data-testid="spine"], [data-testid="leaning"]').first().click();
      await page.getByTestId("delete-book").click();
      await page.getByTestId("confirm").click();
      await untilVault(anna, (v) => !bookOf(v, "Momo"), "the wish taken back");

      // Ben finds the request waiting, with the note, in German.
      await benPage.goto(`${WEB}/friends/requests`);
      const incoming = benPage.getByTestId("incoming-request");
      await incoming.waitFor();
      const question = await incoming.innerText();
      assert(question.includes("Anna") && question.includes("Momo") && question.includes("For the holidays?"), `the question Ben is asked: ${question}`);
      // The request is in Ben's library exactly once, however often the page looks.
      await benPage.reload();
      await benPage.getByTestId("incoming-request").waitFor();
      equal((await vaultOf(ben)).vault.requests.length, 1, "copies of the request in Ben's library");
      // The message was taken off the server once it was safely in the library.
      await until(async () => (await rpc(ben.session.token, "shelfmark_sync", { p_known: {}, p_ack: [] })).messages.length === 0, "the message is acknowledged");

      await benPage.getByTestId("answer-yes").click();
      await benPage.getByTestId("request-status").filter({ hasText: "Zugesagt" }).waitFor();
      // The page says when the answer has left.
      await benPage.getByText("Gesendet", { exact: true }).waitFor();
      const answered = await untilVault(ben, (v) => v.requests[0].status === "ACCEPTED", "the answer in Ben's library");
      // Saying yes marks Ben's copy as lent to Anna.
      equal(bookOf(answered, "Momo").lentTo, "Anna", "who has the book now");
      equal(bookOf(answered, "Momo").lentSince, today, "since when");
      const momo = bookOf(answered, "Momo");
      await benPage.goto(`${WEB}/book?id=${momo.id}`);
      await benPage.getByTestId("lent-to").waitFor();
      assert((await benPage.getByTestId("lent-to").innerText()).startsWith("Verliehen an Anna seit"), "the book page says it is lent");
      await benPage.goto(`${WEB}/`);
      await benPage.getByTestId("filter-lent").waitFor();
      assert((await benPage.getByTestId("filter-lent").innerText()).includes("Verliehen"), "a chip for what is lent out");

      // The answer arrives at Anna's, and the book is no longer free to borrow.
      await page.goto(`${WEB}/friends/requests`);
      await page.locator('[data-testid="request-status"][data-status="ACCEPTED"]').waitFor();
      equal(await page.getByTestId("request-status").innerText(), "Accepted", "the answer at Anna's");
      const informed = await untilVault(anna, (v) => v.requests[0].status === "ACCEPTED" && v.requests[0].answeredAt > 0, "the answer in Anna's library");
      equal(informed.requests.length, 1, "requests in Anna's library");
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("sync-now").click();
      await page.getByTestId("friend-card").getByTestId("open-friend").click();
      await page.getByTestId("cover").click();
      await page.getByTestId("request-state").waitFor();
      equal(await page.getByTestId("request-state").innerText(), "Ben said yes", "the state of the request on the friend's book");
      await page.keyboard.press("Escape");

      // Ben stops sharing ratings: the review disappears from what Anna sees.
      await benPage.goto(`${WEB}/friends`);
      await benPage.getByTestId("share-ratings").click();
      await untilVault(ben, (v) => v.prefs.shareRatings === false, "ratings no longer shared");
      await until(async () => {
        const news = await rpc(anna.session.token, "shelfmark_sync", { p_known: {}, p_ack: [] });
        return news.libraries[0]?.payload.library.includesRatings === false;
      }, "the published library without ratings");
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("sync-now").click();
      await page.getByTestId("friend-card").getByTestId("open-friend").click();
      await page.getByTestId("cover").click();
      await page.getByTestId("friend-book").waitFor();
      equal(await page.getByTestId("friend-opinion").count(), 0, "the friend's opinion once they stopped sharing it");
      await page.keyboard.press("Escape");
    },
    () => page,
  );

  await test(
    "what a friend publishes under another name, or sends in another's name, is ignored",
    async () => {
      // Carl becomes Anna's friend and then misbehaves, talking to the server directly.
      const response = await fetch(`${SERVER}/auth/v1/signup`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: carl.email, password: carl.password }) });
      const session = await response.json();
      carl.session = { token: session.access_token, id: session.user.id };
      await rpc(carl.session.token, "shelfmark_hello", { p_name: "Carl" });
      const annaCode = (await rpc(anna.session.token, "shelfmark_hello")).code;
      await rpc(carl.session.token, "shelfmark_add_friend", { p_code: annaCode });
      // A library that claims to be Ben's.
      await rpc(carl.session.token, "shelfmark_publish", {
        p_library: { app: "shelfmark", v: 1, type: "library", library: { ownerId: ben.session.id, ownerName: "Ben", createdAt: 1, includesStatus: true, includesRatings: true, books: [{ id: 1, title: "Forged" }] } },
      });
      // A request that claims to come from Ben, and an answer to Anna's request that Carl has no business giving.
      const annaVault = (await vaultOf(anna)).vault;
      await rpc(carl.session.token, "shelfmark_send", {
        p_to: anna.session.id,
        p_payload: { app: "shelfmark", v: 1, type: "lend_request", request: { requestId: "forged-1", bookId: 1, bookTitle: "Forged", fromId: ben.session.id, fromName: "Ben", toId: anna.session.id, createdAt: 1 } },
      });
      await rpc(carl.session.token, "shelfmark_send", {
        p_to: anna.session.id,
        p_payload: { app: "shelfmark", v: 1, type: "lend_answer", answer: { requestId: annaVault.requests[0].id, accepted: false, bookTitle: "Momo", fromId: carl.session.id, fromName: "Carl", toId: anna.session.id, answeredAt: 5 } },
      });
      // An honest request from Carl does arrive.
      await rpc(carl.session.token, "shelfmark_send", {
        p_to: anna.session.id,
        p_payload: { app: "shelfmark", v: 1, type: "lend_request", request: { requestId: "carl-1", bookId: bookOf(annaVault, "Dracula").id, bookTitle: "Dracula", bookAuthors: "Bram Stoker", fromId: carl.session.id, fromName: "Carl", toId: anna.session.id, createdAt: Date.now() } },
      });
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("sync-now").click();
      const carlCard = page.getByTestId("friend-card").filter({ hasText: "Carl" });
      await carlCard.waitFor();
      assert((await carlCard.innerText()).includes("has not shared a library yet"), "a library under a false name counts for nobody");
      const vault = await untilVault(anna, (v) => v.requests.some((r) => r.id === "carl-1"), "Carl's honest request");
      assert(!vault.requests.some((r) => r.id === "forged-1"), "the forged request was dropped");
      equal(vault.requests.find((r) => !r.incoming).status, "ACCEPTED", "Ben's yes stands, whatever Carl says");
      await until(async () => (await rpc(anna.session.token, "shelfmark_sync", { p_known: {}, p_ack: [] })).messages.length === 0, "all four messages are acknowledged, the forged ones too");
      // A badge on the friends tab says that somebody is waiting.
      await page.getByTestId("requests-waiting").waitFor();
      equal(await page.getByTestId("requests-waiting").innerText(), "1 request waits for your answer", "the waiting request is announced");
      // Anna says no. The book stays where it is.
      await page.getByTestId("open-requests").click();
      await page.getByTestId("incoming-request").waitFor();
      await page.getByTestId("answer-no").click();
      const declined = await untilVault(anna, (v) => v.requests.find((r) => r.id === "carl-1").status === "DECLINED", "the no");
      assert(!("lentTo" in bookOf(declined, "Dracula")), "a book that was not lent is not marked as lent");
      // The answer is sent once it is safely in Anna's library, which is a moment later.
      let news;
      await until(async () => {
        news = await rpc(carl.session.token, "shelfmark_sync", { p_known: {}, p_ack: [] });
        return news.messages.length > 0;
      }, "the answer on its way to Carl");
      equal(news.messages.length, 1, "messages waiting for Carl");
      equal(news.messages[0].payload.answer.accepted, false, "the answer Carl gets");
      equal(news.messages[0].payload.answer.fromId, anna.session.id, "who answered");
      // Friends can be removed again.
      await page.goto(`${WEB}/friends`);
      await page.getByTestId("friend-card").filter({ hasText: "Carl" }).getByTestId("remove-friend").click();
      await page.getByTestId("confirm").click();
      await page.getByTestId("friend-card").filter({ hasText: "Carl" }).waitFor({ state: "detached" });
      equal((await rpc(anna.session.token, "shelfmark_sync", { p_known: {}, p_ack: [] })).friends.length, 1, "friends left");
    },
    page,
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
      equal(restored.requests.length, 2, "requests after restoring");
    },
    page,
  );

  await test(
    "every page can be used by keyboard and names its controls",
    async () => {
      const dracula = bookOf((await vaultOf(anna)).vault, "Dracula");
      for (const path of ["/", `/book?id=${dracula.id}`, `/book/edit?id=${dracula.id}`, "/add", "/add/manual", "/lists", "/quotes", "/stats", "/stats/goals", "/stats/calendar", "/stats/recap", "/stats/milestones", "/friends", "/friends/requests", "/settings"]) {
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
      await page.goto(`${WEB}/friends/requests`);
      await page.getByTestId("request-card").first().waitFor();
      equal(await page.getByTestId("request-card").count(), 2, "requests after signing in again");
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
    "the link in the confirmation mail signs in, says that the address is confirmed, and no other link ends in silence",
    async () => {
      const post = (base, path, body) => fetch(`${base}${path}`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const context = await newContext();
      // This browser talks to a server on which new accounts have to confirm their address.
      await context.route(`${SERVER}/**`, (route) => route.continue({ url: route.request().url().replace(`:${SERVER_PORT}/`, `:${CONFIRM_PORT}/`) }));
      const fay = account("Fay");
      const first = await context.newPage();
      await signUp(first, fay);
      await first.getByTestId("confirm-notice").waitFor();

      // The click in the mail: Supabase confirms the address and sends the browser to the
      // address of the site itself, with a sign-in behind the "#". The stand-in hands out that address.
      const { link } = await (await post(CONFIRM_SERVER, "/auth/v1/dev/confirm", { email: fay.email, redirect_to: `${WEB}/` })).json();
      assert(link.startsWith(`${WEB}/#access_token=`) && link.endsWith("&type=signup"), `where the click in the mail leads: ${link.slice(0, 48)}`);
      const mail = await context.newPage();
      await watchForFrontPage(mail);
      await mail.goto(link);
      const notice = mail.getByTestId("confirmed-notice");
      await notice.waitFor();
      const words = await notice.innerText();
      assert(words.includes("Your e-mail address is confirmed"), `the notice says what happened: ${words}`);
      assert(words.includes("You are signed in, and this is your shelf."), "and where the reader is now");
      // The same notice has to serve somebody who signed up in the Android app and opened the mail on the phone.
      assert(words.includes("Android app") && words.includes("Go back to the app") && words.includes("“Sign in”"), "and what to do when the account was made in the app");
      await mail.getByTestId("empty-library").waitFor();
      equal(mail.url(), `${WEB}/`, "the sign-in does not stay in the address");
      equal((await frontPageSeen(mail)).shown, 0, "frames in which the front page could be seen on the way in");
      equal(await mail.getByTestId("login-form").count(), 0, "sign-in forms the confirmed reader is left in front of");
      // The name given when signing up is put into the new library.
      await untilVault(fay, (v) => v.prefs?.profileName === "Fay", "the name given at sign-up");
      deepAudit(await audit(mail), "shelf with the confirmation notice");
      await mail.waitForTimeout(500);
      await shot(mail, "confirmed");
      await mail.getByTestId("confirmed-ok").click();
      await notice.waitFor({ state: "detached" });
      await mail.reload();
      await mail.getByTestId("empty-library").waitFor();
      equal(await notice.count(), 0, "the notice after it was put away");

      // The link clicked a second time. Supabase then says it is used up. Whoever is signed in stays on their shelf and is told.
      const usedUp = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
      const again = await context.newPage();
      await again.goto(`${WEB}/${usedUp}`);
      await again.getByTestId("empty-library").waitFor();
      await again.getByText("That link was used before or is too old. You are signed in all the same.").waitFor();
      await context.close();

      // The same used-up link in a browser where nobody is signed in: the sign-in page, with words that say what to do.
      const elsewhere = await newContext();
      const stale = await elsewhere.newPage();
      await watchForFrontPage(stale);
      await stale.goto(`${WEB}/${usedUp}`);
      await stale.getByTestId("login-form").waitFor();
      equal(await stale.getByTestId("login-notice").innerText(), FRONT_LINK_FAILED, "what the sign-in page says after a stale link");
      equal((await frontPageSeen(stale)).shown, 0, "frames in which the front page could be seen on the way to the sign-in page");
      // "Sign in if the address is confirmed already": it is, so that works right there.
      await stale.getByTestId("email").fill(fay.email);
      await stale.getByTestId("password").fill(fay.password);
      await stale.getByTestId("submit").click();
      await stale.getByTestId("empty-library").waitFor();
      equal(await stale.getByTestId("confirmed-notice").count(), 0, "confirmation notices after an ordinary sign-in");
      await elsewhere.close();

      // A confirmation link whose sign-in does not take: the address is confirmed all the same, and the page says so.
      const made = (type) => `#access_token=made.up.token&expires_in=3600&refresh_token=nothing&token_type=bearer&type=${type}`;
      const cold = await newContext();
      const lost = await cold.newPage();
      await lost.goto(`${WEB}/${made("signup")}`);
      await lost.getByTestId("login-form").waitFor();
      equal(await lost.getByTestId("login-notice").innerText(), "Your e-mail address is confirmed. Sign in now, here or in the Android app.", "a confirmation without a sign-in");
      // The other kinds a mail can carry. None of them ends without a word.
      const change = await cold.newPage();
      await change.goto(`${WEB}/${made("email_change")}`);
      equal(await change.getByTestId("login-notice").innerText(), "Your new e-mail address is confirmed. Sign in with it.", "a change of address without a sign-in");
      const half = await cold.newPage();
      await half.goto(`${WEB}/#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email`);
      equal(await half.getByTestId("login-notice").innerText(), "That link was accepted. One step is left: open the link in the mail that went to your other address.", "the first half of a change of address");
      const magic = await cold.newPage();
      await magic.goto(`${WEB}/${made("magiclink")}`);
      equal(await magic.getByTestId("login-notice").innerText(), FRONT_LINK_FAILED, "a sign-in link that did not work");
      await cold.close();

      // The same kinds with a sign-in that does take, as the stand-in hands them out for Fay.
      const working = async (type) => (await (await post(SERVER, "/auth/v1/dev/recovery", { email: fay.email, redirect_to: `${WEB}/` })).json()).link.replace("type=recovery", `type=${type}`);
      const warm = await newContext();
      const signedIn = await warm.newPage();
      await signedIn.goto(await working("magiclink"));
      await signedIn.getByTestId("empty-library").waitFor();
      await signedIn.getByText("You are signed in.", { exact: true }).waitFor();
      equal(await signedIn.getByTestId("confirmed-notice").count(), 0, "confirmation notices after a plain sign-in link");
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
      await fromApp.goto(rootLink);
      await fromApp.getByTestId("new-password").waitFor();
      assert(fromApp.url().startsWith(`${WEB}/reset`) && !fromApp.url().includes("access_token"), `where the reader was taken: ${fromApp.url()}`);
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

      // A link that is too old: Supabase says so behind the "#", and the site passes it on in words.
      const stranger = await newContext();
      const stale = await stranger.newPage();
      await stale.goto(`${WEB}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
      await stale.getByTestId("login-form").waitFor();
      equal(await stale.getByTestId("login-notice").innerText(), FRONT_LINK_FAILED, "an expired link");
      equal(stale.url(), `${WEB}/login`, "where an expired link leads");
      // It is said once, not on every later visit of the sign-in page.
      await stale.goto(`${WEB}/login`);
      await stale.getByTestId("login-form").waitFor();
      equal(await stale.getByTestId("login-notice").count(), 0, "the notice about the link on a later visit");
      // And a sign-in somebody made up opens nothing.
      const forged = await stranger.newPage();
      await forged.goto(`${WEB}/#access_token=made.up.token&expires_in=3600&refresh_token=nothing&token_type=bearer&type=recovery`);
      await forged.getByTestId("login-form").waitFor();
      equal(await forged.getByTestId("login-notice").innerText(), FRONT_LINK_FAILED, "a made-up link");
      equal(await forged.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("shelfmark.auth")).length), 0, "a made-up link signs nobody in");
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
      for (const part of ["quotes", "sessions", "notes", "purchases", "goals", "ornaments", "requests"]) assert(vault[part]?.length >= 1, `at least one of ${part}`);
      assert(vault.prefs && vault.prefs.profileName === "Anna" && vault.prefs.viewMode === "SPINES", "the settings");
      const text = JSON.stringify(vault, null, 2) + "\n";
      // The app reads strictly: a null where it expects a value, or a missing field without a default, and it reads nothing.
      assert(!/\bnull\b/.test(text), "no nulls in the document");
      for (const book of vault.books) assert(typeof book.title === "string" && Number.isSafeInteger(book.id), "books have a title and a whole number as id");
      for (const request of vault.requests) for (const key of ["id", "incoming", "bookRemoteId", "bookTitle", "peerId", "peerName"]) assert(key in request, `a request has ${key}`);
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
      await rpc(yuri.session.token, "shelfmark_vault_push", { p_payload: { books: [{ id: 1, title: "Stuck", coverUrl: kept }], shelves: [], links: [], quotes: [] }, p_expected: 0 });
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
