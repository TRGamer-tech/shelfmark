// Picking the build of the app that the download link leads to.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { RELEASES_PAGE, forgetRelease, newestRelease, pickRelease, releaseListAddress, sizeLabel } from "../src/lib/release.ts";
import { fixture } from "./helpers.ts";

// What GitHub answered on the day this was written, cut down to the fields that are read.
const recorded = () => JSON.parse(fixture("github_releases.json")) as Record<string, unknown>[];

test("the newest release with an app in it is picked, pre-release or not", () => {
  const release = pickRelease(recorded());
  assert.deepEqual(release, {
    version: "1.3.0",
    file: "Shelfmark-1.3.0-debug.apk",
    size: 61412841,
    url: "https://github.com/TRGamer-tech/shelfmark/releases/download/v1.3.0/Shelfmark-1.3.0-debug.apk",
    page: "https://github.com/TRGamer-tech/shelfmark/releases/tag/v1.3.0",
    publishedAt: "2026-11-23T14:54:48Z",
  });
  // Every release in the recording is marked as a pre-release, which is why "latest" at GitHub finds none.
  assert.ok(recorded().every((entry) => entry.prerelease === true));
});

test("the order of the list is not relied on", () => {
  assert.equal(pickRelease(recorded().reverse())?.version, "1.3.0");
});

test("drafts, and releases without an app, are passed over", () => {
  const [newest, older] = recorded();
  assert.equal(pickRelease([{ ...newest, draft: true }, older])?.version, "1.2.0");
  assert.equal(pickRelease([{ ...newest, assets: [] }, older])?.version, "1.2.0");
  const notes = { name: "notes.txt", size: 10, browser_download_url: "https://github.com/TRGamer-tech/shelfmark/releases/download/v1.3.0/notes.txt" };
  assert.equal(pickRelease([{ ...newest, assets: [notes] }, older])?.version, "1.2.0");
  // Other files next to the app do not matter, whatever their order.
  assert.equal(pickRelease([{ ...newest, assets: [notes, ...(newest.assets as unknown[])] }])?.file, "Shelfmark-1.3.0-debug.apk");
});

test("only a file from the project's own releases is handed out", () => {
  const [newest, older] = recorded();
  const elsewhere = { name: "Shelfmark-9.9.9.apk", size: 5, browser_download_url: "https://example.org/Shelfmark-9.9.9.apk" };
  assert.equal(pickRelease([{ ...newest, tag_name: "v9.9.9", assets: [elsewhere] }, older])?.version, "1.2.0");
  const lookalike = { ...elsewhere, browser_download_url: "https://github.com/somebody-else/shelfmark/releases/download/v9.9.9/Shelfmark-9.9.9.apk" };
  assert.equal(pickRelease([{ ...newest, assets: [lookalike] }]), null);
  const unsafe = { ...elsewhere, browser_download_url: "http://github.com/TRGamer-tech/shelfmark/releases/download/v9.9.9/Shelfmark-9.9.9.apk" };
  assert.equal(pickRelease([{ ...newest, assets: [unsafe] }]), null);
});

test("what is no list of releases gives nothing", () => {
  assert.equal(pickRelease(null), null);
  assert.equal(pickRelease([]), null);
  assert.equal(pickRelease({ message: "API rate limit exceeded" }), null);
  assert.equal(pickRelease("<html>"), null);
  assert.equal(pickRelease([null, 5, "x", { assets: "none" }]), null);
});

test("the version comes from the tag, or failing that from the name of the file", () => {
  const [newest] = recorded();
  assert.equal(pickRelease([{ ...newest, tag_name: "release-candidate" }])?.version, "1.3.0");
  assert.equal(pickRelease([{ ...newest, tag_name: "2.0" }])?.version, "2.0");
  const odd = { name: "app.APK", size: 0, browser_download_url: "https://github.com/TRGamer-tech/shelfmark/releases/download/nightly/app.APK" };
  const release = pickRelease([{ ...newest, tag_name: "nightly", assets: [odd] }]);
  assert.equal(release?.version, "");
  assert.equal(release?.size, 0);
});

test("the size is said in megabytes", () => {
  assert.equal(sizeLabel(61412841), "61 MB");
  assert.equal(sizeLabel(61_500_000), "62 MB");
  assert.equal(sizeLabel(4_300_000), "4.3 MB");
  assert.equal(sizeLabel(0), "");
  assert.equal(sizeLabel(Number.NaN), "");
});

test("the list is asked for at GitHub unless a test answers in its place", () => {
  assert.equal(releaseListAddress(undefined), "https://api.github.com/repos/TRGamer-tech/shelfmark/releases?per_page=5");
  assert.equal(releaseListAddress(""), "https://api.github.com/repos/TRGamer-tech/shelfmark/releases?per_page=5");
  assert.equal(releaseListAddress("http://127.0.0.1:3212/api.github.com/"), "http://127.0.0.1:3212/api.github.com/repos/TRGamer-tech/shelfmark/releases?per_page=5");
});

// ---- asking, against a GitHub that is played here ----

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  forgetRelease();
});

function play(answer: () => Response | Promise<Response>): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return answer();
  }) as typeof fetch;
  return asked;
}

test("GitHub is asked once and the answer is kept for ten minutes", async () => {
  const asked = play(() => new Response(fixture("github_releases.json"), { status: 200 }));
  const t0 = 1_800_000_000_000;
  assert.equal((await newestRelease(t0))?.version, "1.3.0");
  assert.equal((await newestRelease(t0 + 9 * 60_000))?.version, "1.3.0");
  assert.equal(asked.length, 1);
  assert.ok(asked[0].endsWith("/repos/TRGamer-tech/shelfmark/releases?per_page=5"));
  await newestRelease(t0 + 11 * 60_000);
  assert.equal(asked.length, 2);
});

test("when GitHub cannot be asked there is no release, and nothing is thrown", async () => {
  play(() => {
    throw new TypeError("fetch failed");
  });
  assert.equal(await newestRelease(1), null);
  play(() => new Response('{"message":"API rate limit exceeded"}', { status: 403 }));
  assert.equal(await newestRelease(2), null);
  play(() => new Response("<html>not json</html>", { status: 200 }));
  assert.equal(await newestRelease(3), null);
  // The download then leads to the page that lists the releases.
  assert.equal(RELEASES_PAGE, "https://github.com/TRGamer-tech/shelfmark/releases");
});

test("the last good answer carries over the time GitHub does not answer", async () => {
  play(() => new Response(fixture("github_releases.json"), { status: 200 }));
  const t0 = 1_800_000_000_000;
  await newestRelease(t0);
  play(() => new Response("{}", { status: 500 }));
  assert.equal((await newestRelease(t0 + 60 * 60_000))?.version, "1.3.0");
});
