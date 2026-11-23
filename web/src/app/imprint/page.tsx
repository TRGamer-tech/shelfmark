// The imprint, in English. The German one is at /de/impressum.

import type { Metadata, Viewport } from "next";
import { frontViewport } from "@/components/landing/meta";
import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";

export const metadata: Metadata = legalMetadata("en", "imprint");
export const viewport: Viewport = frontViewport;

export default function Page() {
  return <LegalPage lang="en" kind="imprint" />;
}
