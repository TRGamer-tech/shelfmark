// Book search. The catalogues do not allow calls from a browser, so the website asks
// them from here: all of them at once, merged and ranked (lib/catalogue/lookup.ts).

import { cleanLang, countryOf, makeLookup } from "@/lib/catalogue/index";
import { CataloguesFailed } from "@/lib/catalogue/lookup";

export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  // While the reader is still typing only the quick catalogues are asked.
  const partial = url.searchParams.get("partial") === "1";
  const wanted = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(wanted) && wanted > 0 ? Math.min(40, Math.floor(wanted)) : partial ? 8 : 30;
  if (query === "") return Response.json({ results: [] });
  try {
    const lookup = makeLookup(countryOf(request.headers.get("accept-language")));
    const results = await lookup.search(query, limit, cleanLang(url.searchParams.get("lang")), partial);
    return Response.json({ results }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    if (error instanceof CataloguesFailed) return Response.json({ results: [], error: "catalogues_unreachable" }, { status: 502 });
    return Response.json({ results: [], error: "failed" }, { status: 500 });
  }
}
