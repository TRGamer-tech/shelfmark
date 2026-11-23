// The front page in German. Every language has an address of its own, so that each can
// be read without scripts, found by a search engine and linked to.

import type { Metadata, Viewport } from "next";
import { Landing } from "@/components/landing/Landing";
import { frontMetadata, frontViewport } from "@/components/landing/meta";
import { newestRelease } from "@/lib/release";

export const revalidate = 600;

export const metadata: Metadata = frontMetadata("de");
export const viewport: Viewport = frontViewport;

export default async function HomeDe() {
  return <Landing lang="de" release={await newestRelease()} />;
}
