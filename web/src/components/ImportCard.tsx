"use client";

// Bringing books over from other apps: choose a CSV file, see what was found, import.
// The reading of the file is src/lib/csvImport.ts, a port of the app's importer.

import { useMemo, useRef, useState } from "react";
import type { ImportPlan } from "@/lib/csvImport";
import { applyImport, importIdsFor, previewImport } from "@/lib/csvImport";
import { newId } from "@/lib/ids";
import type { Book } from "@/lib/model";
import { booksWithoutCover, importBooks } from "@/lib/mutations";
import { useCoverJob } from "./coverJob";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";
import { Button, Card, Dialog } from "./ui";

/** The card in the settings: the two buttons, and what went wrong with a file. */
export function ImportCard({ problem, onFile }: { problem: string | null; onFile: (file: File | undefined) => void }) {
  const { t } = useI18n();
  const { progress, start } = useCoverJob();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <Card title={t("settings_import")} testId="import-card">
      <p className="muted">{t("settings_import_text")}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <Button variant="outline" icon="upload" onClick={() => fileInput.current?.click()} data-testid="import-csv">
          {t("settings_import_button")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          hidden
          onChange={(event) => {
            onFile(event.target.files?.[0]);
            // The same file can be chosen again, which a remembered choice would not report.
            event.target.value = "";
          }}
          data-testid="import-file"
        />
        <Button variant="outline" icon="search" disabled={progress !== null} onClick={start} data-testid="find-covers">
          {progress ? t("cover_finding", progress[0], progress[1]) : t("cover_find_missing")}
        </Button>
      </div>
      {problem ? (
        <p className="problem" role="alert" data-testid="import-problem">
          {problem}
        </p>
      ) : null}
    </Card>
  );
}

function Titles({ books }: { books: Book[] }) {
  return (
    <ul className="import-titles">
      {books.map((book, index) => (
        <li key={index}>
          <span className="strong">{book.title}</span>
          {book.authors.trim() !== "" ? <span className="muted">{` · ${book.authors}`}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A count that opens into the list of what it counts. Nothing to open when it counts nothing. */
function Counted({ text, books, testId }: { text: string; books: Book[]; testId: string }) {
  if (books.length === 0) return <p data-testid={testId}>{text}</p>;
  return (
    <details className="import-group" data-testid={testId}>
      <summary>{text}</summary>
      <Titles books={books} />
    </details>
  );
}

/**
 * What follows choosing a file: the preview of what was found, and after the import what
 * came of it. Nothing is saved before the reader says so.
 */
export function ImportFlow({ plan, onClose }: { plan: ImportPlan | null; onClose: () => void }) {
  const { t, plural } = useI18n();
  const { vault, mutate } = useLibrary();
  const { start, progress } = useCoverJob();
  const [done, setDone] = useState<{ added: number; completed: number } | null>(null);
  // Once the import is done there is nothing left to preview, whatever the library does meanwhile.
  const preview = useMemo(() => (plan && !done ? previewImport(vault, plan) : null), [plan, vault, done]);

  if (done) {
    const close = () => {
      setDone(null);
      onClose();
    };
    const missing = booksWithoutCover(vault).length > 0;
    return (
      <Dialog
        title={t("import_books_done")}
        onClose={close}
        testId="import-done-dialog"
        actions={
          <>
            <Button variant="text" onClick={close} data-testid="import-done-close">
              {t("action_close")}
            </Button>
            {missing ? (
              <Button
                disabled={progress !== null}
                onClick={() => {
                  start();
                  close();
                }}
                data-testid="import-find-covers"
              >
                {t("cover_find_missing")}
              </Button>
            ) : null}
          </>
        }
      >
        <p data-testid="import-added">{plural("import_added", done.added)}</p>
        <p data-testid="import-completed">{plural("import_completed", done.completed)}</p>
        {missing ? <p className="muted">{t("import_books_covers")}</p> : null}
      </Dialog>
    );
  }

  if (!plan || !preview) return null;

  const confirm = () => {
    const now = Date.now();
    // The ids are made here, before the change exists, so that the change is the same
    // however often it has to be applied.
    const ids = importIdsFor(plan, () => newId(now));
    const outcome = applyImport(vault, plan, ids, now);
    // Everything in one change, and so in one save. A file that brings nothing new saves nothing.
    if (outcome.vault !== vault) void mutate(importBooks(plan, ids, now));
    setDone({ added: outcome.added.length, completed: outcome.completed });
  };

  return (
    <Dialog
      title={t("import_books_title", plan.source)}
      onClose={onClose}
      wide
      testId="import-dialog"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("action_cancel")}
          </Button>
          <Button onClick={confirm} data-testid="import-confirm">
            {t("import_books_confirm")}
          </Button>
        </>
      }
    >
      <p className="strong" data-testid="import-found">
        {plural("web_import_found", plan.books.length)}
      </p>
      <Counted text={plural("import_new_books", preview.added.length)} books={preview.added} testId="import-new" />
      <Counted text={plural("import_known_books", preview.known.length)} books={preview.known} testId="import-known" />
      {preview.newLists.length > 0 ? <p data-testid="import-lists">{t("web_import_new_lists", preview.newLists.join(", "))}</p> : null}
      <p className="small muted" data-testid="import-columns">
        {t("web_import_columns", plan.columns.join(", "))}
      </p>
      {plan.ignored.length > 0 ? (
        <p className="small muted" data-testid="import-ignored">
          {t("web_import_ignored", plan.ignored.join(", "))}
        </p>
      ) : null}
    </Dialog>
  );
}
