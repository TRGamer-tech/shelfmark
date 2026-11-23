// The calls the website makes to the server, see supabase/README.md. Everything goes
// through the functions named shelfmark_*, which act for the signed-in account only.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
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
    async send(to: string, payload: Record<string, unknown>): Promise<void> {
      await call(client, "shelfmark_send", { p_to: to, p_payload: payload });
    },
    async sync(known: Record<string, number>, ack: string[]): Promise<Record<string, unknown>> {
      return call(client, "shelfmark_sync", { p_known: known, p_ack: ack });
    },
    async deleteAccount(): Promise<{ loginKept: boolean }> {
      const answer = await call(client, "shelfmark_delete_account");
      return { loginKept: answer.login_kept === true };
    },
  };
}

export type Api = ReturnType<typeof makeApi>;
