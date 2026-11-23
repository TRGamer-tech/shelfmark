"use client";

// The library of the signed-in account, kept in memory and in step with the server.
// Pages read it from here and change it through mutate, the one way in.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { LendRequest, Vault, VaultPrefs } from "@/lib/model";
import { prefsOf, writeEnvelope } from "@/lib/model";
import type { Change } from "@/lib/mutations";
import { addRequest, answerRequest, setPrefs } from "@/lib/mutations";
import { answerEnvelope, libraryEnvelope, libraryFingerprint, requestEnvelope } from "@/lib/share";
import type { FriendLibrary, ServerFriend } from "@/lib/social";
import { acceptLibraries, importMessages, readSyncAnswer } from "@/lib/social";
import type { Profile } from "@/lib/supabase/api";
import type { SaveStatus } from "@/lib/sync";
import { VaultStore, reasonOf } from "@/lib/sync";
import { today } from "@/lib/dates";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";
import { useAppliedTheme } from "./theme";

const REFRESH_MS = 60_000;

interface Toast {
  id: number;
  text: string;
}

interface Library {
  vault: Vault;
  prefs: VaultPrefs;
  /** Applies a change to the library: shown at once, saved right after. */
  mutate: (change: Change) => Promise<void>;
  status: SaveStatus;
  problem: string | null;
  pending: number;
  retry: () => void;
  /** Resolves once everything is saved. False when saving did not work. */
  settled: () => Promise<boolean>;
  profile: Profile | null;
  setName: (name: string) => Promise<void>;
  newCode: () => Promise<void>;
  friends: ServerFriend[];
  libraries: Map<string, FriendLibrary>;
  friendsBusy: boolean;
  /** Why the last look for news from friends did not work, or null. */
  friendsProblem: string | null;
  lastSync: number;
  syncFriends: () => Promise<void>;
  addFriend: (code: string) => Promise<string>;
  removeFriend: (id: string) => Promise<void>;
  /** Asks a friend for a book. False when the request is recorded but could not be sent yet. */
  askToBorrow: (request: LendRequest) => Promise<boolean>;
  resendRequest: (request: LendRequest) => Promise<boolean>;
  /** Answers a friend's request. False when the answer is recorded but could not be sent yet. */
  answer: (request: LendRequest, accept: boolean) => Promise<boolean>;
  notify: (text: string) => void;
}

const Context = createContext<Library | null>(null);

export function useLibrary(): Library {
  const value = useContext(Context);
  if (!value) throw new Error("useLibrary needs a LibraryProvider above it");
  return value;
}

