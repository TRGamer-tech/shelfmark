"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="plain-page">
      <h1>Shelfmark</h1>
      <p>{t("web_page_missing")}</p>
      <Link href="/" className="btn btn-outline">
        {t("web_to_shelf")}
      </Link>
    </div>
  );
}
