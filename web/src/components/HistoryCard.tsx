"use client";

// The earlier versions of the library that the server keeps (lib/history.ts), in the
// settings next to the backup: which there are, and a way to bring one back.

import { useCallback, useEffect, useState } from "react";
import { formatMoment } from "@/lib/dates";
import type { VaultVersion } from "@/lib/history";
import { restoreProblemKey } from "@/lib/history";
import { serverProblemKey } from "@/lib/supabase/errors";
import { reasonOf } from "@/lib/sync";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";
import { useLibrary } from "./library";
import { Button, Card, ConfirmDialog } from "./ui";

export function HistoryCard() {
  const { t, plural, locale } = useI18n();
  const { api } = useAuth();
  const { restoreVersion, notify, revision } = useLibrary();
  // Null until the server has answered.
  const [versions, setVersions] = useState<VaultVersion[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<VaultVersion | null>(null);
  const [busy, setBusy] = useState(false);

  const why = useCallback(
    (reason: string) => t(restoreProblemKey(reason) ?? serverProblemKey(reason), reason),
    [t],
  );

  const load = useCallback(async () => {
    try {
      setVersions(await api.history());
      setUnavailable(false);
    } catch (error) {
      const reason = reasonOf(error);
      // A server from before this has no list to give. That is said once, in place of the list.
      if (reason === "setup") setUnavailable(true);
      else setProblem(why(reason));
      setVersions([]);
    }
  }, [api, why]);

  // Asked again after every save: that is when the server may have kept another version.
  useEffect(() => {
    void load();
  }, [load, revision]);

  const when = (version: VaultVersion) => formatMoment(version.at, locale, true);

  const bringBack = async (version: VaultVersion) => {
    setAsking(null);
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await restoreVersion(version.revision);
      notify(t("history_restored", when(version)));
    } catch (error) {
      setProblem(why(reasonOf(error)));
    } finally {
      setBusy(false);
      void load();
    }
  };

  return (
    <Card title={t("history_title")} testId="history-card">
      <p className="muted">{t("history_text")}</p>
      {unavailable ? (
        <p className="small muted" style={{ marginTop: 10 }} data-testid="history-unavailable">
          {t("history_unavailable")}
        </p>
      ) : versions === null ? null : versions.length === 0 && !problem ? (
        <p className="small muted" style={{ marginTop: 10 }} data-testid="history-empty">
          {t("history_empty")}
        </p>
      ) : (
        <ul className="version-list" data-testid="history-list">
          {versions.map((version) => (
            <li key={version.revision} className="version-row" data-testid="version" data-revision={version.revision} data-books={version.books}>
              <span>
                <span className="strong" style={{ display: "block" }}>
                  {when(version)}
                </span>
                <span className="small muted">{plural("book_count", version.books)}</span>
              </span>
              <Button variant="outline" disabled={busy} onClick={() => setAsking(version)} aria-label={`${t("history_restore")}: ${when(version)}`} data-testid="version-restore">
                {t("history_restore")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {problem ? (
        <p className="problem" role="alert" data-testid="history-problem">
          {problem}
        </p>
      ) : null}
      {asking ? (
        <ConfirmDialog
          title={t("history_restore_title", when(asking))}
          text={t("history_restore_text")}
          confirm={t("history_restore")}
          testId="history-restore-dialog"
          onClose={() => setAsking(null)}
          onConfirm={() => void bringBack(asking)}
        />
      ) : null}
    </Card>
  );
}
