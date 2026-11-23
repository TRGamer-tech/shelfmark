"use client";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Api } from "@/lib/supabase/api";
import { makeApi, makeClient } from "@/lib/supabase/api";
import type { ServerConfig } from "@/lib/supabase/config";

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
  const client = useMemo(() => makeClient(config), [config]);
  const api = useMemo(() => makeApi(client), [client]);
  const [status, setStatus] = useState<Auth["status"]>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let alive = true;
    client.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        setSession(data.session);
        setStatus(data.session ? "in" : "out");
      })
      .catch(() => {
        if (alive) setStatus("out");
      });
    // Only state is set in here: calling the server from inside this callback can lock the client up.
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(next);
      setStatus(next ? "in" : "out");
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

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
