// What is news, and that it is told once per browser (src/lib/news.ts): a step in a
// loan, a friend who joined by the reader's code, a book that is due. See "Friends who
// join" and "Notifications" in supabase/README.md.

import assert from "node:assert/strict";
import { test } from "node:test";
import { toEpochDay } from "../src/lib/dates.ts";
import type { Loan, LoanState } from "../src/lib/loans.ts";
import { readLoan } from "../src/lib/loans.ts";
import type { NewsMemory } from "../src/lib/news.ts";
import { FRIENDS_PAGE, LOANS_PAGE, aboutDue, aboutFriend, aboutLoan, newsOf, readNewsMemory, rememberFriend, rememberNewsStep, takeAnswer, unsaidOf } from "../src/lib/news.ts";
import type { ServerFriend } from "../src/lib/social.ts";
import { readSyncAnswer } from "../src/lib/social.ts";

const ANNA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const CLARA = "33333333-3333-4333-8333-333333333333";
const L1 = "3f2a9c1e-7b4d-4e8a-9c0d-112233445566";
const L2 = "0000000a-bcde-4f01-8234-56789abcdef0";
const DAY = toEpochDay(2026, 11, 24);

function loan(fields: Partial<Loan> = {}): Loan {
  return {
    ...readLoan({ id: L1, role: "lender", peer: BEN, peerName: "Ben", bookId: 7, book: { title: "Emma" }, state: "on_loan", dueOn: null, askedAt: 1, updatedAt: 100, byMe: false })!,
    ...fields,
  };
}
const out = (dueOn: number | null, more: Partial<Loan> = {}) => loan({ state: "on_loan", dueOn, ...more });
const friend = (id: string, name: string, joined: boolean): ServerFriend => ({ id, name, joined, since: 1 });

/** A browser as the page uses these rules: it remembers, and it counts what it was told. */
function browser() {
  let memory: NewsMemory | null = null;
  const told: string[] = [];
  const untold: string[] = [];
  return {
    look(answer: { loans?: Loan[]; friends?: ServerFriend[]; time: number }, today = DAY) {
      const look = takeAnswer(memory, { loans: answer.loans ?? [], friends: answer.friends ?? [], time: answer.time }, today);
      if (look.late) return false;
      memory = look.memory;
      for (const news of newsOf(look, today, "Someone")) told.push(`${news.title.key} ${news.about}`);
      untold.push(...unsaidOf(look));
      return true;
    },
    told,
    untold,
    get memory() {
      return memory;
    },
    set memory(next: NewsMemory | null) {
      memory = next;
    },
  };
}

test("the answer of the server says who came by whose code", () => {
  const answer = readSyncAnswer({ id: ANNA, time: 5, friends: [{ id: BEN, name: "Ben", joined: true, since: 1795140800000 }, { id: CLARA, name: "Clara", joined: false, since: 3 }, { id: "x", name: "Old" }] });
  assert.deepEqual(answer.friends, [
    { id: BEN, name: "Ben", joined: true, since: 1795140800000 },
    { id: CLARA, name: "Clara", joined: false, since: 3 },
    // A server from before this says nothing about it: nobody is taken to have joined.
    { id: "x", name: "Old", joined: false, since: 0 },
  ]);
});

test("a friend who joins by my code is news once, and the first look after signing in tells none", () => {
  const me = browser();
  // Signed in, first look: Ben is there already, and joined by my code long ago. No news.
  me.look({ friends: [friend(BEN, "Ben", true)], time: 100 });
  assert.deepEqual(me.told, []);
  assert.deepEqual(me.memory?.friends, [BEN]);
  // Clara types in my code.
  me.look({ friends: [friend(BEN, "Ben", true), friend(CLARA, "Clara", true)], time: 200 });
  assert.deepEqual(me.told, [`notify_friend_joined ${aboutFriend(CLARA)}`]);
  // Every later look finds her there, and has nothing to say.
  for (const time of [210, 300, 300]) me.look({ friends: [friend(BEN, "Ben", true), friend(CLARA, "Clara", true)], time });
  assert.equal(me.told.length, 1);
});

test("whoever the reader adds themselves is not told to them", () => {
  const me = browser();
  me.look({ friends: [], time: 100 });
  // I typed in Ben's code, on this device or another: on my side he did not "join".
  me.look({ friends: [friend(BEN, "Ben", false)], time: 200 });
  assert.deepEqual(me.told, []);
  // Added in this very browser, he is taken as seen before the next look, whatever that look says.
  const typed = browser();
  typed.look({ friends: [], time: 100 });
  typed.memory = rememberFriend(typed.memory, CLARA);
  typed.look({ friends: [friend(CLARA, "Clara", true)], time: 200 });
  assert.deepEqual(typed.told, []);
  assert.equal(rememberFriend(null, CLARA), null);
  assert.equal(rememberFriend(typed.memory, CLARA), typed.memory);
});

