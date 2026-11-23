"use client";

// Every quote of the library (ui/quotes/QuotesScreen.kt).

import Link from "next/link";
import { useState } from "react";
import { QuoteDialog } from "@/components/BookDialogs";
import { useI18n } from "@/components/i18n";
import { useLibrary } from "@/components/library";
import { Button, Card, EmptyHint, PageHead } from "@/components/ui";
import { sortBooks } from "@/lib/libraryLogic";
import type { Quote } from "@/lib/model";

export default function QuotesPage() {
  const { t } = useI18n();
  const { vault } = useLibrary();
  const [editing, setEditing] = useState<Quote | "new" | null>(null);
  const [query, setQuery] = useState("");
  const byId = new Map(vault.books.map((b) => [b.id, b]));
  const words = query
    .toLowerCase()
    .split(" ")
    .filter((w) => w.trim() !== "");
  const quotes = vault.quotes
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
    .filter((quote) => {
      const book = byId.get(quote.bookId);
      const hay = `${quote.text} ${quote.note} ${book?.title ?? ""} ${book?.authors ?? ""}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    });

  return (
    <div className="page" data-testid="quotes-page">
      <PageHead title={t("tab_quotes")}>
        <Button icon="add" onClick={() => setEditing("new")} disabled={vault.books.length === 0} title={vault.books.length === 0 ? t("quote_no_books") : undefined} data-testid="add-quote">
          {t("quote_add")}
        </Button>
      </PageHead>
      {vault.quotes.length > 0 ? (
        <div className="field">
          <label htmlFor="quote-search" className="sr-only">
            {t("quote_search_hint")}
          </label>
          <input id="quote-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("quote_search_hint")} data-testid="quote-search" />
        </div>
      ) : null}
      {vault.quotes.length === 0 ? <EmptyHint>{vault.books.length === 0 ? t("quote_no_books") : t("quote_empty")}</EmptyHint> : null}
      {vault.quotes.length > 0 && quotes.length === 0 ? <EmptyHint>{t("search_nothing")}</EmptyHint> : null}
      {quotes.map((quote) => {
        const book = byId.get(quote.bookId);
        return (
          <Card key={quote.id} testId="quote-card">
            <button type="button" className="entry-button" onClick={() => setEditing(quote)} aria-label={`${t("quote_edit")}: ${quote.text.slice(0, 60)}`}>
              <span className="quote-text" style={{ display: "block" }}>
                {"„" + quote.text + "“"}
              </span>
              {quote.note.trim() !== "" ? <span style={{ display: "block", marginTop: 4 }}>{quote.note}</span> : null}
            </button>
            {book ? (
              <p className="small" style={{ marginTop: 8 }}>
                <Link href={`/book?id=${book.id}`}>{book.title}</Link>
                <span className="muted">
                  {[book.authors, quote.page > 0 ? t("quote_page", quote.page) : ""]
                    .filter((part) => part.trim() !== "")
                    .map((part) => ` · ${part}`)
                    .join("")}
                </span>
              </p>
            ) : null}
          </Card>
        );
      })}
      {editing ? <QuoteDialog quote={editing === "new" ? null : editing} books={sortBooks(vault.books, "TITLE")} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
