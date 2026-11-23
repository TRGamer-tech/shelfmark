// The way to the imprint and the privacy notice, as every page before the sign-in
// carries it at its foot. Plain links: those two pages are drawn by the server and stand
// outside the library, so they are opened like any other page of the web.

import type { Lang } from "@/i18n/index";
import { translate } from "@/i18n/index";
import { LEGAL_PATHS } from "@/lib/legal";

export function LegalLinks({ lang }: { lang: Lang }) {
  return (
    <>
      <a href={LEGAL_PATHS[lang].imprint} data-testid="link-imprint">
        {translate(lang, "web_imprint")}
      </a>
      <a href={LEGAL_PATHS[lang].privacy} data-testid="link-privacy">
        {translate(lang, "web_privacy")}
      </a>
    </>
  );
}
