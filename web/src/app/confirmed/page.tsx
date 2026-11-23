// Where the link of a confirmation mail leads. The page itself is drawn in the browser,
// which is the only place that knows what the link said and who is signed in.

import type { Metadata, Viewport } from "next";
import { Confirmed } from "@/components/Confirmed";
import { frontViewport } from "@/components/landing/meta";

// Nothing a search engine should list: the page only means something to whoever just clicked a link.
export const metadata: Metadata = { title: "Shelfmark", robots: { index: false, follow: false } };
export const viewport: Viewport = frontViewport;

export default function ConfirmedPage() {
  return <Confirmed />;
}
