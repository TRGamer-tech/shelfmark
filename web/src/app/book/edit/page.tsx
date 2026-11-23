"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookForm } from "@/components/BookForm";
import { useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { EmptyHint } from "@/components/ui";

export default function EditBookPage() {
  const { t } = useI18n();
  const { vault } = useLibrary();
  const router = useRouter();
  const id = Number(useSearchParams().get("id"));
  const book = vault.books.find((b) => b.id === id);
  if (!book) {
    return (
      <div className="page">
        <EmptyHint>{t("web_book_missing")}</EmptyHint>
        <Link href="/" className="btn btn-text">
          {t("web_to_shelf")}
        </Link>
      </div>
    );
  }
  // The form starts from the book as it is now and is not disturbed while it is being filled in.
  return <BookForm key={book.id} initial={book} isNew={false} backHref={`/book?id=${book.id}`} onSaved={(saved) => router.push(`/book?id=${saved}`)} />;
}
