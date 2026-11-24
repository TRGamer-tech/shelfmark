// What a look at the server has to tell the reader: a step of the other side in a loan,
// a friend who joined by the reader's code, a book that is due. Each is told once per
// browser. The rules are kept apart from the page so that they can be tested by
// themselves, see "Friends who join" and "Notifications" in supabase/README.md.

import type { Loan, LoanMemory, LoanNotices } from "./loans.ts";
import { dueLine, isDue, readSeen, rememberStep, takeLoanAnswer } from "./loans.ts";
import type { ServerFriend } from "./social.ts";

/**
 * What a browser remembers of the news it has told. All its windows share this, and it
 * goes when the reader signs out.
 */
export interface NewsMemory extends LoanMemory {
  /**
   * The friends this browser has seen. Null while it never looked at them: everybody
   * who is there at the first look is taken as seen, and is no news.
   */
  friends: string[] | null;
  /** For each loan the reader was reminded of: the day it was due on then. Another day is another reminder. */
  due: Record<string, number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads what the browser remembered. Null when it remembered nothing that can be read. */
export function readNewsMemory(remembered: string | null): NewsMemory | null {
  const loans = readSeen(remembered);
  if (loans === null || remembered === null) return null;
  // Read once more for the parts the loans know nothing of. It is the same text, and it parsed a moment ago.
  const raw = JSON.parse(remembered) as unknown;
  const source = isObject(raw) ? raw : {};
  const friends = Array.isArray(source.friends) ? source.friends.filter((id): id is string => typeof id === "string") : null;
  const due: Record<string, number> = {};
  if (isObject(source.due)) {
    for (const [id, day] of Object.entries(source.due)) if (typeof day === "number" && Number.isFinite(day)) due[id] = day;
  }
  return { ...loans, friends, due };
}

/** What a look at the server brings: how things stand there, and when the server said so. */
export interface Answer {
  loans: Loan[];
  friends: ServerFriend[];
  time: number;
}

/** What follows from an answer. */
export interface NewsLook {
  /** The answer is older than what the browser has seen already. Nothing follows from it. */
  late: boolean;
  memory: NewsMemory;
  /** Steps in loans: what to say, and what to take back. */
  loans: LoanNotices;
  /** Friends who came by the reader's code and were not there when this browser last looked. */
  joined: ServerFriend[];
  /** Friends who are gone. What was said about their coming is taken back. */
  left: string[];
  /** Books that are due and were not told for the day they were due on. */
  due: Loan[];
  /** Loans a reminder was given for that are not due any more. The reminder is taken back. */
  settled: string[];
}

/**
 * Takes an answer of the server against what the browser remembers, and says what is
 * news. The same care as for loans (takeLoanAnswer) goes for all of it:
 *
 * - The first look after signing in tells no news about loans and friends. Everybody
 *   and everything that is there is taken as seen.
 * - An answer that is older than what the browser has seen already changes nothing.
 *   Two looks can cross, in one window or in two, and remembering the older one would
 *   make told news new again.
 * - A friend is news once: when `joined` says that they came by the reader's code and
 *   this browser has not seen them before. Whoever the reader added themselves is not.
 * - A book that is due is told once for the day it was due on, also at the first look:
 *   that is no step of the other side that could have been missed, it is how things
 *   stand today. The Android app reminds by the same rule (ServerSync.take).
 */
export function takeAnswer(memory: NewsMemory | null, answer: Answer, today: number): NewsLook {
  const loans = takeLoanAnswer(memory, answer.loans, answer.time);
  const nothing = { loans: loans.notices, joined: [], left: [], due: [], settled: [] };
  if (loans.late && memory) return { late: true, memory, ...nothing };

  const seen = memory?.friends ?? null;
  const there = answer.friends.map((friend) => friend.id);
  const joined = seen === null ? [] : answer.friends.filter((friend) => friend.joined && !seen.includes(friend.id));
  const left = seen === null ? [] : seen.filter((id) => !there.includes(id));

  const told = memory?.due ?? {};
  const dueNow = answer.loans.filter((loan) => isDue(loan, today));
  const due = dueNow.filter((loan) => told[loan.id] !== loan.dueOn);
  const remembered: Record<string, number> = {};
  for (const loan of dueNow) if (loan.dueOn !== null) remembered[loan.id] = loan.dueOn;
  const settled = Object.keys(told).filter((id) => !(id in remembered));

  return { late: false, memory: { ...loans.memory, friends: there, due: remembered }, loans: loans.notices, joined, left, due, settled };
}

/**
 * The reader took a step in a loan themselves (rememberStep): only what is remembered
 * of this loan changes. A reminder that it is due goes with it when the step ended
 * that: the book is back, or it is wanted back by a later day.
 */
export function rememberNewsStep(memory: NewsMemory | null, loan: Loan, gone: boolean, today: number): NewsMemory | null {
  const loans = rememberStep(memory, loan, gone);
  if (memory === null || loans === null) return null;
  const due = { ...memory.due };
  if (gone || !isDue(loan, today) || due[loan.id] !== loan.dueOn) delete due[loan.id];
  return { ...loans, friends: memory.friends, due };
}

/** The reader added a friend by typing their code. Nobody has to tell them of that friend. */
export function rememberFriend(memory: NewsMemory | null, friendId: string): NewsMemory | null {
  if (memory === null || memory.friends === null || memory.friends.includes(friendId)) return memory;
  return { ...memory, friends: [...memory.friends, friendId] };
}

// ---- what is said ----

/** A text by its name, with what fills its gaps. A day is written out by the page, in the reader's language. */
export interface Words {
  key: string;
  args: (string | { day: number })[];
}

/**
 * One piece of news, ready to be said in the page and, when the page is not in front,
 * by the browser. Names of texts and not texts: the page says them in its language.
 */
export interface News {
  /** What it is about. A later piece of news about the same thing takes its place, and it goes when that thing is dealt with. */
  about: string;
  title: Words;
  /** A second line, for both places. */
  detail?: Words;
  /** A second line that only a notification of the browser carries: it speaks to somebody who is not on the page. */
  away?: Words;
  /** Where it leads. */
  href: string;
}

export const LOANS_PAGE = "/friends/loans";
export const FRIENDS_PAGE = "/friends";

export function aboutLoan(loanId: string): string {
  return `loan:${loanId}`;
}

export function aboutDue(loanId: string): string {
  return `due:${loanId}`;
}

export function aboutFriend(friendId: string): string {
  return `friend:${friendId}`;
}

/** The loan news that ask the reader for a tap: a question to answer, a handover or a return to confirm. */
const ASKS_FOR_A_TAP = ["notify_loan_asked", "notify_loan_handed", "notify_loan_given_back"];

/**
 * Everything a look has to say, in the order it is said: loans first, then who joined,
 * then what is due. [someone] stands for a friend who never gave themselves a name.
 */
export function newsOf(look: NewsLook, today: number, someone: string): News[] {
  const name = (given: string) => (given.trim() !== "" ? given : someone);
  const news: News[] = [];
  for (const { loan, key } of look.loans.say) {
    const step: News = { about: aboutLoan(loan.id), title: { key, args: [name(loan.peerName), loan.book.title] }, href: LOANS_PAGE };
    if (ASKS_FOR_A_TAP.includes(key)) step.away = { key: "notify_loan_confirm", args: [] };
    news.push(step);
  }
  for (const friend of look.joined) {
    news.push({ about: aboutFriend(friend.id), title: { key: "notify_friend_joined", args: [name(friend.name)] }, detail: { key: "notify_friend_joined_text", args: [] }, href: FRIENDS_PAGE });
  }
  for (const loan of look.due) {
    const reminder: News = {
      about: aboutDue(loan.id),
      title: { key: loan.role === "lender" ? "notify_due_lender" : "notify_due_borrower", args: [name(loan.peerName), loan.book.title] },
      href: LOANS_PAGE,
    };
    // The line the loan itself shows about its day: "Due back today", or since when it is late.
    const line = dueLine(loan, today);
    if (line) reminder.detail = { key: line.key, args: line.day === null ? [] : [{ day: line.day }] };
    news.push(reminder);
  }
  return news;
}

/** What is taken back by a look: every notice and notification about these things goes. */
export function unsaidOf(look: NewsLook): string[] {
  return [...look.loans.unsay.map(aboutLoan), ...look.left.map(aboutFriend), ...look.settled.map(aboutDue)];
}
