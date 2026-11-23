// Helpers of the end to end tests: the servers they need, pictures to upload, and a
// very small test harness.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
export const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url));
export const OUTPUT = fileURLToPath(new URL("./output/", import.meta.url));
export const FIXTURES = fileURLToPath(new URL("../test/fixtures/", import.meta.url));

export const KEY = "sb_publishable_local_development";
export const SERVER_PORT = 54340;
export const CONFIRM_PORT = 54341;
export const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
export const CONFIRM_SERVER = `http://127.0.0.1:${CONFIRM_PORT}`;
export const WEB_PORT = 3210;
export const PLAIN_PORT = 3211;
export const GATEWAY_PORT = 3212;
export const WEB = `http://127.0.0.1:${WEB_PORT}`;
export const PLAIN = `http://127.0.0.1:${PLAIN_PORT}`;

mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUTPUT, { recursive: true });

/** Playwright is installed once for the whole machine, not as a dependency of this project. */
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    throw new Error("Playwright was not found. Install it once for this machine (npm install -g playwright) and make sure NODE_PATH points at the global modules.");
  }
}

const children = [];

export function stopAll() {
  for (const child of children) {
    try {
      // The whole group: "npx next start" is two processes.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

function start(command, args, options, name) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  child.stdout.on("data", (chunk) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk) => log.push(chunk.toString()));
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && code !== 143) console.error(`[${name}] stopped with code ${code}\n${log.join("").slice(-2000)}`);
  });
  children.push(child);
  return { child, log };
}

async function answers(url, options) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(check, what, seconds = 60) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${what} did not come up within ${seconds} seconds`);
}

const ping = (base) => answers(`${base}/rest/v1/rpc/shelfmark_ping`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: "{}" });

/** The stand-in for Supabase, once as it is and once in the mode where new accounts confirm their address. */
export async function startStandIn() {
  const script = fileURLToPath(new URL("../../supabase/dev_server.py", import.meta.url));
  const dsn = process.env.SHELFMARK_E2E_DSN ?? "host=127.0.0.1 port=54329 user=postgres dbname=shelfmark_web";
  for (const [port, base, extra] of [
    [SERVER_PORT, SERVER, []],
    [CONFIRM_PORT, CONFIRM_SERVER, ["--confirm-email"]],
  ]) {
    if (await ping(base)) continue;
    if (!existsSync(script)) throw new Error(`Nothing answers on ${base} and supabase/dev_server.py is not here to start it. See web/README.md.`);
    start("python3", [script, "--dsn", dsn, "--port", String(port), ...extra], {}, `stand-in ${port}`);
    await waitFor(() => ping(base), `The stand-in server on port ${port}`, 20);
  }
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: WEB_DIR, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(" ")} failed:\n${output.slice(-4000)}`))));
  });
}

const NO_SERVER = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
const WITH_SERVER = { ...NO_SERVER, NEXT_PUBLIC_SUPABASE_URL: SERVER, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY };
const QUIET = { NEXT_TELEMETRY_DISABLED: "1" };

/** Builds the site twice: once pointed at the stand-in server, once with no server at all. */
export async function buildSites() {
  await run("npx", ["next", "build"], { ...QUIET, ...WITH_SERVER, SHELFMARK_DIST_DIR: ".next-e2e" });
  await run("npx", ["next", "build"], { ...QUIET, ...NO_SERVER, SHELFMARK_DIST_DIR: ".next-plain" });
}

export async function startSites() {
  for (const [port, base, dist, env] of [
    [WEB_PORT, WEB, ".next-e2e", { ...WITH_SERVER, SHELFMARK_CATALOGUE_GATEWAY: `http://127.0.0.1:${GATEWAY_PORT}` }],
    [PLAIN_PORT, PLAIN, ".next-plain", NO_SERVER],
  ]) {
    if (!existsSync(`${WEB_DIR}/${dist}/BUILD_ID`)) throw new Error(`${dist} is not built. Run the tests without --no-build first.`);
    if (await answers(base)) throw new Error(`Port ${port} is taken. Stop whatever runs there and try again.`);
    start("npx", ["next", "start", "-p", String(port)], { cwd: WEB_DIR, env: { ...process.env, ...QUIET, ...env, SHELFMARK_DIST_DIR: dist } }, `site ${port}`);
    await waitFor(() => answers(base), `The site on port ${port}`, 60);
  }
}