function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not remembered then. The worst that follows is one publish too many.
  }
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { api, user, signOut } = useAuth();
  const { t } = useI18n();
  const userId = user?.id ?? "";
  const email = user?.email ?? "";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<ServerFriend[]>([]);
  const [libraries, setLibraries] = useState<Map<string, FriendLibrary>>(new Map());
  const [friendsBusy, setFriendsBusy] = useState(false);
  const [friendsProblem, setFriendsProblem] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const profileRef = useRef<Profile | null>(null);
  const librariesRef = useRef<Map<string, FriendLibrary>>(new Map());
  const syncing = useRef<Promise<void> | null>(null);
  const publishing = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }, []);

  // After a save that changes what friends see, the shared library is published again.
  const publishKey = `shelfmark.published.${userId}`;
  const wanted = useRef<Vault | null>(null);
  const publishIfChanged = useCallback(
    async (vault: Vault) => {
      if (!userId) return;
      wanted.current = vault;
      // One publish at a time. A save that happens meanwhile is picked up when this one is done.
      if (publishing.current) return;
      publishing.current = true;
      try {
        while (wanted.current) {
          const next = wanted.current;
          wanted.current = null;
          const envelope = libraryEnvelope(next, userId, Date.now());
          const fingerprint = libraryFingerprint(envelope);
          if (remembered(publishKey) === fingerprint) continue;
          await api.publish(writeEnvelope(envelope));
          remember(publishKey, fingerprint);
        }
      } catch {
        // No connection, or the server said no. The next save tries again.
      } finally {
        publishing.current = false;
      }
    },
    [api, userId, publishKey],
  );

  // Friends see the name of the profile, so it follows the name in the library.
  const syncName = useCallback(
    async (vault: Vault) => {
      const name = prefsOf(vault).profileName.trim();
      const current = profileRef.current;
      if (!current || name === "" || name === current.name) return;
      try {
        const updated = await api.hello(name);
        profileRef.current = updated;
        setProfile(updated);
      } catch {
        // Tried again after the next save.
      }
    },
    [api],
  );

  const afterSave = useRef<(vault: Vault) => void>(() => undefined);
  afterSave.current = (vault) => {
    void publishIfChanged(vault);
    void syncName(vault);
  };

  const store = useMemo(() => new VaultStore(api.vault, { onSaved: (vault) => afterSave.current(vault) }), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const prefs = prefsOf(state.vault);

  const syncFriends = useCallback(async () => {
    if (!userId) return;
    if (syncing.current) return syncing.current;
    const run = (async () => {
      setFriendsBusy(true);
      try {
        const known: Record<string, number> = {};
        for (const [owner, entry] of librariesRef.current) known[owner] = entry.at;
        const answer = readSyncAnswer(await api.sync(known, []));
        const friendIds = new Set(answer.friends.map((f) => f.id));
        const next = new Map(Array.from(librariesRef.current).filter(([owner]) => friendIds.has(owner)));
        for (const entry of acceptLibraries(answer.libraries, userId)) {
          if (friendIds.has(entry.owner)) next.set(entry.owner, entry);
        }
        librariesRef.current = next;
        setLibraries(next);
        setFriends(answer.friends);
        if (profileRef.current && answer.code && answer.code !== profileRef.current.code) {
          profileRef.current = { ...profileRef.current, code: answer.code };
          setProfile(profileRef.current);
        }
        if (answer.messages.length > 0) {
          const imported = importMessages(store.getState().vault, answer.messages, userId);
          let saved = true;
          if (imported.vault !== store.getState().vault) {
            await store.mutate((vault) => importMessages(vault, answer.messages, userId).vault);
            saved = await store.settled();
          }
          // Only what is safely in the library is taken off the server.
          if (saved) await api.sync(known, answer.messages.map((m) => m.id)).catch(() => undefined);
          for (const request of imported.newRequests) notify(tRef.current("notify_request_title", request.peerName || tRef.current("friends_someone")));
          for (const request of imported.answered) {
            notify(tRef.current(request.status === "ACCEPTED" ? "notify_answer_yes" : "notify_answer_no", request.peerName || tRef.current("friends_someone")));
          }
        }
        setFriendsProblem(null);
        setLastSync(Date.now());
      } catch (error) {
        setFriendsProblem(reasonOf(error));
      } finally {
        setFriendsBusy(false);
      }
    })();
    syncing.current = run.finally(() => {
      syncing.current = null;
    });
    return syncing.current;
  }, [api, store, userId, notify]);

  // The first fetch after signing in: who am I, then the library, then news from friends.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mine = await api.hello();
        if (!alive) return;
        profileRef.current = mine;
        setProfile(mine);
      } catch (error) {
        if (reasonOf(error) === "signed_out") {
          await signOut();
          return;
        }
      }
      await store.load();
      if (!alive) return;
      const loaded = store.getState();
      if (loaded.status === "failed") return;
      // A name given when the account was created waits here until the library exists.
      const pendingName = remembered(`shelfmark.name.${email}`);
      if (pendingName && prefsOf(loaded.vault).profileName === "") {
        void store.mutate(setPrefs({ profileName: pendingName }));
      }
      remember(`shelfmark.name.${email}`, null);
      if (loaded.revision > 0) afterSave.current(loaded.vault);
      void syncFriends();
    })();
    return () => {
      alive = false;
    };
  }, [api, store, email, signOut, syncFriends]);

  // Changes made on the phone appear here: a look every minute, and whenever the tab comes back.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState !== "visible") return;
      if (store.getState().status === "failed") void store.load();
      else void store.refresh();
      void syncFriends();
    };
    const timer = window.setInterval(look, REFRESH_MS);
    document.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
    window.addEventListener("online", look);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
      window.removeEventListener("online", look);
    };
  }, [store, syncFriends]);

  // A save that failed is tried again by itself, the reader does not have to press anything.
  useEffect(() => {
    if (state.status !== "error") return;
    const timer = window.setTimeout(() => void store.flush(), 8000);
    return () => window.clearTimeout(timer);
  }, [state.status, state.pending, store]);

  // Closing the tab while something is not saved yet deserves a warning.
  useEffect(() => {
    if (state.pending === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.pending]);

  // The session ran out and could not be renewed: back to the sign-in page.
  useEffect(() => {
    if (state.problem === "signed_out") void signOut();
  }, [state.problem, signOut]);

  useAppliedTheme(prefs.theme, prefs.customThemes, state.status !== "loading" && state.status !== "failed");
  useEffect(() => {
    // "Off" means no decorative animation at all, whatever the browser would allow.
    document.documentElement.dataset.motion = prefs.motion ? "on" : "off";
  }, [prefs.motion]);

  const mutate = useCallback((change: Change) => store.mutate(change), [store]);
  const retry = useCallback(() => {
    if (store.getState().status === "failed") void store.load();
    else void store.flush();
  }, [store]);
  const settled = useCallback(() => store.settled(), [store]);

  const setName = useCallback(
    async (name: string) => {
      await store.mutate(setPrefs({ profileName: name.trim() }));
    },
    [store],
  );

  const newCode = useCallback(async () => {
    const code = await api.newCode();
    if (profileRef.current) {
      profileRef.current = { ...profileRef.current, code };
      setProfile(profileRef.current);
    }
  }, [api]);

  const addFriend = useCallback(
    async (code: string) => {
      const friend = await api.addFriend(code);
      // The new friend should see a shelf right away, even if nothing was saved in this session yet.
      void publishIfChanged(store.getState().vault);
      void syncFriends();
      return friend.name;
    },
    [api, store, publishIfChanged, syncFriends],
  );

  const removeFriend = useCallback(
    async (id: string) => {
      await api.removeFriend(id);
      await syncFriends();
    },
    [api, syncFriends],
  );

  const send = useCallback(
    async (to: string, envelope: Record<string, unknown>): Promise<boolean> => {
      try {
        await api.send(to, envelope);
        return true;
      } catch {
        return false;
      }
    },
    [api],
  );

  const resendRequest = useCallback(
    (request: LendRequest) => send(request.peerId, writeEnvelope(requestEnvelope(request, userId, prefsOf(store.getState().vault).profileName))),
    [send, store, userId],
  );

  const askToBorrow = useCallback(
    async (request: LendRequest) => {
      await store.mutate(addRequest(request));
      return resendRequest(request);
    },
    [store, resendRequest],
  );

  const answer = useCallback(
    async (request: LendRequest, accept: boolean) => {
      const now = Date.now();
      // Answering again (to send it once more) must not move the date or the book a second time.
      if (request.status === "PENDING") await store.mutate(answerRequest(request.id, accept, today(), now));
      const current = store.getState().vault.requests.find((r) => r.id === request.id) ?? request;
      const envelope = answerEnvelope(current, accept, userId, prefsOf(store.getState().vault).profileName, current.answeredAt ?? now);
      return send(request.peerId, writeEnvelope(envelope));
    },
    [store, send, userId],
  );

  const value = useMemo<Library>(
    () => ({
      vault: state.vault,
      prefs,
      mutate,
      status: state.status,
      problem: state.problem,
      pending: state.pending,
      retry,
      settled,
      profile,
      setName,
      newCode,
      friends,
      libraries,
      friendsBusy,
      friendsProblem,
      lastSync,
      syncFriends,
      addFriend,
      removeFriend,
      askToBorrow,
      resendRequest,
      answer,
      notify,
    }),
    [state, prefs, mutate, retry, settled, profile, setName, newCode, friends, libraries, friendsBusy, friendsProblem, lastSync, syncFriends, addFriend, removeFriend, askToBorrow, resendRequest, answer, notify],
  );

  return (
    <Context.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {toast.text}
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
