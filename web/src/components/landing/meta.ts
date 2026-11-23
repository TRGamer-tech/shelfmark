// What the front page says about itself to browsers, search engines and whoever
// shows a preview of a link.

import type { Metadata, Viewport } from "next";
import type { Lang } from "@/i18n/index";
import { LANDING } from "@/i18n/landing";

/**
 * The address of the site, when it is known at build time. Vercel says it by itself.
 * It only makes the addresses in the preview data complete: without it they stay
 * relative, which browsers cope with and some preview services do not.
 */
export function siteAddress(): URL | undefined {
  const given = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "";
  if (given.trim() === "") return undefined;
  try {
    return new URL(/^https?:\/\//.test(given) ? given : `https://${given}`);
  } catch {
    return undefined;
  }
}

export function frontMetadata(lang: Lang): Metadata {
  const { meta } = LANDING[lang];
  const path = lang === "de" ? "/de" : "/";
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: path, languages: { en: "/", de: "/de", "x-default": "/" } },
    openGraph: {
      type: "website",
      siteName: "Shelfmark",
      title: meta.title,
      description: meta.description,
      url: path,
      locale: lang === "de" ? "de_CH" : "en_GB",
      alternateLocale: lang === "de" ? ["en_GB"] : ["de_CH"],
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description },
  };
}

/** The colour of the browser's own frame on a phone: the dark wood of the front page. */
export const frontViewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2a1d17" };
