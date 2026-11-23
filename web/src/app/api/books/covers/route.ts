// Cover pictures a book could have: from cover services that answer by ISBN, and from
// the catalogues (lib/catalogue/coverFinder.ts).

import { cleanLang, countryOf, makeCoverFinder } from "@/lib/catalogue/index";
import * as Isbn from "@/lib/isbn";

export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const title = (url.searchParams.get("title") ?? "").trim().slice(0, 200);
  const authors = (url.searchParams.get("authors") ?? "").trim().slice(0, 200);
  const isbn = Isbn.to13(url.searchParams.get("isbn") ?? "") ?? "";
  if (title === "" && isbn === "") return Response.json({ covers: [] });
  try {
    const finder = makeCoverFinder(countryOf(request.headers.get("accept-language")));
    const covers = await finder.candidates(title, authors, isbn, cleanLang(url.searchParams.get("lang")));
    return Response.json({ covers }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    // Nothing found is an answer too. The reader can still upload a picture.
    return Response.json({ covers: [] });
  }
}
