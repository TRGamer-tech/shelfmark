// Looks one book up by its ISBN in every catalogue and merges what they know.

import { cleanLang, countryOf, makeLookup } from "@/lib/catalogue/index";
import { CataloguesFailed } from "@/lib/catalogue/lookup";
import * as Isbn from "@/lib/isbn";

export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ isbn: string }> }): Promise<Response> {
  const { isbn: raw } = await context.params;
  const isbn = Isbn.to13(raw);
  if (!isbn) return Response.json({ book: null, error: "not_an_isbn" }, { status: 400 });
  const url = new URL(request.url);
  try {
    const lookup = makeLookup(countryOf(request.headers.get("accept-language")));
    const book = await lookup.byIsbn(isbn, cleanLang(url.searchParams.get("lang")));
    if (!book) return Response.json({ book: null, error: "not_found" }, { status: 404 });
    return Response.json({ book }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (error) {
    if (error instanceof CataloguesFailed) return Response.json({ book: null, error: "catalogues_unreachable" }, { status: 502 });
    return Response.json({ book: null, error: "failed" }, { status: 500 });
  }
}