// ---- pictures ----

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A PNG of the given size: a cloth coloured cover with a lighter band and some grain, so it does not compress to nothing. */
export function png(width, height, [r, g, b] = [36, 92, 110]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = 12345;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    const band = y > height * 0.2 && y < height * 0.3;
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const grain = (seed >> 16) % 14;
      const at = row + 1 + x * 3;
      raw[at] = Math.min(255, (band ? r + 110 : r) + grain);
      raw[at + 1] = Math.min(255, (band ? g + 90 : g) + grain);
      raw[at + 2] = Math.min(255, (band ? b + 70 : b) + grain);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Width and height of a JPEG, read from its frame header. Null for anything that is not a JPEG. */
export function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < buffer.length) {
    if (buffer[at] !== 0xff) return null;
    const marker = buffer[at + 1];
    const length = buffer.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(at + 5), width: buffer.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

export const COVER_PNG = png(200, 300);

// ---- the catalogues, served from recorded answers ----

const fixture = (name) => readFileSync(`${FIXTURES}${name}`);

/**
 * Stands in for the seven catalogues. The site is started with SHELFMARK_CATALOGUE_GATEWAY
 * pointing here, so every catalogue request arrives as /<host>/<path> and is answered
 * with what the real service once said. The German National Library is "down", which
 * it is from many networks, and must not stop the others.
 */
export function startGateway() {
  const seen = [];
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    seen.push(url);
    const send = (status, type, body) => {
      response.writeHead(status, { "Content-Type": type, "Content-Length": body.length });
      response.end(body);
    };
    const json = (name) => send(200, "application/json", fixture(name));
    const xml = (name) => send(200, "application/xml", fixture(name));
    if (url.startsWith("/openlibrary.org/search.json")) return json("ol_search.json");
    if (url.startsWith("/openlibrary.org/api/books")) return json("ol_data.json");
    if (url.startsWith("/openlibrary.org/isbn/")) return json("ol_isbn.json");
    if (url.startsWith("/openlibrary.org/works/")) return json("ol_work.json");
    if (url.startsWith("/www.googleapis.com/")) return json("google_volumes.json");
    if (url.startsWith("/itunes.apple.com/")) return json("itunes_search.json");
    if (url.startsWith("/lobid.org/")) return json(url.includes("isbn") ? "lobid_isbn.json" : "lobid_search.json");
    if (url.startsWith("/sru.k10plus.de/")) return xml("k10plus_isbn.xml");
    if (url.startsWith("/swisscovery.slsp.ch/")) return xml("swisscovery_isbn.xml");
    if (url.startsWith("/services.dnb.de/")) return send(503, "text/plain", Buffer.from("down"));
    if (url.startsWith("/covers.openlibrary.org/")) return send(200, "image/png", COVER_PNG);
    return send(404, "text/plain", Buffer.from("not found"));
  });
  return new Promise((resolve) => server.listen(GATEWAY_PORT, "127.0.0.1", () => resolve({ seen, close: () => server.close() })));
}

// ---- talking to the stand-in server directly, to see what it really holds ----

export async function signIn(email, password, base = SERVER) {
  const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Signing in as ${email} failed: ${response.status} ${await response.text()}`);
  const session = await response.json();
  return { token: session.access_token, id: session.user.id };
}

export async function rpc(token, name, args = {}) {
  const response = await fetch(`${SERVER}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
  return body;
}

/** The library as the server holds it right now. */
export async function vaultOf(account) {
  account.session ??= await signIn(account.email, account.password);
  const answer = await rpc(account.session.token, "shelfmark_vault_pull", { p_known: 0 });
  return { revision: answer.revision, vault: answer.payload ?? { books: [], shelves: [], links: [], quotes: [] } };
}

/** Waits until the library on the server looks the way the test expects, and returns it. */
export async function untilVault(account, check, what, seconds = 12) {
  const until = Date.now() + seconds * 1000;
  let last;
  for (;;) {
    last = await vaultOf(account);
    try {
      if (check(last.vault)) return last.vault;
    } catch {
      // The part that is looked at is not there yet.
    }
    if (Date.now() > until) throw new Error(`The library on the server never showed: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// ---- a very small test harness ----

export const results = [];

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Runs one test. A failure is noted, a picture of the page is kept, and the next test
 * still runs, so that one broken thing does not hide the state of all the others.
 */
export async function test(name, body, page) {
  const started = Date.now();
  try {
    await body();
    results.push({ name, ok: true });
    console.log(`  ok    ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.stack ?? error) });
    console.log(`  FAIL  ${name}\n        ${String(error?.message ?? error).split("\n").join("\n        ")}`);
    const target = typeof page === "function" ? page() : page;
    if (target) await target.screenshot({ path: `${OUTPUT}failed-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png` }).catch(() => undefined);
  }
}
