// Keeps the library in memory in step with the one on the server.
//
// Saving works by revision (supabase/README.md): a save names the revision it started
// from, and the server refuses it with "conflict" when somebody else, the phone for
// instance, saved in the meantime. Then the fresh document is fetched, the same changes
// are applied to it again, and the save is tried once more.

import type { Vault } from "./model.ts";
import { emptyVault, looksLikeVault, readVault, writeVault } from "./model.ts";
import type { Change } from "./mutations.ts";

export interface PullAnswer {
  revision: number;
  payload: unknown;
}

/** The two server functions the store needs. A refusal is thrown as a ServerError. */
export interface VaultApi {
  pull(known: number): Promise<PullAnswer>;
  push(payload: Record<string, unknown>, expected: number): Promise<{ revision: number }>;
}

/** Why the server (or the way to it) did not do what was asked. */
export class ServerError extends Error {
  reason: string;
  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "ServerError";
    this.reason = reason;
  }
}

export type SaveStatus = "loading" | "idle" | "saving" | "saved" | "error" | "failed";

export interface VaultState {
  /** The library as the reader sees it: what the server has, plus what is not saved yet. */
  vault: Vault;
  revision: number;
  status: SaveStatus;
  /** Why the last save or load did not work, when status is "error" or "failed". */
  problem: string | null;
  /** How many changes still wait to be saved. */
  pending: number;
}

interface Options {
  /** Called after every save that went through, with the document the server now holds. */
  onSaved?: (vault: Vault) => void;
  /** How often a save is tried again right away when somebody else keeps saving in between. */
  maxConflicts?: number;
  now?: () => number;
}

export class VaultStore {
  private api: VaultApi;
  private options: Options;
  /** What the server holds, as far as this tab knows. */
  private base: Vault = emptyVault();
  private revision = 0;
  /** Changes the reader made that the server has not confirmed yet, oldest first. */
  private pending: Change[] = [];
  private status: SaveStatus = "loading";
  private problem: string | null = null;
  private flushing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: VaultState;

  constructor(api: VaultApi, options: Options = {}) {
    this.api = api;
    this.options = options;
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): VaultState => this.snapshot;

  private makeSnapshot(): VaultState {
    return {
      vault: this.pending.reduce((doc, change) => change(doc), this.base),
      revision: this.revision,
      status: this.status,
      problem: this.problem,
      pending: this.pending.length,
    };
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    for (const listener of Array.from(this.listeners)) listener();
  }

  private take(answer: PullAnswer): void {
    if (answer.payload !== null && answer.payload !== undefined) {
      this.base = looksLikeVault(answer.payload) ? readVault(answer.payload) : emptyVault();
      this.revision = answer.revision;
    } else if (answer.revision === 0) {
      // An account that never saved anything starts with an empty library.
      this.base = emptyVault();
      this.revision = 0;
    }
    // A revision without its document is no news: there is nothing to go with the number.
  }

  /** The first fetch after signing in. */
  async load(): Promise<void> {
    this.status = "loading";
    this.problem = null;
    this.publish();
    try {
      this.take(await this.api.pull(0));
      this.status = "idle";
    } catch (error) {
      this.status = "failed";
      this.problem = reasonOf(error);
    }
    this.publish();
    if (this.status === "idle" && this.pending.length > 0) void this.flush();
  }

  /** Asks the server whether anything changed, which is cheap when nothing did. */
  async refresh(): Promise<void> {
    if (this.status === "loading" || this.status === "failed") return;
    // While a save is on its way it brings the news back by itself.
    if (this.flushing) return;
    const asked = this.revision;
    try {
      const answer = await this.api.pull(asked);
      // A save that started or finished meanwhile knows more than this answer does.
      if (this.flushing || this.revision !== asked) return;
      if (answer.revision !== asked) {
        this.take(answer);
        this.publish();
      }
      if (this.pending.length > 0) void this.flush();
    } catch {
      // No connection right now. The next look, or the next change, tries again.
    }
  }

  /** The one way to change the library: shown at once, then saved. */
  mutate(change: Change): Promise<void> {
    this.pending.push(change);
    if (this.status !== "loading" && this.status !== "failed") this.status = "saving";
    this.publish();
    if (this.status === "loading" || this.status === "failed") return Promise.resolve();
    return this.flush();
  }

  /** Saves whatever waits. Runs once at a time, further changes join the running save. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.run().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  /** Resolves once nothing waits to be saved any more, or the saving has given up for now. */
  async settled(): Promise<boolean> {
    while (this.flushing) await this.flushing;
    return this.pending.length === 0;
  }

  private async run(): Promise<void> {
    const maxConflicts = this.options.maxConflicts ?? 5;
    let conflicts = 0;
    while (this.pending.length > 0) {
      this.status = "saving";
      this.problem = null;
      this.publish();
      const count = this.pending.length;
      const document: Vault = { ...this.pending.slice(0, count).reduce((doc, change) => change(doc), this.base), exportedAt: (this.options.now ?? Date.now)() };
      try {
        const answer = await this.api.push(writeVault(document), this.revision);
        this.base = document;
        this.revision = answer.revision;
        this.pending = this.pending.slice(count);
        conflicts = 0;
        this.status = this.pending.length > 0 ? "saving" : "saved";
        this.publish();
        this.options.onSaved?.(document);
      } catch (error) {
        const reason = reasonOf(error);
        if (reason === "conflict" && conflicts < maxConflicts) {
          conflicts++;
          try {
            // Somebody else saved first. Their document is the new ground the changes are applied to.
            this.take(await this.api.pull(0));
            this.publish();
            continue;
          } catch (pullError) {
            this.status = "error";
            this.problem = reasonOf(pullError);
            this.publish();
            return;
          }
        }
        // The changes stay where they are and are tried again later. Nothing typed is lost.
        this.status = "error";
        this.problem = reason;
        this.publish();
        return;
      }
    }
  }
}

export function reasonOf(error: unknown): string {
  if (error instanceof ServerError) return error.reason;
  return "network";
}
