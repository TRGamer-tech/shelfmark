"use client";

// The page somebody lands on after the link of a confirmation mail: a slip of paper on
// the desk that says what the link did and what to do next. It has to serve two kinds
// of reader with the same words: those who made their account here, and those who made
// it in the Android app and opened the mail on whatever device was at hand.

import Link from "next/link";
import { useEffect } from "react";
import { useAuth } from "./auth";
import { FrontDesk, LangButtons } from "./FrontDesk";
import { useI18n } from "./i18n";

/**
 * Puts what happened into the title of the page, in the reader's language, for as long
 * as this page is shown. The title the server wrote is the same for everybody, and the
 * framework writes it once more when it takes the page over, which can be after this has
 * run. So the title is watched and put back, and handed back on leaving.
 */
function usePageTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    const wanted = `${title} - Shelfmark`;
    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const watcher = new MutationObserver(apply);
    watcher.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      watcher.disconnect();
      // Only if nobody has written a title for the next page in the meantime.
      if (document.title === wanted) document.title = before;
    };
  }, [title]);
}

/**
 * A sentence that names the account by its address. An address has no place to break
 * by itself, so it is given one after the "@": on a narrow screen it then breaks there
 * and not in the middle of a word.
 */
function Naming({ text, who }: { text: string; who: string }) {
  const [before, after] = text.split("\n");
  const at = who.indexOf("@");
  return (
    <>
      {before}
      <span className="receipt-who">
        {who.slice(0, at + 1)}
        <wbr />
        {who.slice(at + 1)}
      </span>
      {after}
    </>
  );
}

export function Confirmed() {
  const { t, locale } = useI18n();
  const { status, user, confirmation } = useAuth();
  const signedIn = status === "in" && user !== null;
  const who = user?.email ?? "";
  // What the link said, and whether this device is signed in: six slips in all.
  const state = `${confirmation ?? "plain"}-${signedIn ? "in" : "out"}`;

  const title = t(confirmation === "confirmed" ? "web_confirmed_title" : confirmation === "stale" ? "web_confirmed_stale_title" : signedIn ? "web_confirmed_in_title" : "web_confirmed_plain_title");
  usePageTitle(title);

  // The day the address was confirmed is the day the link was opened: today.
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(new Date());

  return (
    <FrontDesk testId="confirmed-page" aside={<LangButtons />}>
      <article className="receipt paper" data-testid="confirmed-card" data-state={state}>
        {confirmation === "confirmed" ? (
          <p className="receipt-stamp" aria-hidden="true">
            <span>{t("web_confirmed_stamp")}</span>
            {day}
          </p>
        ) : null}
        <h1>{title}</h1>

        {confirmation === "confirmed" ? (
          <p className="receipt-lead">{signedIn ? <Naming text={t("web_confirmed_signed_in", "\n")} who={who} /> : t("web_confirmed_sign_in")}</p>
        ) : confirmation === "stale" ? (
          signedIn ? (
            <p className="receipt-lead">
              <Naming text={t("web_confirmed_stale_signed_in", "\n")} who={who} />
            </p>
          ) : (
            <p className="receipt-lead">{t("web_confirmed_stale_used")}</p>
          )
        ) : (
          <p className="receipt-lead">{signedIn ? <Naming text={t("web_confirmed_in_text", "\n")} who={who} /> : t("web_confirmed_plain_text")}</p>
        )}

        <p className="receipt-action">
          {signedIn ? (
            <Link href="/" className="btn btn-filled" data-testid="confirmed-open">
              {t("web_confirmed_open")}
            </Link>
          ) : (
            <Link href="/login" className="btn btn-filled" data-testid="confirmed-sign-in">
              {t("account_sign_in")}
            </Link>
          )}
        </p>

        {confirmation === "stale" && !signedIn ? (
          <div className="receipt-more" data-testid="confirmed-more">
            <p>{t("web_confirmed_stale_resend")}</p>
            <p>{t("web_confirmed_stale_password", t("account_forgot"))}</p>
          </div>
        ) : null}

        {confirmation ? (
          <aside className="receipt-app" data-testid="confirmed-app">
            <h2>{t("web_confirmed_app_title")}</h2>
            <p>{t("web_confirmed_app")}</p>
          </aside>
        ) : null}
      </article>
    </FrontDesk>
  );
}