test("an answer about friends that comes in late does not announce anybody again", () => {
  const first = browser();
  const second = browser();
  first.look({ friends: [], time: 100 });
  // The first window sees Clara join and tells of it.
  first.look({ friends: [friend(CLARA, "Clara", true)], time: 300 });
  // The second window asked before she came and is answered after: nothing is taken from that.
  second.memory = first.memory;
  assert.equal(second.look({ friends: [], time: 200 }), false);
  assert.deepEqual(second.memory, first.memory);
  // So neither window announces her at its next look.
  first.memory = second.memory;
  first.look({ friends: [friend(CLARA, "Clara", true)], time: 400 });
  second.memory = first.memory;
  second.look({ friends: [friend(CLARA, "Clara", true)], time: 410 });
  assert.deepEqual(first.told, [`notify_friend_joined ${aboutFriend(CLARA)}`]);
  assert.deepEqual(second.told, []);
});

test("a friend who is gone takes the notice along, and coming back is news again", () => {
  const me = browser();
  me.look({ friends: [], time: 100 });
  me.look({ friends: [friend(CLARA, "Clara", true)], time: 200 });
  me.look({ friends: [], time: 300 });
  assert.deepEqual(me.untold, [aboutFriend(CLARA)]);
  me.look({ friends: [friend(CLARA, "Clara", true)], time: 400 });
  assert.equal(me.told.length, 2);
});

test("a browser that remembered loans before friends were kept takes everybody as seen", () => {
  // What the website wrote before this: the loans and the time, nothing about friends or due books.
  const before = readNewsMemory(JSON.stringify({ time: 100, loans: { [L1]: { at: 100, state: "on_loan", dueOn: null } } }));
  assert.deepEqual(before, { time: 100, loans: { [L1]: { at: 100, state: "on_loan", dueOn: null } }, friends: null, due: {} });
  const me = browser();
  me.memory = before;
  me.look({ loans: [out(null)], friends: [friend(BEN, "Ben", true)], time: 200 });
  assert.deepEqual(me.told, []);
  assert.deepEqual(me.memory?.friends, [BEN]);
  // And older still, or nothing, or nonsense.
  assert.deepEqual(readNewsMemory(JSON.stringify({ [L1]: { at: 1, state: "asked" } })), { time: 0, loans: { [L1]: { at: 1, state: "asked", dueOn: null } }, friends: null, due: {} });
  assert.equal(readNewsMemory(null), null);
  assert.equal(readNewsMemory("not json"), null);
  // What was written is read back, and what cannot be read of it is left out.
  const written = { time: 7, loans: {}, friends: [BEN, 5, CLARA], due: { [L1]: DAY, [L2]: "soon" } };
  assert.deepEqual(readNewsMemory(JSON.stringify(written)), { time: 7, loans: {}, friends: [BEN, CLARA], due: { [L1]: DAY } });
});

test("a book that is due is told once for the day it was due on", () => {
  const me = browser();
  // Not due yet: nothing, also at the first look.
  me.look({ loans: [out(DAY + 1)], time: 100 }, DAY);
  assert.deepEqual(me.told, []);
  // The day comes while the page stays open. The look of that day tells it, once.
  me.look({ loans: [out(DAY + 1)], time: 200 }, DAY + 1);
  me.look({ loans: [out(DAY + 1)], time: 210 }, DAY + 1);
  assert.deepEqual(me.told, [`notify_due_lender ${aboutDue(L1)}`]);
  // The days after it are no new reminder: it was told for the day it was due on.
  me.look({ loans: [out(DAY + 1)], time: 300 }, DAY + 5);
  assert.equal(me.told.length, 1);
  // Another day is another reminder, once that one has come.
  me.look({ loans: [out(DAY + 6, { updatedAt: 400, byMe: true })], time: 410 }, DAY + 5);
  assert.ok(me.untold.includes(aboutDue(L1)), "the old reminder is taken back when the book is no longer due");
  me.look({ loans: [out(DAY + 6, { updatedAt: 400, byMe: true })], time: 500 }, DAY + 6);
  assert.equal(me.told.length, 2, "another day, another reminder");
});

test("only a book that is out can be due, for the lender and for the borrower", () => {
  for (const state of ["asked", "agreed", "handed", "returned", "declined", "withdrawn", "cancelled"] as LoanState[]) {
    const me = browser();
    me.look({ loans: [loan({ state, dueOn: DAY - 3 })], time: 100 });
    assert.deepEqual(me.told, [], state);
  }
  const borrower = browser();
  borrower.look({ loans: [loan({ role: "borrower", state: "given_back", dueOn: DAY })], time: 100 });
  assert.deepEqual(borrower.told, [`notify_due_borrower ${aboutDue(L1)}`]);
  // No fixed date is never due.
  const open = browser();
  open.look({ loans: [out(null)], time: 100 });
  assert.deepEqual(open.told, []);
});

