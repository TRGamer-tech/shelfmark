"use client";

// The library of the signed-in account, kept in memory and in step with the server.
// Pages read it from here and change it through mutate, the one way in.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { localZone } from "@/lib/dates";
import type { Loan, LoanAction } from "@/lib/loans";
import { followLoans, heldBookIds, newsKey, newsOf, readSeen, seenOf } from "@/lib/loans";
import type { SharedBook, Vault, VaultPrefs } from "@/lib/model";
import { prefsOf, writeEnvelope } from "@/lib/model";
import type { Change } from "@/lib/mutations";
import { setPrefs } from "@/lib/mutations";
import { libraryEnvelope, libraryFingerprint } from "@/lib/share";
import { droppedCoverFiles, removeCoverFiles } from "@/lib/supabase/covers";
import type { FriendLibrary, ServerFriend } from "@/lib/social";
import { acceptLibraries, readSyncAnswer } from "@/lib/social";
import type { Profile } from "@/lib/supabase/api";
import type { SaveStatus } from "@/lib/sync";
import { VaultStore, reasonOf } from "@/lib/sync";
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
  /** Every loan the reader is part of and has not put away, as the server last said, the newest question first. */
  loans: Loan[];
  /** Asks a friend for a book of theirs. Throws when the server says no, with the reason. */
  askLoan: (friendId: string, book: SharedBook, note: string) => Promise<void>;
  /**
   * Takes one step in a loan. Throws when the server says no, with the reason. Either
   * way the loans are fetched afresh, so that the page shows where the loan stands.
   */
  actLoan: (loan: Loan, action: LoanAction, detail?: { due?: number | null; reason?: string }) => Promise<void>;
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
  const { api, client, config, user, signOut } = useAuth();
  const { t } = useI18n();
  const userId = user?.id ?? "";
  const email = user?.email ?? "";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<ServerFriend[]>([]);
  const [libraries, setLibraries] = useState<Map<string, FriendLibrary>>(new Map());
  const [friendsBusy, setFriendsBusy] = useState(false);
  const [friendsProblem, setFriendsProblem] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState(0);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const profileRef = useRef<Profile | null>(null);
  const librariesRef = useRef<Map<string, FriendLibrary>>(new Map());
  // The loans as the server last said. Null until it was asked: until then nobody knows which books are reserved.
  const loansRef = useRef<Loan[] | null>(null);
  // Counts the steps the reader took in loans. A look at the server that started before the last one is out of date.
  const steps = useRef(0);
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
  // So it is when a loan changes which books can be asked for.
  const publishKey = `shelfmark.published.${userId}`;
  const wanted = useRef<Vault | null>(null);
  const publishIfChanged = useCallback(
    async (vault: Vault) => {
      // Not before the loans are known: a book reserved for a friend would be offered to everybody.
      if (!userId || loansRef.current === null) return;
      wanted.current = vault;
      // One publish at a time. A save that happens meanwhile is picked up when this one is done.
      if (publishing.current) return;
      publishing.current = true;
      try {
        while (wanted.current) {
          const next = wanted.current;
          wanted.current = null;
          const envelope = libraryEnvelope(next, userId, Date.now(), heldBookIds(loansRef.current ?? []));
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

  // A picture goes with its book. When a save leaves a picture this account uploaded
  // without a book that shows it (the book was deleted, or got another cover), the picture
  // is taken off the server: it must not stay there for anybody who has its address. It
  // is done after the save went through, never before, and it never holds anything up:
  // a picture that cannot be removed now goes with the account at the latest.
  const tidyCovers = useCallback(
    async (before: Vault, after: Vault) => {
      if (!userId) return;
      const dropped = droppedCoverFiles(config, userId, before.books, after.books);
      if (dropped.length === 0) return;
      const token = await client.auth.getSession().then(
        ({ data }) => data.session?.access_token,
        () => undefined,
      );
      if (token) await removeCoverFiles(config, token, userId, dropped);
    },
    [client, config, userId],
  );

  const afterSave = useRef<(vault: Vault, before: Vault) => void>(() => undefined);
  afterSave.current = (vault, before) => {
    void publishIfChanged(vault);
    void syncName(vault);
    void tidyCovers(before, vault);
  };

  const store = useMemo(() => new VaultStore(api.vault, { onSaved: (vault, before) => afterSave.current(vault, before) }), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const prefs = prefsOf(state.vault);

  // What every look at the loans leads to: the reader is told what the other side did,
  // the books follow the loans, and friends learn which books can be asked for now.
  const seenKey = `shelfmark.loans.${userId}`;
  const takeLoans = useCallback(
    (next: Loan[]) => {
      loansRef.current = next;
      setLoans(next);
      const seen = readSeen(remembered(seenKey));
      for (const loan of newsOf(next, seen)) {
        const key = newsKey(loan, seen?.[loan.id]);
        if (key) notify(tRef.current(key, loan.peerName.trim() !== "" ? loan.peerName : tRef.current("friends_someone"), loan.book.title));
      }
      remember(seenKey, JSON.stringify(seenOf(next)));
      // Without the library itself there is nothing to bring in line, and nothing to show to friends.
      const status = store.getState().status;
      if (status === "loading" || status === "failed") return;
      const lookUp = (peer: string, bookId: number) => librariesRef.current.get(peer)?.library.books.find((book) => book.id === bookId);
      const follow = followLoans(next, lookUp, localZone, Date.now());
      // Through the one way in, like any edit: saved, and applied again should the phone have saved in between.
      if (follow(store.getState().vault) !== store.getState().vault) void store.mutate(follow);
      void publishIfChanged(store.getState().vault);
    },
    [store, seenKey, notify, publishIfChanged],
  );

  const lookAtServer = useCallback(async () => {
    setFriendsBusy(true);
    const stepsBefore = steps.current;
    try {
      const known: Record<string, number> = {};
      for (const [owner, entry] of librariesRef.current) known[owner] = entry.at;
      const answer = readSyncAnswer(await api.sync(known));
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
      // The reader took a step in a loan while this was on its way: what it says about loans is older than that step.
      if (steps.current === stepsBefore) takeLoans(answer.loans);
      setFriendsProblem(null);
      setLastSync(Date.now());
    } catch (error) {
      setFriendsProblem(reasonOf(error));
    } finally {
      setFriendsBusy(false);
    }
  }, [api, userId, takeLoans]);

  /** One look at a time. [afresh] waits for a look that is on its way and then looks again, for news that is certain to be newer. */
  const sync = useCallback(
    async (afresh: boolean) => {
      if (!userId) return;
      if (syncing.current) {
        if (!afresh) return syncing.current;
        await syncing.current;
      }
      const run = lookAtServer().finally(() => {
        if (syncing.current === run) syncing.current = null;
      });
      syncing.current = run;
      return run;
    },
    [userId, lookAtServer],
  );
  const syncFriends = useCallback(() => sync(false), [sync]);

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
      if (loaded.revision > 0) void syncName(loaded.vault);
      // Friends get the shelf once the loans are known, which this brings.
      void syncFriends();
    })();
    return () => {
      alive = false;
    };
  }, [api, store, email, signOut, syncFriends, syncName]);

  // Changes made on the phone appear here: a look every minute, and whenever the tab comes back.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState !== "visible") return;
      // A library that was not opened is read again, without taking the message away meanwhile.
      if (store.getState().status === "failed") void store.load(true);
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
    // The switch belongs to the library. Once it is closed (signed out), the pages
    // outside it go by the setting of the system again.
    return () => {
      delete document.documentElement.dataset.motion;
    };
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
      // Only a library that is open: what could not be read is not shown to anybody as empty.
      const status = store.getState().status;
      if (status !== "loading" && status !== "failed") void publishIfChanged(store.getState().vault);
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

  const askLoan = useCallback(
    async (friendId: string, book: SharedBook, note: string) => {
      try {
        const loan = await api.loanAsk(friendId, book.id, { title: book.title, authors: book.authors, isbn: book.isbn, coverUrl: book.coverUrl, pageCount: book.pages, format: book.format }, note.trim());
        steps.current++;
        takeLoans([loan, ...(loansRef.current ?? []).filter((known) => known.id !== loan.id)]);
      } finally {
        // Whatever the answer was: this is how things stand now, for this book and the others.
        await sync(true);
      }
    },
    [api, sync, takeLoans],
  );

  const actLoan = useCallback(
    async (loan: Loan, action: LoanAction, detail: { due?: number | null; reason?: string } = {}) => {
      try {
        const now = await api.loanAct(loan.id, action, detail.due, detail.reason);
        steps.current++;
        const known = loansRef.current ?? [];
        // A loan that was put away is gone from the list. Any other stays where it stood, as it is now.
        if (action === "hide") takeLoans(known.filter((other) => other.id !== now.id));
        else if (known.some((other) => other.id === now.id)) takeLoans(known.map((other) => (other.id === now.id ? now : other)));
        else takeLoans([now, ...known]);
      } finally {
        await sync(true);
      }
    },
    [api, sync, takeLoans],
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
      loans,
      askLoan,
      actLoan,
      notify,
    }),
    [state, prefs, mutate, retry, settled, profile, setName, newCode, friends, libraries, friendsBusy, friendsProblem, lastSync, syncFriends, addFriend, removeFriend, loans, askLoan, actLoan, notify],
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
