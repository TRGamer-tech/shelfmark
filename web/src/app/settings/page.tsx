"use client";

// Settings: language, theme, the lively shelf, reading speed, backup and the account.

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth";
import { AutoSaveField } from "@/components/AutoSave";
import { useI18n } from "@/components/i18n";
import { ImportCard, ImportFlow } from "@/components/ImportCard";
import { LegalLinks } from "@/components/LegalLinks";
import { useLibrary } from "@/components/library";
import { ThemeEditor } from "@/components/ThemeEditor";
import { Button, Card, Chip, ConfirmDialog, Dialog, IconButton, PageHead, Switch } from "@/components/ui";
import { LANGS } from "@/i18n/index";
import type { ImportPlan } from "@/lib/csvImport";
import { decodeText, isZip, parseImport } from "@/lib/csvImport";
import { toIsoDate, today } from "@/lib/dates";
import type { CustomTheme, Vault } from "@/lib/model";
import { CUSTOM_THEME_PREFIX, ENVELOPE_VERSION, THEME_SYSTEM, looksLikeVault, makeEnvelope, readVault, writeEnvelope } from "@/lib/model";
import { deleteCustomTheme, restoreBackup, saveCustomTheme, setPrefs } from "@/lib/mutations";
import { removeCovers } from "@/lib/supabase/covers";
import { serverProblemKey } from "@/lib/supabase/errors";
import { reasonOf } from "@/lib/sync";
import type { ThemePreset } from "@/lib/theme";
import { THEME_PRESETS, cssOf, presetOfCustom } from "@/lib/theme";

function Swatch({ preset, selected, onPick, label, testId }: { preset: ThemePreset | null; selected: boolean; onPick: () => void; label: string; testId: string }) {
  return (
    <button type="button" className="theme-swatch" aria-pressed={selected} onClick={onPick} data-testid={testId}>
      {preset ? (
        <span className="theme-preview" style={{ background: cssOf(preset.background) }}>
          <span style={{ background: cssOf(preset.card), height: "100%" }} />
          <span style={{ background: cssOf(preset.accent), height: "70%" }} />
          <span style={{ background: cssOf(preset.text), height: "45%" }} />
        </span>
      ) : (
        <span className="theme-preview theme-system" />
      )}
      <span>{label}</span>
    </button>
  );
}

