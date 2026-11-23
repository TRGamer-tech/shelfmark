"use client";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Api } from "@/lib/supabase/api";
import { makeApi, makeClient } from "@/lib/supabase/api";
import type { ServerConfig } from "@/lib/supabase/config";
import type { LinkSession, MailLink } from "@/lib/supabase/links";
import { mailLinkOf, noticeFor, outcomeOf, sessionOf, wantsPassword, withoutLink } from "@/lib/supabase/links";

interface Auth {
  config: ServerConfig;
  client: SupabaseClient;
  api: Api;
  /** "loading" until the browser has looked for a sign-in it remembers. */
  status: "loading" | "out" | "in";
  session: Session | null;
  user: User | null;
  /** True after the link of a "forgot password" mail was opened: a new password is due. */
  recovering: boolean;
  doneRecovering: () => void;
  /**
   * The link of a mail brought the reader here and they are signed in: which kind it
   * was, so that the shelf can say what happened. Null once that was said.
   */
  welcome: MailLink;
  dismissWelcome: () => void;
  /**
   * The link of a mail brought the reader here and nobody is signed in. They belong on
   * the sign-in page, which says why. False once they are there.
   */
  turnedAway: boolean;
  arrivedAtDesk: () => void;
  /**
   * What the confirmation page has to say about the link that brought the reader here:
   * "confirmed" after the link of a confirmation mail, "stale" after a link that was
   * too old or used before. Null when no such link was opened.
   */
  confirmation: "confirmed" | "stale" | null;
  /** True while the reader is owed the confirmation page and is not on it yet. */
  dueAtConfirmation: boolean;
  arrivedAtConfirmation: () => void;
  signOut: () => Promise<void>;
}

const Context = createContext<Auth | null>(null);

interface Arrival {
  link: MailLink;
  tokens: LinkSession | null;
}

/** What the address says when the page is opened: the kind of link, and the sign-in it carries. */
function readArrival(): Arrival {
  const address = window.location.href;
  return { link: mailLinkOf(address), tokens: sessionOf(address) };
}

// The sign-in behind a link is taken once per page, however often the effect below runs.
const taking = new WeakMap<SupabaseClient, Promise<void>>();

function takeSignIn(client: SupabaseClient, tokens: LinkSession | null): Promise<void> {
  let done = taking.get(client);
  if (!done) {
    // A sign-in that does not take leaves whoever was signed in before as they were.
    done = tokens ? client.auth.setSession(tokens).then(() => undefined, () => undefined) : Promise.resolve();
    taking.set(client, done);
  }
  return done;
}

export function AuthProvider({ config, children }: { config: ServerConfig; children: ReactNode }) {
  const [arrival] = useState(readArrival);
  const client = useMemo(() => makeClient(config), [config]);
  const api = useMemo(() => makeApi(client), [client]);
  const [status, setStatus] = useState<Auth["status"]>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [recovering, setRecovering] = useState(wantsPassword(arrival.link));
  const [welcome, setWelcome] = useState<MailLink>(null);
  const [turnedAway, setTurnedAway] = useState(false);
  const [confirmation, setConfirmation] = useState<Auth["confirmation"]>(null);
  const [dueAtConfirmation, setDueAtConfirmation] = useState(false);

  useEffect(() => {
    // Whatever stood behind the "#" has been read. It is wiped from the address before
    // the first request leaves, by replacing the entry in the history of the browser:
    // neither a reload nor the Back button finds the link again. The client is told not
    // to look at the address itself (lib/supabase/api.ts), because it would add an entry
    // instead, and Back would then play the link once more.
    if (arrival.link && mailLinkOf(window.location.href) !== null) {
      try {
        window.history.replaceState(window.history.state, "", withoutLink(window.location.href));
      } catch {
        // The address keeps its tail then, which is untidy and nothing worse.
      }
    }
    let alive = true;
    let judged = false;
    // While the sign-in of a link is being taken, news of who is here says nothing yet.
    let settled = arrival.tokens === null;
    const take = (next: Session | null) => {
      if (!alive || !settled) return;
      // The first news of who is here also says what became of the link of a mail.
      if (!judged) {
        judged = true;
        const onReset = window.location.pathname.replace(/\/$/, "") === "/reset";
        // The sign-in behind the link did not take: no password can be set with it.
        if (arrival.link && !next) setRecovering(false);
        switch (outcomeOf(arrival.link, next !== null, onReset)) {
          case "confirmed":
            setConfirmation("confirmed");
            setDueAtConfirmation(true);
            break;
          case "stale":
            setConfirmation("stale");
            setDueAtConfirmation(true);
            break;
          case "welcome":
            // Signed in. The shelf says what the link did: no link ends in silence.
            setWelcome(arrival.link);
            break;
          case "turned_away":
            // The link was opened and nobody is signed in. The sign-in page says why, once.
            try {
              window.sessionStorage.setItem("shelfmark.notice", noticeFor(arrival.link) ?? "link_failed");
            } catch {
              // Then the sign-in page opens without a word.
            }
            setTurnedAway(true);
            break;
          default:
            break;
        }
      }
      setSession(next);
      setStatus(next ? "in" : "out");
    };
    const ask = () =>
      client.auth
        .getSession()
        .then(({ data }) => take(data.session))
        .catch(() => take(null));
    if (settled) void ask();
    else {
      void takeSignIn(client, arrival.tokens).then(() => {
        settled = true;
        return ask();
      });
    }
    // Only state is set in here: calling the server from inside this callback can lock the client up.
    const { data } = client.auth.onAuthStateChange((_event, next) => take(next));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [client, arrival]);

  const signOut = useCallback(async () => {
    // What the site kept in this browser for the account goes with the sign-in: the copy
    // of what was last shared with friends, and a timer that is running. The next reader
    // at this computer should find nothing of it.
    const id = (await client.auth.getSession().catch(() => null))?.data.session?.user.id;
    if (id) {
      try {
        window.localStorage.removeItem(`shelfmark.published.${id}`);
        window.localStorage.removeItem(`shelfmark.timer.${id}`);
      } catch {
        // A browser that keeps nothing has nothing to remove.
      }
    }
    // Signing out of this browser has to work without a connection too.
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }, [client]);

  const doneRecovering = useCallback(() => setRecovering(false), []);
  const dismissWelcome = useCallback(() => setWelcome(null), []);
  const arrivedAtDesk = useCallback(() => setTurnedAway(false), []);
  const arrivedAtConfirmation = useCallback(() => setDueAtConfirmation(false), []);

  const value = useMemo<Auth>(
    () => ({
      config,
      client,
      api,
      status,
      session,
      user: session?.user ?? null,
      recovering,
      doneRecovering,
      welcome,
      dismissWelcome,
      turnedAway,
      arrivedAtDesk,
      confirmation,
      dueAtConfirmation,
      arrivedAtConfirmation,
      signOut,
    }),
    [config, client, api, status, session, recovering, doneRecovering, welcome, dismissWelcome, turnedAway, arrivedAtDesk, confirmation, dueAtConfirmation, arrivedAtConfirmation, signOut],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): Auth {
  const value = useContext(Context);
  if (!value) throw new Error("useAuth needs an AuthProvider above it");
  return value;
}
