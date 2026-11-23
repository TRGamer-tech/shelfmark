// The address of the site itself. A visitor gets the front page, which the server
// draws here. Somebody who is signed in gets their shelf in its place: Providers decides
// that in the browser, before the first paint, see lib/visitor.ts.

import type { Metadata, Viewport } from "next";
import { Landing } from "@/components/landing/Landing";
import { frontMetadata, frontViewport } from "@/components/landing/meta";
import { newestRelease } from "@/lib/release";

// Built ahead of time, and renewed every ten minutes for the version of the app it names.
export const revalidate = 600;

export const metadata: Metadata = frontMetadata("en");
export const viewport: Viewport = frontViewport;

export default async function Home() {
  return <Landing lang="en" release={await newestRelease()} />;
}