/** Reads a backup file. Null when it is not one, "newer" when a later version of Shelfmark wrote it. */
function backupOf(text: string): Vault | "newer" | null {
  let raw: unknown;
  try {
    // Without the invisible mark some programs put at the very start of a text file.
    raw = JSON.parse((text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim());
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const file = raw as Record<string, unknown>;
  if (file.app === "shelfmark") {
    if (typeof file.v === "number" && file.v > ENVELOPE_VERSION) return "newer";
    return looksLikeVault(file.backup) ? readVault(file.backup) : null;
  }
  // The bare library, without the envelope around it, is accepted as well.
  return looksLikeVault(file) ? readVault(file) : null;
}

export default function SettingsPage() {
  const { t, lang, setLang, locale } = useI18n();
  const { api, client, config, user, signOut } = useAuth();
  const { vault, prefs, mutate, notify, settled } = useLibrary();
  const [editing, setEditing] = useState<CustomTheme | "new" | null>(null);
  const [removing, setRemoving] = useState<CustomTheme | null>(null);
  const [restoring, setRestoring] = useState<Vault | null>(null);
  const [backupProblem, setBackupProblem] = useState<string | null>(null);
  const [importing, setImporting] = useState<ImportPlan | null>(null);
  const [importProblem, setImportProblem] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [accountProblem, setAccountProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(prefs.minutesPerPage);
  const fileInput = useRef<HTMLInputElement>(null);

  // The speed arrives from the library, and from the phone when it changes there.
  useEffect(() => setSpeed(prefs.minutesPerPage), [prefs.minutesPerPage]);
  // Dragging the slider would otherwise save on every step.
  useEffect(() => {
    if (speed === prefs.minutesPerPage) return;
    const timer = window.setTimeout(() => void mutate(setPrefs({ minutesPerPage: speed })), 500);
    return () => window.clearTimeout(timer);
  }, [speed, prefs.minutesPerPage, mutate]);

  const pickTheme = (key: string) => {
    if (key !== prefs.theme) void mutate(setPrefs({ theme: key }));
  };

  const download = () => {
    const file = writeEnvelope(makeEnvelope("backup", { backup: { ...vault, exportedAt: Date.now() } }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `shelfmark-backup-${toIsoDate(today())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(t("settings_backup_done"));
  };

  /**
   * Every file goes through here, whichever of the two buttons it was chosen with, as in
   * the app: a backup leads to the question whether to replace the library, a list of
   * books from another app to the preview of an import. What went wrong is said next to
   * the button that was used.
   */
  const chosen = async (file: File | undefined, from: "backup" | "import") => {
    setBackupProblem(null);
    setImportProblem(null);
    if (!file) return;
    const problem = from === "backup" ? setBackupProblem : setImportProblem;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isZip(bytes)) return problem(t("web_file_zip"));
      const text = decodeText(bytes);
      const backup = backupOf(text);
      if (backup === "newer") return problem(t("import_newer_version"));
      if (backup) return setRestoring(backup);
      const plan = parseImport(text);
      if (plan) return setImporting(plan);
      problem(t(from === "backup" ? "web_restore_invalid" : "web_import_invalid"));
    } catch {
      problem(t("import_unreadable"));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const deleteAccount = async () => {
    if (busy || !understood) return;
    setBusy(true);
    setAccountProblem(null);
    try {
      // The cover pictures go first: once the account is gone, nobody may remove them any more.
      if (user) {
        const token = await client.auth.getSession().then(
          ({ data }) => data.session?.access_token,
          () => undefined,
        );
        if (token) await removeCovers(config, token, user.id, vault.books);
      }
      const { loginKept } = await api.deleteAccount();
      try {
        window.sessionStorage.setItem("shelfmark.notice", loginKept ? "login_kept" : "deleted");
        if (user) window.localStorage.removeItem(`shelfmark.published.${user.id}`);
        window.localStorage.removeItem("shelfmark.theme");
      } catch {
        // The notice on the sign-in page is a courtesy, not a necessity.
      }
      await signOut();
    } catch (error) {
      const reason = reasonOf(error);
      setAccountProblem(t(serverProblemKey(reason), reason));
      setBusy(false);
    }
  };

  const leave = async () => {
    // What is still on its way to the server goes first, so signing out loses nothing.
    await settled();
    await signOut();
  };

  return (
    <div className="page" data-testid="settings-page">
      <PageHead title={t("settings_title")} back="/" />

      <Card title={t("settings_language")}>
        <div className="chips" role="group" aria-label={t("settings_language")}>
          {LANGS.map((code) => (
            <Chip key={code} selected={lang === code} onClick={() => setLang(code)} lang={code} data-testid={`lang-${code}`}>
              {t(`web_language_${code}`)}
            </Chip>
          ))}
        </div>
      </Card>

      <Card title={t("settings_theme")} testId="theme-card">
        <div className="theme-grid">
          <Swatch preset={null} selected={prefs.theme === THEME_SYSTEM} onPick={() => pickTheme(THEME_SYSTEM)} label={t("settings_theme_system")} testId="theme-system" />
          {THEME_PRESETS.map((preset) => (
            <Swatch key={preset.key} preset={preset} selected={prefs.theme === preset.key} onPick={() => pickTheme(preset.key)} label={preset.name} testId={`theme-${preset.key}`} />
          ))}
        </div>
        <h2 className="card-title" style={{ marginTop: 16 }}>
          {t("web_theme_custom")}
        </h2>
        <div className="theme-grid">
          {prefs.customThemes.map((theme) => (
            <div key={theme.id} style={{ position: "relative" }}>
              <Swatch preset={presetOfCustom(theme)} selected={prefs.theme === CUSTOM_THEME_PREFIX + theme.id} onPick={() => pickTheme(CUSTOM_THEME_PREFIX + theme.id)} label={theme.name} testId={`theme-custom-${theme.id}`} />
              <span style={{ position: "absolute", top: 2, right: 2 }}>
                <IconButton icon="edit" size={18} label={`${t("theme_edit")}: ${theme.name}`} onClick={() => setEditing(theme)} style={{ background: "var(--card)", width: 34, height: 34 }} />
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Button variant="outline" icon="add" onClick={() => setEditing("new")} data-testid="new-theme">
            {t("theme_new")}
          </Button>
        </div>
      </Card>

      <Card title={t("settings_motion")}>
        <Switch label={t("settings_motion_switch")} hint={t("settings_motion_hint")} checked={prefs.motion} onChange={(value) => void mutate(setPrefs({ motion: value }))} testId="motion" />
      </Card>

      <Card title={t("settings_speed")}>
        <div className="field">
          <label htmlFor="speed">{t("settings_speed_hint")}</label>
          <input id="speed" type="range" min={0.3} max={10} step={0.1} value={speed} onChange={(event) => setSpeed(Math.min(10, Math.max(0.3, Number(event.target.value))))} data-testid="speed" />
        </div>
        <p className="strong">
          {t("web_speed_value", new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(speed))}
          <span className="muted">{` · ${t("settings_speed_pph", Math.round(60 / speed))}`}</span>
        </p>
      </Card>

      <Card title={t("settings_profile")}>
        <AutoSaveField value={prefs.profileName} label={t("settings_profile_name")} onSave={(name) => void mutate(setPrefs({ profileName: name.trim().slice(0, 60) }))} testId="profile-name-field" />
        <p className="field-hint">{t("settings_profile_hint")}</p>
      </Card>

      <Card title={t("settings_backup")}>
        <p className="muted">{t("settings_backup_text")}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <Button variant="outline" icon="download" onClick={download} data-testid="backup-download">
            {t("settings_backup_export")}
          </Button>
          <Button variant="outline" icon="upload" onClick={() => fileInput.current?.click()} data-testid="backup-restore">
            {t("web_backup_restore")}
          </Button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void chosen(event.target.files?.[0], "backup")} data-testid="backup-file" />
        </div>
        {backupProblem ? (
          <p className="problem" role="alert" data-testid="backup-problem">
            {backupProblem}
          </p>
        ) : null}
      </Card>

      <ImportCard problem={importProblem} onFile={(file) => void chosen(file, "import")} />

      <Card title={t("account_title")} testId="account-card">
        <p>{t("account_signed_in_as", user?.email ?? "")}</p>
        <p className="small muted">{t("account_everywhere")}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <Button variant="outline" icon="logout" onClick={() => void leave()} data-testid="sign-out">
            {t("account_sign_out")}
          </Button>
          <Button
            variant="text"
            onClick={() => {
              setUnderstood(false);
              setAccountProblem(null);
              setDeletingAccount(true);
            }}
            style={{ color: "var(--danger-text)" }}
            data-testid="delete-account"
          >
            {t("account_delete")}
          </Button>
        </div>
      </Card>

      <Card title={t("settings_about")}>
        <p>{t("settings_about_text")}</p>
        <p className="small muted" style={{ marginTop: 6 }}>
          {t("web_about_app")}
        </p>
      </Card>

      <p className="legal-row" data-testid="legal-row">
        <LegalLinks lang={lang} />
      </p>

      {editing ? (
        <ThemeEditor
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(theme) => {
            setEditing(null);
            void mutate(saveCustomTheme(theme));
            void mutate(setPrefs({ theme: CUSTOM_THEME_PREFIX + theme.id }));
          }}
          onDelete={
            editing === "new"
              ? null
              : () => {
                  setRemoving(editing);
                  setEditing(null);
                }
          }
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={t("web_delete_theme_title", removing.name)}
          confirm={t("action_delete")}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            void mutate(deleteCustomTheme(removing.id));
            setRemoving(null);
          }}
        />
      ) : null}
      {restoring ? (
        <ConfirmDialog
          title={t("restore_title")}
          text={`${t("restore_text")} (${restoring.books.length})`}
          confirm={t("restore_confirm")}
          danger
          testId="restore-dialog"
          onClose={() => setRestoring(null)}
          onConfirm={() => {
            void mutate(restoreBackup(restoring));
            setRestoring(null);
            notify(t("restore_done_title"));
          }}
        />
      ) : null}
      <ImportFlow plan={importing} onClose={() => setImporting(null)} />
      {deletingAccount ? (
        <Dialog
          title={t("account_delete")}
          onClose={() => setDeletingAccount(false)}
          testId="delete-account-dialog"
          actions={
            <>
              <Button variant="text" onClick={() => setDeletingAccount(false)}>
                {t("action_cancel")}
              </Button>
              <Button variant="danger" disabled={!understood || busy} onClick={() => void deleteAccount()} data-testid="delete-account-confirm">
                {t("account_delete_confirm")}
              </Button>
            </>
          }
        >
          <p>{t("account_delete_text")}</p>
          <p className="strong">{user?.email}</p>
          <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} style={{ width: 20, height: 20, marginTop: 2, flex: "none" }} data-testid="delete-account-check" />
            <span>{t("web_account_delete_check")}</span>
          </label>
          {accountProblem ? (
            <p className="problem" role="alert">
              {accountProblem}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