test("a reminder is given at the first look too, and not again by an answer that comes in late", () => {
  // Unlike a step of the other side, a due book is no news that could have been missed: it is how things stand.
  const first = browser();
  first.look({ loans: [out(DAY - 2)], time: 300 });
  assert.deepEqual(first.told, [`notify_due_lender ${aboutDue(L1)}`]);
  assert.deepEqual(first.memory?.due, { [L1]: DAY - 2 });
  const second = browser();
  second.memory = first.memory;
  assert.equal(second.look({ loans: [out(DAY - 2)], time: 200 }), false);
  second.look({ loans: [out(DAY - 2)], time: 400 });
  assert.deepEqual(second.told, []);
});

test("the reader's own step takes the reminder along when it ends what was due", () => {
  const due = { time: 300, loans: { [L1]: { at: 100, state: "given_back" as LoanState, dueOn: DAY - 2 } }, friends: [BEN], due: { [L1]: DAY - 2 } };
  // "I have it back": over, and nothing is due.
  assert.deepEqual(rememberNewsStep(due, loan({ state: "returned", dueOn: DAY - 2, updatedAt: 400, byMe: true }), false, DAY)?.due, {});
  // Another day, later: not due now. The same day once more would be told again when it comes.
  assert.deepEqual(rememberNewsStep(due, out(DAY + 7, { updatedAt: 400, byMe: true }), false, DAY)?.due, {});
  // A step that leaves it due leaves the reminder told, and the friends as they were.
  const still = rememberNewsStep(due, loan({ state: "on_loan", dueOn: DAY - 2, updatedAt: 400, byMe: true }), false, DAY);
  assert.deepEqual(still?.due, { [L1]: DAY - 2 });
  assert.deepEqual(still?.friends, [BEN]);
  assert.equal(still?.time, 400);
  assert.deepEqual(still?.loans[L1], { at: 400, state: "on_loan", dueOn: DAY - 2 });
  // Put away: forgotten altogether.
  assert.deepEqual(rememberNewsStep(due, loan({ state: "returned", updatedAt: 500 }), true, DAY), { time: 500, loans: {}, friends: [BEN], due: {} });
  assert.equal(rememberNewsStep(null, out(DAY), false, DAY), null);
});

test("each piece of news says what it is about, in which words, and where it leads", () => {
  const memory: NewsMemory = { time: 100, loans: { [L1]: { at: 50, state: "agreed", dueOn: null }, [L2]: { at: 40, state: "on_loan", dueOn: DAY - 2 } }, friends: [], due: {} };
  const handed = loan({ role: "borrower", peer: ANNA, peerName: "Anna", state: "handed", updatedAt: 200 });
  const late = out(DAY - 2, { id: L2, peerName: "", updatedAt: 40 });
  const look = takeAnswer(memory, { loans: [handed, late], friends: [friend(CLARA, "", true)], time: 300 }, DAY);
  assert.deepEqual(newsOf(look, DAY, "Someone"), [
    // A step that waits for the reader's own word: the notification says so, the page does not have to.
    { about: aboutLoan(L1), title: { key: "notify_loan_handed", args: ["Anna", "Emma"] }, away: { key: "notify_loan_confirm", args: [] }, href: LOANS_PAGE },
    // A friend without a name is "Someone", with the hint that they can be removed.
    { about: aboutFriend(CLARA), title: { key: "notify_friend_joined", args: ["Someone"] }, detail: { key: "notify_friend_joined_text", args: [] }, href: FRIENDS_PAGE },
    // The reminder carries the line the loan itself shows about its day.
    { about: aboutDue(L2), title: { key: "notify_due_lender", args: ["Someone", "Emma"] }, detail: { key: "loan_due_over", args: [{ day: DAY - 2 }] }, href: LOANS_PAGE },
  ]);
  // News that asks for nothing has no second line for the notification.
  const agreed = takeAnswer({ ...memory, loans: { [L1]: { at: 50, state: "asked", dueOn: null } } }, { loans: [loan({ role: "borrower", state: "agreed", updatedAt: 200 })], friends: [], time: 300 }, DAY);
  assert.equal(newsOf(agreed, DAY, "Someone")[0].away, undefined);
  // Due today reads "Due back today", which names no day.
  const today = takeAnswer(memory, { loans: [loan({ role: "borrower", state: "agreed", updatedAt: 50 }), out(DAY, { id: L2, updatedAt: 40 })], friends: [], time: 300 }, DAY);
  assert.deepEqual(newsOf(today, DAY, "Someone").at(-1)?.detail, { key: "loan_due_today", args: [] });
  // What a look takes back: loans the reader acted on or that are gone, friends who left, reminders that are settled.
  const gone = takeAnswer({ time: 100, loans: { [L1]: { at: 50, state: "handed", dueOn: null } }, friends: [CLARA], due: { [L2]: DAY - 2 } }, { loans: [], friends: [], time: 300 }, DAY);
  assert.deepEqual(unsaidOf(gone), [aboutLoan(L1), aboutFriend(CLARA), aboutDue(L2)]);
  // A loan, its reminder and a friend are three different things, also with the same id.
  assert.equal(new Set([aboutLoan(L1), aboutDue(L1), aboutFriend(L1)]).size, 3);
});
