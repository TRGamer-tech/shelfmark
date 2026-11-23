// The imprint, in German. The English one is at /imprint.

import type { Metadata, Viewport } from "next";
import { frontViewport } from "@/components/landing/meta";
import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";

export const metadata: Metadata = legalMetadata("de", "imprint");
export const viewport: Viewport = frontViewport;

export default function Page() {
  return <LegalPage lang="de" kind="imprint" />;
}
