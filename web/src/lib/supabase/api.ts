// The calls the website makes to the server, see supabase/README.md. Everything goes
// through the functions named shelfmark_*, which act for the signed-in account only.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VaultVersion } from "../history.ts";
import { readVersions } from "../history.ts";
import type { Loan, LoanAction, LoanBook } from "../loans.ts";
import { readLoan } from "../loans.ts";
import type { PullAnswer, VaultApi } from "../sync.ts";
import { ServerError } from "../sync.ts";
import type { ServerConfig } from "./config.ts";
import { rpcError } from "./errors.ts";

const clients = new Map<string, SupabaseClient>();

/** One client per server for the whole page: two of them would fight over the same remembered sign-in. */
export function makeClient(config: ServerConfig): SupabaseClient {
  const id = `${config.url}|${config.key}`;
  let client = clients.get(id);
  if (!client) {
    client = createClient(config.url, config.key, {
      // The sign-in behind the link of a mail is taken by the site itself (components/auth.tsx).
      // Left to the client, the address with the sign-in in it would stay in the history
      // of the browser, and the Back button would play the link again.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "shelfmark.auth" },
    });
    clients.set(id, client);
  }
  return client;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Calls one of the functions. A refusal, or no connection, is thrown as a ServerError. */
export async function call(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  let answer;
  try {
    answer = await client.rpc(name, args);
  } catch (error) {
    throw new ServerError("network", error instanceof Error ? error.message : undefined);
  }
  if (answer.error) throw rpcError(answer.error, answer.status);
  return asObject(answer.data);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) => (typeof value === "number" ? value : 0);

export interface Profile {
  id: string;
  code: string;
  name: string;
}

/** The loan a call answered with. An answer that is none means the server speaks another language than this page. */
function loanFrom(answer: Record<string, unknown>): Loan {
  const loan = readLoan(answer);
  if (!loan) throw new ServerError("setup");
  return loan;
}

export function makeApi(client: SupabaseClient) {
  const vault: VaultApi = {
    async pull(known: number): Promise<PullAnswer> {
      const answer = await call(client, "shelfmark_vault_pull", { p_known: known });
      return { revision: number(answer.revision), payload: answer.payload ?? null };
    },
    async push(payload, expected) {
      const answer = await call(client, "shelfmark_vault_push", { p_payload: payload, p_expected: expected });
      return { revision: number(answer.revision) };
    },
  };
  return {
    vault,
    async ping(): Promise<void> {
      await call(client, "shelfmark_ping");
    },
    /** Says hello after signing in. Creates the profile on first use, and sets the name when one is given. */
    async hello(name?: string): Promise<Profile> {
      const answer = await call(client, "shelfmark_hello", name === undefined ? {} : { p_name: name });
      return { id: text(answer.id), code: text(answer.code), name: text(answer.name) };
    },
    async newCode(): Promise<string> {
      return text((await call(client, "shelfmark_new_code")).code);
    },
    async addFriend(code: string): Promise<{ id: string; name: string }> {
      const answer = await call(client, "shelfmark_add_friend", { p_code: code });
      return { id: text(answer.id), name: text(answer.name) };
    },
    async removeFriend(friendId: string): Promise<void> {
      await call(client, "shelfmark_remove_friend", { p_friend: friendId });
    },
    async publish(library: Record<string, unknown>): Promise<void> {
      await call(client, "shelfmark_publish", { p_library: library });
    },
    async sync(known: Record<string, number>): Promise<Record<string, unknown>> {
      return call(client, "shelfmark_sync", { p_known: known });
    },
    /**
     * Asks a friend for a book. [bookId] is the id of the book in the friend's library,
     * [info] what the asker sees of it. Asking again for the same book gives back the
     * question that is still open. Refused with "taken" when the book is reserved or out.
     */
    async loanAsk(friend: string, bookId: number, info: LoanBook, note: string): Promise<Loan> {
      return loanFrom(await call(client, "shelfmark_loan_ask", { p_friend: friend, p_book: bookId, p_info: info, p_note: note }));
    },
    /**
     * One step in the life of a loan. [due] counts for "agree" and "set_due" only: a day,
     * or null for no fixed date. Refused with "not_allowed" when the loan has moved on.
     */
    async loanAct(loanId: string, action: LoanAction, due?: number | null, reason?: string): Promise<Loan> {
      const args: Record<string, unknown> = { p_loan: loanId, p_action: action };
      if (action === "agree" || action === "set_due") args.p_due = due ?? null;
      if (reason !== undefined && reason.trim() !== "") args.p_reason = reason.trim();
      return loanFrom(await call(client, "shelfmark_loan_act", args));
    },
    /** The earlier versions of the library that the server keeps, the newest first. Refused with "setup" by a server that keeps none yet. */
    async history(): Promise<VaultVersion[]> {
      return readVersions(await call(client, "shelfmark_vault_history"));
    },
    /**
     * Makes an earlier version the library again, as a new revision. The server keeps the
     * library it replaces in turn. Refused with "unknown_version" when that version is
     * no longer kept.
     */
    async restore(revision: number): Promise<number> {
      return number((await call(client, "shelfmark_vault_restore", { p_revision: revision })).revision);
    },
    async deleteAccount(): Promise<{ loginKept: boolean }> {
      const answer = await call(client, "shelfmark_delete_account");
      return { loginKept: answer.login_kept === true };
    },
  };
}

export type Api = ReturnType<typeof makeApi>;
