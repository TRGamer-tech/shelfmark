"use client";

// The page for an address that leads nowhere. It keeps to the subject: the books on its
// shelf spell out what happened to the page.

import { FrontDesk } from "@/components/FrontDesk";
import { useI18n } from "@/components/i18n";
import { Scaled } from "@/components/landing/Scaled";
import { SpineShelf } from "@/components/Shelves";

export default function NotFound() {
  const { t } = useI18n();
  // One word to a spine. Read along the shelf they make the sentence.
  const words = t("web_missing_spines").split(" ");
  const items = words.map((word, index) => ({ key: index, title: word, authors: "", cover: null, pageCount: 380 + ((index * 170) % 420), format: index % 3 === 0 ? "HARDCOVER" : "PAPERBACK" }));
  return (
    <FrontDesk testId="not-found">
      <h1>{t("web_missing_title")}</h1>
      <div className="missing-shelf" role="img" aria-label={t("web_missing_spines")}>
        <Scaled>
          <SpineShelf sections={[{ key: "missing", items }]} lively={false} />
        </Scaled>
      </div>
      <p>{t("web_page_missing")}</p>
      <div className="desk-links">
        {/* A plain link: whoever is signed in finds their shelf at this address, everybody else the front page. */}
        <a className="front-button" href="/">
          {t("web_missing_home")}
        </a>
      </div>
    </FrontDesk>
  );
}
