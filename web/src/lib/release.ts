// The newest build of the Android app, as the releases of the project on GitHub have it.
//
// All releases there are marked as pre-releases, and GitHub's own "latest release"
// leaves those out, so the list is asked for and the newest one that carries an app is
// picked here.

export const REPOSITORY = "https://github.com/TRGamer-tech/shelfmark";
/** Where to send people when GitHub cannot be asked: the page that lists every release. */
export const RELEASES_PAGE = `${REPOSITORY}/releases`;
/** The oldest Android the app runs on: minSdk 26 in app/build.gradle.kts. */
export const MIN_ANDROID = "8";

const DOWNLOADS = `${REPOSITORY}/releases/download/`;
const LIST_PATH = "/repos/TRGamer-tech/shelfmark/releases?per_page=5";

export interface Release {
  /** "1.3.0" */
  version: string;
  /** Name of the file, e.g. "Shelfmark-1.3.0-debug.apk". */
  file: string;
  /** Size of the file in bytes. Zero when GitHub did not say. */
  size: number;
  /** Where the file is fetched from. */
  url: string;
  /** The page of the release, with its notes. */
  page: string;
  /** When it was published, as GitHub writes it ("2026-11-23T14:54:48Z"), or "". */
  publishedAt: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function versionOf(tag: string, file: string): string {
  const fromTag = /^v?(\d+(?:\.\d+)+)/.exec(tag.trim());
  if (fromTag) return fromTag[1];
  return /(\d+(?:\.\d+)+)/.exec(file)?.[1] ?? "";
}

/**
 * Picks the newest release that is not a draft and carries an .apk. Null when the answer
 * is no list of releases, or none of them has an app in it.
 *
 * Only a file from the project's own releases is accepted. This address ends up in a
 * redirect, and whatever answers in GitHub's place must not be able to send people elsewhere.
 */
export function pickRelease(answer: unknown): Release | null {
  if (!Array.isArray(answer)) return null;
  const found: Release[] = [];
  for (const entry of answer) {
    const release = record(entry);
    if (!release || release.draft === true || !Array.isArray(release.assets)) continue;
    for (const item of release.assets) {
      const asset = record(item);
      const file = text(asset?.name);
      const url = text(asset?.browser_download_url);
      if (!asset || !file.toLowerCase().endsWith(".apk") || !url.startsWith(DOWNLOADS)) continue;
      const page = text(release.html_url);
      found.push({
        version: versionOf(text(release.tag_name), file),
        file,
        size: typeof asset.size === "number" && asset.size > 0 ? asset.size : 0,
        url,
        page: page.startsWith(`${REPOSITORY}/`) ? page : RELEASES_PAGE,
        publishedAt: text(release.published_at) || text(release.created_at),
      });
      break;
    }
  }
  if (found.length === 0) return null;
  // GitHub lists the newest first. Sorting by the date as well does not rely on that.
  const time = (release: Release) => Date.parse(release.publishedAt) || 0;
  return found.reduce((newest, release) => (time(release) > time(newest) ? release : newest));
}

/** "61 MB", in the megabytes a phone shows for a download. Empty when the size is not known. */
export function sizeLabel(bytes: number): string {
  if (!(bytes > 0)) return "";
  const megabytes = bytes / 1_000_000;
  return megabytes >= 10 ? `${Math.round(megabytes)} MB` : `${megabytes.toFixed(1)} MB`;
}

/** The address of the list of releases. The base can be changed so that a test can answer in GitHub's place. */
export function releaseListAddress(base: string | undefined): string {
  const root = (base ?? "").trim().replace(/\/+$/, "") || "https://api.github.com";
  return root + LIST_PATH;
}

// What was learned last, kept for as long as this server process lives. It carries the
// site over the minutes in which GitHub does not answer or has had enough of being asked.
let remembered: { at: number; release: Release } | null = null;
const FRESH_MS = 10 * 60_000;

/**
 * Asks GitHub for the newest release. Never throws: when GitHub cannot be asked, the
 * last good answer is given, and null when there never was one. The page then speaks
 * without a version number and the download leads to the list of releases.
 */
export async function newestRelease(now: number = Date.now()): Promise<Release | null> {
  if (remembered && now - remembered.at < FRESH_MS) return remembered.release;
  try {
    const response = await fetch(releaseListAddress(process.env.SHELFMARK_GITHUB_API), {
      headers: { Accept: "application/vnd.github+json" },
      // The page that shows the version is built ahead of time and renewed at this pace.
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    } as RequestInit);
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = pickRelease(await response.json());
    if (release) remembered = { at: now, release };
    return release ?? remembered?.release ?? null;
  } catch {
    return remembered?.release ?? null;
  }
}

/** For tests: forget what was learned. */
export function forgetRelease(): void {
  remembered = null;
}
