"use client";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Api } from "@/lib/supabase/api";
import { makeApi, makeClient } from "@/lib/supabase/api";
import type { ServerConfig } from "@/lib/supabase/config";
import { mailLinkOf } from "@/lib/supabase/links";

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
  signOut: () => Promise<void>;
}

const Context = createContext<Auth | null>(null);

export function AuthProvider({ config, children }: { config: ServerConfig; children: ReactNode }) {
  // Read before the client exists: the client takes the sign-in out of the address and wipes it.
  // The address is asked directly, not only the client's "password recovery" event, because
  // that event is sent once and is missed by whoever starts listening a moment too late.
  const [arrival] = useState(() => mailLinkOf(window.location.href));
  const client = useMemo(() => makeClient(config), [config]);
  const api = useMemo(() => makeApi(client), [client]);
  const [status, setStatus] = useState<Auth["status"]>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [recovering, setRecovering] = useState(arrival === "recovery");

  useEffect(() => {
    let alive = true;
    let judged = false;
    const take = (next: Session | null) => {
      if (!alive) return;
      // The first news of who is here also says what became of the link of a mail. It was
      // opened and nobody is signed in: the link was too old, or used before.
      if (!judged) {
        judged = true;
        if (arrival && !next) {
          setRecovering(false);
          // Said once, on the sign-in page. The page for a new password says so itself.
          if (window.location.pathname.replace(/\/$/, "") !== "/reset") {
            try {
              window.sessionStorage.setItem("shelfmark.notice", "link_failed");
            } catch {
              // Then the sign-in page opens without a word.
            }
          }
        }
      }
      setSession(next);
      setStatus(next ? "in" : "out");
    };
    client.auth
      .getSession()
      .then(({ data }) => take(data.session))
      .catch(() => take(null));
    // Only state is set in here: calling the server from inside this callback can lock the client up.
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      take(next);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [client, arrival]);

  const signOut = useCallback(async () => {
    // Signing out of this browser has to work without a connection too.
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }, [client]);

  const doneRecovering = useCallback(() => setRecovering(false), []);

  const value = useMemo<Auth>(
    () => ({ config, client, api, status, session, user: session?.user ?? null, recovering, doneRecovering, signOut }),
    [config, client, api, status, session, recovering, doneRecovering, signOut],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): Auth {
  const value = useContext(Context);
  if (!value) throw new Error("useAuth needs an AuthProvider above it");
  return value;
}
