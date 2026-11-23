"use client";

// Where the link of a "forgot password" mail leads: a new password is set here.

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth";
import { useI18n } from "@/components/i18n";
import { Button, Field } from "@/components/ui";
import { authProblem } from "@/lib/supabase/errors";

export default function ResetPage() {
  const { t } = useI18n();
  const { client, status, user, doneRecovering } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The link signs the reader in for this one purpose. That takes a moment after the page opens.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        const { key, detail } = authProblem(error);
        setProblem(t(key, detail));
      } else {
        setDone(true);
        doneRecovering();
      }
    } catch (error) {
      const { key, detail } = authProblem(error instanceof Error ? error : {});
      setProblem(t(key, detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-box">
        <h1 className="login-brand">Shelfmark</h1>
        <div className="card stack" data-testid="reset-box">
          <h2>{t("web_reset_title")}</h2>
          {done ? (
            <>
              <p className="notice" role="status" data-testid="reset-done">
                {t("web_reset_done")}
              </p>
              <Link href="/" className="btn btn-filled btn-wide">
                {t("web_to_shelf")}
              </Link>
            </>
          ) : status === "in" && user ? (
            <form className="stack" onSubmit={submit} noValidate>
              <p className="muted">{t("web_reset_text", user.email ?? "")}</p>
              <Field label={t("web_password_new")} type="password" name="new-password" autoComplete="new-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoFocus data-testid="new-password" />
              {problem ? (
                <p className="problem" role="alert" data-testid="reset-problem">
                  {problem}
                </p>
              ) : null}
              <Button type="submit" wide disabled={busy || password.length < 6} data-testid="reset-save">
                {t("web_reset_save")}
              </Button>
            </form>
          ) : status === "loading" || !waited ? (
            <p className="muted" role="status">
              {t("web_reset_waiting")}
            </p>
          ) : (
            <>
              <p className="problem" role="alert" data-testid="reset-invalid">
                {t("web_reset_invalid")}
              </p>
              <Link href="/login" className="btn btn-outline btn-wide">
                {t("web_sign_in_back")}
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
