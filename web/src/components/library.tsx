"use client";

// The library of the signed-in account, kept in memory and in step with the server.
// Pages read it from here and change it through mutate, the one way in.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Offer, Permission } from "@/lib/browserNotices";
import { localZone, today } from "@/lib/dates";
import type { Loan, LoanAction } from "@/lib/loans";
import { followLoans, heldBookIds } from "@/lib/loans";
import type { SharedBook, Vault, VaultPrefs } from "@/lib/model";
import { prefsOf, writeEnvelope } from "@/lib/model";
import type { Change } from "@/lib/mutations";
import { setPrefs } from "@/lib/mutations";
import { aboutDue, aboutLoan, newsOf, readNewsMemory, rememberFriend, rememberNewsStep, takeAnswer, unsaidOf } from "@/lib/news";
import { libraryEnvelope, libraryFingerprint } from "@/lib/share";
import { droppedCoverFiles, removeCoverFiles } from "@/lib/supabase/covers";
import type { FriendLibrary, ServerFriend, SyncAnswer } from "@/lib/social";
import { acceptLibraries, readSyncAnswer } from "@/lib/social";
import type { Profile } from "@/lib/supabase/api";
import type { SaveStatus } from "@/lib/sync";
import { ServerError, VaultStore, reasonOf } from "@/lib/sync";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";
import { Notices, useTelling } from "./telling";
import { useAppliedTheme } from "./theme";

const REFRESH_MS = 60_000;

interface Library {
  vault: Vault;
  prefs: VaultPrefs;
  /** Applies a change to the library: shown at once, saved right after. */
  mutate: (change: Change) => Promise<void>;
  status: SaveStatus;
  /** The revision of the library as the server last confirmed it. It moves on with every save. */
  revision: number;
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
  /**
   * Makes an earlier version the library again (lib/history.ts). What the reader changed
   * last is saved first, so that it is in the version the server keeps in turn. Throws
   * with "unsaved" when that cannot be saved now: then nothing is brought back.
   */
  restoreVersion: (revision: number) => Promise<void>;
  /** Says something in a line that passes. */
  notify: (text: string) => void;
  /** What the friends and loans pages show about notifications of the browser: a card that asks, a line that says where to allow them, or nothing. */
  notifyOffer: Offer;
  /** Asks the browser whether it may show notifications. Only from a click. */
  allowNotifications: () => Promise<Permission>;
  /** "Not now": the card about notifications is put away for this browser. */
  putNotifyOfferAway: () => void;
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

  const profileRef = useRef<Profile | null>(null);
  const librariesRef = useRef<Map<string, FriendLibrary>>(new Map());
  // The loans as the server last said. Null until it was asked: until then nobody knows which books are reserved.
  const loansRef = useRef<Loan[] | null>(null);
  // Counts the steps the reader took in loans. A look at the server that started before the last one is out of date.
  const steps = useRef(0);
  // The server's time of the loans this page shows. An answer from before that came in late, and is not shown over them.
  const loansAsOf = useRef(0);
  const syncing = useRef<Promise<void> | null>(null);
  const publishing = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  // How the reader is told things: a notice in the page, and a notification of the browser while the page is not in front.
  const telling = useTelling();
  const { tell, unsay, mayLook } = telling;
  const say = telling.notify;
  const notify = useCallback((text: string) => say(text), [say]);

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

  // What the loans lead to once the page knows how they stand: the books follow them,
  // and friends learn which books can be asked for now.
  const bringInLine = useCallback(
    (next: Loan[]) => {
      // Without the library itself there is nothing to bring in line, and nothing to show to friends.
      const status = store.getState().status;
      if (status === "loading" || status === "failed") return;
      const lookUp = (peer: string, bookId: number) => librariesRef.current.get(peer)?.library.books.find((book) => book.id === bookId);
      const follow = followLoans(next, lookUp, localZone, Date.now());
      // Through the one way in, like any edit: saved, and applied again should the phone have saved in between.
      if (follow(store.getState().vault) !== store.getState().vault) void store.mutate(follow);
      void publishIfChanged(store.getState().vault);
    },
    [store, publishIfChanged],
  );

  // What every look at the server leads to: the reader is told what is news, once, and
  // the books follow the loans. False when the answer came in late and nothing was taken from it.
  const seenKey = `shelfmark.loans.${userId}`;
  const takeNews = useCallback(
    (answer: SyncAnswer): boolean => {
      // Two looks can race, and the one that asked first be answered last. What it says
      // is older than what the page shows.
      if (answer.time > 0 && answer.time < loansAsOf.current) return false;
      // What the browser saw before is kept in its storage, for all its windows: a step
      // in a loan, a friend who joined and a book that is due are told once, in the
      // window that sees them first. An answer older than what another window saw
      // already is not taken either: the books would follow loans as they no longer
      // stand, and news that was told would be new again at the next look.
      const day = today();
      const look = takeAnswer(readNewsMemory(remembered(seenKey)), answer, day);
      if (look.late) return false;
      loansAsOf.current = Math.max(loansAsOf.current, answer.time);
      loansRef.current = answer.loans;
      setLoans(answer.loans);
      // A notice goes when the reader has answered it, here or on another device, and
      // when the next step of the same loan takes its place.
      for (const about of unsaidOf(look)) unsay(about);
      for (const news of newsOf(look, day, tRef.current("friends_someone"))) tell(news);
      remember(seenKey, JSON.stringify(look.memory));
      bringInLine(answer.loans);
      return true;
    },
    [seenKey, tell, unsay, bringInLine],
  );

