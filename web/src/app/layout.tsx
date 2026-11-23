import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { siteAddress } from "@/components/landing/meta";
import { THEME_SCRIPT } from "@/components/theme";
import { VISITOR_SCRIPT } from "@/lib/visitor";
import "./globals.css";
import "./front.css";

export const metadata: Metadata = {
  metadataBase: siteAddress(),
  title: "Shelfmark",
  description: "Your books, your shelves, your quotes. A personal library and reading tracker.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f1ea",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The language, the colours and who is at the door are settled in the browser, which
    // knows the reader. The server cannot. Two small scripts do it before the first paint.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/playfair_bold.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/lato_regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: VISITOR_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
