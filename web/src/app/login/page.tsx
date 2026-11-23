"use client";

// Signing in, creating an account, and asking for a new password.

import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth";
import { FrontDesk } from "@/components/FrontDesk";
import { useI18n } from "@/components/i18n";
import { OrnamentView } from "@/components/Ornaments";
import { ShelfBoard } from "@/components/Shelves";
import { Button, Chip, Field } from "@/components/ui";
import { LANGS } from "@/i18n/index";
import { authProblem } from "@/lib/supabase/errors";

type Mode = "in" | "up" | "forgot";

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const { client } = useAuth();
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Set to the address a confirmation mail went to: the account exists but cannot sign in yet. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    // Left behind when an account was deleted, or by the link of a mail that did not end
    // in a sign-in, to be said once. No link ends in silence.
    try {
      const left = window.sessionStorage.getItem("shelfmark.notice");
      window.sessionStorage.removeItem("shelfmark.notice");
      switch (left) {
        case "deleted":
          return t("web_account_deleted");
        case "login_kept":
          return t("web_account_login_kept");
        case "confirmed":
          return t("web_notice_confirmed");
        case "email_changed":
          return t("web_notice_email_changed");
        case "link_pending":
          return t("web_notice_link_pending");
        case "link_failed":
          return t("web_notice_link_failed", t("account_forgot"));
        default:
          return null;
      }
    } catch {
      return null;
    }
  });

  const fail = (error: { message?: string; code?: string; status?: number; name?: string }) => {
    const { key, detail } = authProblem(error);
    if (key === "account_error_unconfirmed") {
      // Not an error to scold about: say clearly what to do next.
      setConfirming(email.trim());
      setProblem(null);
    } else {
      setProblem(t(key, detail));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const address = email.trim();
    try {
      if (mode === "in") {
        const { error } = await client.auth.signInWithPassword({ email: address, password });
        if (error) fail(error);
      } else if (mode === "up") {
        const { data, error } = await client.auth.signUp({ email: address, password, options: { emailRedirectTo: window.location.origin } });
        if (error) fail(error);
        else {
          // The name is put into the library once it exists, which is after the first sign-in.
          try {
            if (name.trim() !== "") window.localStorage.setItem(`shelfmark.name.${address.toLowerCase()}`, name.trim());
          } catch {
            // The name can be entered later, on the friends page.
          }
          // Where new accounts have to confirm their address, nobody is signed in yet.
          if (!data.session) {
            setConfirming(address);
            setMode("in");
            setPassword("");
          }
        }
      } else {
        const { error } = await client.auth.resetPasswordForEmail(address, { redirectTo: `${window.location.origin}/reset` });
        if (error) fail(error);
        else {
          setNotice(t("account_reset_sent"));
          setMode("in");
        }
      }
    } catch (error) {
      fail(error instanceof Error ? error : {});
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!confirming) return;
    setProblem(null);
    const { error } = await client.auth.resend({ type: "signup", email: confirming, options: { emailRedirectTo: window.location.origin } });
    if (error) fail(error);
    else setNotice(t("web_confirm_resent"));
  };

  const choose = (next: Mode) => {
    setMode(next);
    setProblem(null);
    setNotice(null);
  };

  // The language sits where the front page has it: at the top, on the right.
  const languages = (
    <span className="front-langs" role="group" aria-label={t("settings_language")}>
      {LANGS.map((code) => (
        <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)} lang={code} data-testid={`lang-${code}`}>
          {t(`web_language_${code}`)}
        </button>
      ))}
    </span>
  );

  return (
    <FrontDesk aside={languages}>
      <div className="entry">
        <div className="entry-words">
          <h1>{t(mode === "up" ? "account_sign_up" : mode === "forgot" ? "account_forgot" : "account_sign_in")}</h1>
          <p>{t("web_login_intro")}</p>
          <div className="entry-shelf" aria-hidden="true">
            <div className="login-shelf">
              <OrnamentView kind="BOOKSTACK" decorative />
              <OrnamentView kind="CANDLE" decorative />
              <OrnamentView kind="CAT" decorative />
            </div>
            <ShelfBoard />
          </div>
        </div>

        <div className="entry-form paper">
        <form className="card stack" onSubmit={submit} data-testid="login-form" noValidate>
          {mode !== "forgot" ? (
            <div className="chips" role="group" aria-label={t("account_title")}>
              <Chip selected={mode === "in"} onClick={() => choose("in")} data-testid="mode-in">
                {t("web_account_have_one")}
              </Chip>
              <Chip selected={mode === "up"} onClick={() => choose("up")} data-testid="mode-up">
                {t("web_account_new_here")}
              </Chip>
            </div>
          ) : (
            <p className="muted">{t("web_forgot_text")}</p>
          )}

          {confirming ? (
            <div className="notice stack-tight" role="status" data-testid="confirm-notice">
              <strong>{t("web_confirm_title")}</strong>
              <span>{t("web_confirm_text", confirming)}</span>
              <span>
                <Button variant="text" onClick={() => void resend()}>
                  {t("web_confirm_resend")}
                </Button>
              </span>
            </div>
          ) : null}
          {notice ? (
            <p className="notice" role="status" data-testid="login-notice">
              {notice}
            </p>
          ) : null}

          <Field label={t("account_email")} type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required data-testid="email" />
          {mode !== "forgot" ? (
            <Field
              label={mode === "up" ? t("account_password") : t("web_password")}
              type="password"
              name="password"
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              data-testid="password"
            />
          ) : null}
          {mode === "up" ? <Field label={t("web_account_name")} name="name" autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value.slice(0, 60))} hint={t("settings_profile_hint")} data-testid="name" /> : null}

          {problem ? (
            <p className="problem" role="alert" data-testid="login-problem">
              {problem}
            </p>
          ) : null}

          <Button type="submit" wide disabled={busy || email.trim() === "" || (mode !== "forgot" && password === "")} data-testid="submit">
            {mode === "in" ? t("account_sign_in") : mode === "up" ? t("account_sign_up") : t("web_forgot_send")}
          </Button>
          {mode === "in" ? (
            <Button variant="text" onClick={() => choose("forgot")} data-testid="forgot">
              {t("account_forgot")}
            </Button>
          ) : mode === "forgot" ? (
            <Button variant="text" onClick={() => choose("in")}>
              {t("web_sign_in_back")}
            </Button>
          ) : null}
        </form>

        </div>
      </div>
    </FrontDesk>
  );
}
