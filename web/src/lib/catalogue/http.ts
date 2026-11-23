// The one way the catalogue clients reach the network, so they can be tested without one
// (data/remote/Http.kt).

/** Returns the body for a 2xx answer, null for "not found", and throws otherwise. */
export type HttpFetcher = (url: string, signal?: AbortSignal) => Promise<string | null>;

export const USER_AGENT = "Shelfmark/1.0 (web book catalogue)";

/** The server answered, but with an error status. */
export class HttpStatusError extends Error {
  code: number;
  constructor(code: number) {
    super(`HTTP ${code}`);
    this.name = "HttpStatusError";
    this.code = code;
  }
}

/**
 * For tests only: when SHELFMARK_CATALOGUE_GATEWAY is set, every catalogue request goes
 * to that address with the real host as the first part of the path, so recorded answers
 * can be served from one local place.
 */
export function throughGateway(url: string): string {
  const gateway = process.env.SHELFMARK_CATALOGUE_GATEWAY;
  if (!gateway) return url;
  return gateway.replace(/\/+$/, "") + "/" + url.replace(/^https?:\/\//, "");
}

async function getOnce(url: string, signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(throughGateway(url), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (response.ok) return await response.text();
  // The body is not needed, and leaving it unread would keep the connection busy.
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 404) return null;
  throw new HttpStatusError(response.status);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connection hiccups are retried a couple of times, HTTP errors are not. */
export function networkFetcher(retries = 2): HttpFetcher {
  return async (url, signal) => {
    let attempt = 0;
    for (;;) {
      try {
        return await getOnce(url, signal);
      } catch (error) {
        if (error instanceof HttpStatusError || signal?.aborted || attempt >= retries) throw error;
        attempt++;
        await wait(350 * attempt);
      }
    }
  };
}

/** Encodes a value for a query the way java.net.URLEncoder does, which is what the catalogues were tried with. */
export function enc(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
