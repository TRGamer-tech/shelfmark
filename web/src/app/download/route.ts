// The download link of the app. It leads to the newest .apk of the project's releases
// on GitHub, and to the list of releases when GitHub cannot be asked.

import { NextResponse } from "next/server";
import { RELEASES_PAGE, newestRelease } from "@/lib/release";

// Asked on every visit. What GitHub said is remembered for ten minutes inside newestRelease.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const release = await newestRelease();
  const response = NextResponse.redirect(release?.url ?? RELEASES_PAGE, 302);
  // A browser must not hold on to yesterday's answer: the next version has another address.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