  // The reader's own step, answered by the server with the loan as it stands now. It
  // says nothing about the other loans, so only this one changes, on the page and in
  // what the browser remembers. [gone] is a loan that was put away.
  const takeStep = useCallback(
    (now: Loan, gone: boolean) => {
      steps.current++;
      const known = loansRef.current ?? [];
      const next = gone ? known.filter((other) => other.id !== now.id) : known.some((other) => other.id === now.id) ? known.map((other) => (other.id === now.id ? now : other)) : [now, ...known];
      loansAsOf.current = Math.max(loansAsOf.current, now.updatedAt);
      loansRef.current = next;
      setLoans(next);
      unsay(aboutLoan(now.id));
      unsay(aboutDue(now.id));
      const memory = rememberNewsStep(readNewsMemory(remembered(seenKey)), now, gone, today());
      if (memory) remember(seenKey, JSON.stringify(memory));
      bringInLine(next);
    },
    [seenKey, unsay, bringInLine],
  );

  const lookAtServer = useCallback(async () => {
    setFriendsBusy(true);
    try {
      // An answer about the loans that came in late, after another window of this browser
      // saw more already, is not taken. The question is asked once more, so that this
      // window shows how things stand as well.
      for (let tries = 0; tries < 2; tries++) {
        const stepsBefore = steps.current;
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
        // The reader took a step in a loan while this was on its way: what it says about
        // loans is older than that step, and the step asks again by itself.
        const taken = steps.current !== stepsBefore || takeNews(answer);
        setFriendsProblem(null);
        setLastSync(Date.now());
        if (taken) break;
      }
    } catch (error) {
      setFriendsProblem(reasonOf(error));
    } finally {
      setFriendsBusy(false);
    }
  }, [api, userId, takeNews]);

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
      // A tab that is not in front looks only to have the browser tell the news, if the
      // reader allowed that, and only while no other tab of Shelfmark is in front.
      void mayLook().then((may) => {
        if (!may) return;
        // A library that was not opened is read again, without taking the message away meanwhile.
        if (store.getState().status === "failed") void store.load(true);
        else void store.refresh();
        void syncFriends();
      });
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
  }, [store, syncFriends, mayLook]);

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
      // Whoever the reader adds themselves is no news to them, in whatever window the next look happens.
      const memory = rememberFriend(readNewsMemory(remembered(seenKey)), friend.id);
      if (memory) remember(seenKey, JSON.stringify(memory));
      // The new friend should see a shelf right away, even if nothing was saved in this session yet.
      // Only a library that is open: what could not be read is not shown to anybody as empty.
      const status = store.getState().status;
      if (status !== "loading" && status !== "failed") void publishIfChanged(store.getState().vault);
      void syncFriends();
      return friend.name;
    },
    [api, store, seenKey, publishIfChanged, syncFriends],
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
        takeStep(loan, false);
      } finally {
        // Whatever the answer was: this is how things stand now, for this book and the others.
        await sync(true);
      }
    },
    [api, sync, takeStep],
  );

  const actLoan = useCallback(
    async (loan: Loan, action: LoanAction, detail: { due?: number | null; reason?: string } = {}) => {
      // Whatever the page still says about this loan, the reader is answering it now.
      unsay(aboutLoan(loan.id));
      unsay(aboutDue(loan.id));
      try {
        // A loan that was put away is gone from the list. Any other stays where it stood, as it is now.
        takeStep(await api.loanAct(loan.id, action, detail.due, detail.reason), action === "hide");
      } finally {
        await sync(true);
      }
    },
    [api, sync, takeStep, unsay],
  );

  const restoreVersion = useCallback(
    async (revision: number) => {
      // What the reader changed last has to be on the server first. The server keeps the
      // library it replaces as an earlier version, and only what was saved is in it: a
      // change that is still waiting here would be gone without a word.
      if (!(await store.settled())) {
        await store.flush();
        if (!(await store.settled())) throw new ServerError("unsaved");
      }
      await api.restore(revision);
      await store.reread();
      // The books follow the loans as they stand today, not as they stood when that version was saved.
      if (loansRef.current) bringInLine(loansRef.current);
    },
    [api, store, bringInLine],
  );

  const value = useMemo<Library>(
    () => ({
      vault: state.vault,
      prefs,
      mutate,
      status: state.status,
      revision: state.revision,
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
      restoreVersion,
      notify,
      notifyOffer: telling.offer,
      allowNotifications: telling.allowNotifications,
      putNotifyOfferAway: telling.putOfferAway,
    }),
    [state, prefs, mutate, retry, settled, profile, setName, newCode, friends, libraries, friendsBusy, friendsProblem, lastSync, syncFriends, addFriend, removeFriend, loans, askLoan, actLoan, restoreVersion, notify, telling.offer, telling.allowNotifications, telling.putOfferAway],
  );

  return (
    <Context.Provider value={value}>
      {children}
      <Notices notices={telling.notices} onFollow={telling.dismiss} />
    </Context.Provider>
  );
}
