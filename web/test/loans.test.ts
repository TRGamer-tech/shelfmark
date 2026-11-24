// Loans between friends: reading them, who may do what, what is news, what waits and
// what is due, and how the books of a library follow the loans. The rules are those of
// supabase/README.md ("Loans"), and the Android app is tested against the same values.

import assert from "node:assert/strict";
import { test } from "node:test";
import { toEpochDay, utcZone } from "../src/lib/dates.ts";
import type { Loan, LoanAction, LoanMemory, LoanNotices, LoanState } from "../src/lib/loans.ts";
import {
  LOAN_STATES,
  actionsFor,
  backByHand,
  dueLine,
  followLoans,
  givenReason,
  heldBookIds,
  hintOf,
  holdsBook,
  isDue,
  isOut,
  isOver,
  lentByHand,
  loanBookId,
  loanNotices,
  loanOf,
  loansAbout,
  myLoanOf,
  nameOnBook,
  newsKey,
  newsOf,
  ownedByHand,
  readLoan,
  readLoans,
  readSeen,
  rememberStep,
  sameAsLoaned,
  sectionOf,
  seenOf,
  standingOf,
  takeLoanAnswer,
  tyingLoan,
  waitingCount,
  waitsForMe,
} from "../src/lib/loans.ts";
import type { SharedBook, Vault } from "../src/lib/model.ts";
import { emptyVault, readVault, sharedBookCodec, writeVault } from "../src/lib/model.ts";
import { addBook, deleteBook, modifyBook } from "../src/lib/mutations.ts";
import type { Notice } from "../src/lib/notices.ts";
import { aboutLoan, withNotice, withoutAbout } from "../src/lib/notices.ts";
import { ServerError, VaultStore } from "../src/lib/sync.ts";
import type { VaultApi } from "../src/lib/sync.ts";
import { book, sample } from "./helpers.ts";

const ANNA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const L1 = "3f2a9c1e-7b4d-4e8a-9c0d-112233445566";
const L2 = "0000000a-bcde-4f01-8234-56789abcdef0";

const DAY = toEpochDay(2026, 11, 24);
const NOON = DAY * 86_400_000 + 12 * 3_600_000;
const NOW = NOON + 5000;

/** A loan as the server hands it out, with what a test says about it. */
function loan(fields: Partial<Loan> = {}): Loan {
  return {
    ...readLoan({
      id: L1,
      role: "lender",
      peer: BEN,
      peerName: "Ben",
      bookId: 7,
      book: { title: "Emma", authors: "Jane Austen", isbn: "9780141439587", coverUrl: "https://example.org/emma.jpg", pageCount: 474, format: "PAPERBACK" },
      note: "",
      state: "asked",
      reason: "",
      dueOn: null,
      askedAt: NOON - 3000,
      updatedAt: NOON - 3000,
      byMe: false,
    })!,
    ...fields,
  };
}

const lent = (state: LoanState, more: Partial<Loan> = {}) => loan({ role: "lender", state, receivedAt: NOON, ...more });
const borrowed = (state: LoanState, more: Partial<Loan> = {}) => loan({ role: "borrower", peer: ANNA, peerName: "Anna", state, receivedAt: NOON, ...more });

const library = (...books: ReturnType<typeof book>[]): Vault => ({ ...emptyVault(), books });
const follow = (loans: Loan[], vault: Vault, shared: (peer: string, bookId: number) => SharedBook | undefined = () => undefined) => followLoans(loans, shared, utcZone, NOW)(vault);

// ---- reading ----

test("a loan is read as the server hands it out", () => {
  const read = readLoan({
    id: L1,
    role: "borrower",
    peer: ANNA,
    peerName: "Anna",
    bookId: 1795439271489008,
    book: { title: "Emma", authors: "Jane Austen", isbn: "9780141439587", coverUrl: "https://example.org/emma.jpg", pageCount: 474, format: "PAPERBACK" },
    note: "For the holidays?",
    state: "on_loan",
    reason: "",
    dueOn: 20800,
    askedAt: 100,
    agreedAt: 200,
    handedAt: 300,
    receivedAt: 400,
    givenBackAt: null,
    closedAt: null,
    updatedAt: 400,
    byMe: true,
  })!;
  assert.equal(read.role, "borrower");
  assert.equal(read.peerName, "Anna");
  assert.equal(read.bookId, 1795439271489008);
  assert.deepEqual(read.book, { title: "Emma", authors: "Jane Austen", isbn: "9780141439587", coverUrl: "https://example.org/emma.jpg", pageCount: 474, format: "PAPERBACK" });
  assert.equal(read.dueOn, 20800);
  assert.equal(read.receivedAt, 400);
  assert.equal(read.givenBackAt, null);
  assert.equal(read.byMe, true);
});

test("what is missing is filled in, and what is no loan is left out", () => {
  const bare = readLoan({ id: L1, role: "lender", state: "asked" })!;
  assert.deepEqual(bare.book, { title: "", authors: "", isbn: "", coverUrl: "", pageCount: 0, format: "UNKNOWN" });
  assert.equal(bare.dueOn, null);
  assert.equal(bare.byMe, false);
  assert.equal(bare.note, "");
  // No id, no side, or a state this website does not know: not shown, rather than shown wrongly.
  assert.equal(readLoan({ role: "lender", state: "asked" }), null);
  assert.equal(readLoan({ id: L1, role: "owner", state: "asked" }), null);
  assert.equal(readLoan({ id: L1, role: "lender", state: "lost" }), null);
  assert.equal(readLoan("loan"), null);
  assert.deepEqual(readLoans(undefined), []);
  assert.deepEqual(readLoans({ id: L1 }), []);
  assert.equal(readLoans([{ id: L1, role: "lender", state: "asked" }, null, { id: L2, role: "lender", state: "nonsense" }]).length, 1);
});

// ---- who may do what ----

test("from every state each side can take exactly the steps the server allows", () => {
  // The table of the contract, side by side. "hide" is for a loan that is over, for either side.
  const allowed: Record<LoanState, { lender: LoanAction[]; borrower: LoanAction[] }> = {
    asked: { lender: ["agree", "decline"], borrower: ["withdraw"] },
    agreed: { lender: ["cancel", "hand", "set_due"], borrower: ["withdraw"] },
    handed: { lender: ["cancel", "set_due", "undo_hand"], borrower: ["not_received", "receive"] },
    on_loan: { lender: ["close", "set_due"], borrower: ["give_back"] },
    given_back: { lender: ["not_returned", "set_due", "take_back"], borrower: ["undo_give_back"] },
    returned: { lender: ["hide"], borrower: ["hide"] },
    declined: { lender: ["hide"], borrower: ["hide"] },
    withdrawn: { lender: ["hide"], borrower: ["hide"] },
    cancelled: { lender: ["hide"], borrower: ["hide"] },
  };
  assert.deepEqual(Object.keys(allowed).sort(), [...LOAN_STATES].sort());
  for (const state of LOAN_STATES) {
    for (const role of ["lender", "borrower"] as const) {
      assert.deepEqual(actionsFor(loan({ role, state })).slice().sort(), allowed[state][role], `${role} in ${state}`);
    }
  }
  // The order is the order of the buttons, and the same as in the Android app (LoanRules.actions).
  const inOrder: Partial<Record<LoanState, { lender: LoanAction[]; borrower: LoanAction[] }>> = {
    asked: { lender: ["agree", "decline"], borrower: ["withdraw"] },
    agreed: { lender: ["hand", "set_due", "cancel"], borrower: ["withdraw"] },
    handed: { lender: ["undo_hand", "set_due", "cancel"], borrower: ["receive", "not_received"] },
    on_loan: { lender: ["close", "set_due"], borrower: ["give_back"] },
    given_back: { lender: ["take_back", "not_returned", "set_due"], borrower: ["undo_give_back"] },
  };
  for (const [state, sides] of Object.entries(inOrder)) {
    for (const role of ["lender", "borrower"] as const) assert.deepEqual(actionsFor(loan({ role, state: state as LoanState })), sides[role], `${role} in ${state}, in order`);
  }
  // Handing over takes the lender first and then the borrower, giving back the borrower first and then the lender.
  assert.equal(actionsFor(lent("agreed"))[0], "hand");
  assert.equal(actionsFor(borrowed("handed"))[0], "receive");
  assert.equal(actionsFor(borrowed("on_loan"))[0], "give_back");
  assert.equal(actionsFor(lent("given_back"))[0], "take_back");
  assert.ok(!actionsFor(borrowed("agreed")).includes("receive"));
  assert.ok(!actionsFor(lent("on_loan")).includes("take_back"));
});

test("the borrower is told who confirms first only while that is the question", () => {
  // The handover while the book is reserved, the return while the book is with them. Nothing in any other state.
  const hints = LOAN_STATES.map((state) => [state, hintOf(borrowed(state))]).filter(([, hint]) => hint !== null);
  assert.deepEqual(hints, [
    ["agreed", "loan_handover_hint"],
    ["on_loan", "loan_return_hint"],
  ]);
  // The lender takes the first step of the handover and the last of the return, and needs no hint for either.
  for (const state of LOAN_STATES) assert.equal(hintOf(lent(state)), null, state);
});

test("a book is reserved from the yes on, and out once the borrower has it", () => {
  const where = (state: LoanState) => [holdsBook(loan({ state })), isOut(loan({ state })), isOver(loan({ state }))];
  assert.deepEqual(where("asked"), [false, false, false]);
  assert.deepEqual(where("agreed"), [true, false, false]);
  assert.deepEqual(where("handed"), [true, false, false]);
  assert.deepEqual(where("on_loan"), [true, true, false]);
  assert.deepEqual(where("given_back"), [true, true, false]);
  for (const state of ["returned", "declined", "withdrawn", "cancelled"] as const) assert.deepEqual(where(state), [false, false, true]);
});

// ---- what waits, what is due, what is news ----

test("waiting for my own word are a question and a return as lender, and a hand-over as borrower", () => {
  const waiting = (role: "lender" | "borrower") => LOAN_STATES.filter((state) => waitsForMe(loan({ role, state })));
  assert.deepEqual(waiting("lender"), ["asked", "given_back"]);
  assert.deepEqual(waiting("borrower"), ["handed"]);
  assert.equal(waitingCount([lent("asked"), lent("agreed"), lent("given_back"), borrowed("handed"), borrowed("asked"), borrowed("returned")]), 3);
  assert.equal(waitingCount([]), 0);
});

test("a loan is due when the book is out and its day is today or past", () => {
  assert.equal(isDue(lent("on_loan", { dueOn: DAY }), DAY), true);
  assert.equal(isDue(borrowed("given_back", { dueOn: DAY - 3 }), DAY), true);
  assert.equal(isDue(lent("on_loan", { dueOn: DAY + 1 }), DAY), false);
  // No fixed date is never due.
  assert.equal(isDue(lent("on_loan", { dueOn: null }), DAY), false);
  // Reserved is not out: the day has not started to count.
  assert.equal(isDue(lent("agreed", { dueOn: DAY - 3 }), DAY), false);
  assert.equal(isDue(lent("handed", { dueOn: DAY - 3 }), DAY), false);
  // A loan that is over is not due any more.
  assert.equal(isDue(lent("returned", { dueOn: DAY - 3 }), DAY), false);
});

test("the day a book is wanted back by is said as it stands", () => {
  assert.deepEqual(dueLine(lent("on_loan", { dueOn: DAY + 5 }), DAY), { key: "loan_due_by", day: DAY + 5, late: false });
  // On the day itself the book is due, not late.
  assert.deepEqual(dueLine(lent("on_loan", { dueOn: DAY }), DAY), { key: "loan_due_today", day: null, late: false });
  assert.deepEqual(dueLine(borrowed("given_back", { dueOn: DAY - 2 }), DAY), { key: "loan_due_over", day: DAY - 2, late: true });
  assert.deepEqual(dueLine(lent("agreed", { dueOn: null }), DAY), { key: "loan_due_open", day: null, late: false });
  // Before the book is out a day that has passed is only a day.
  assert.deepEqual(dueLine(lent("handed", { dueOn: DAY - 2 }), DAY), { key: "loan_due_by", day: DAY - 2, late: false });
  // No day to speak of before the yes and after the end.
  assert.equal(dueLine(lent("asked"), DAY), null);
  assert.equal(dueLine(lent("returned", { dueOn: DAY }), DAY), null);
});

test("news is what the other side did since this browser last looked", () => {
  const seen = seenOf([lent("asked", { updatedAt: 100 })]);
  // The same loan as before: no news.
  assert.deepEqual(newsOf([lent("asked", { updatedAt: 100 })], seen), []);
  // The borrower took the question back.
  const withdrawn = lent("withdrawn", { updatedAt: 200, byMe: false });
  assert.deepEqual(newsOf([withdrawn], seen), [withdrawn]);
  // My own step is never news to me, however new it is.
  assert.deepEqual(newsOf([lent("agreed", { updatedAt: 300, byMe: true })], seen), []);
  // A question that was not there before.
  const other = lent("asked", { id: L2, updatedAt: 50 });
  assert.deepEqual(newsOf([other, lent("asked", { updatedAt: 100 })], seen), [other]);
  // A browser that never looked has no news: what it finds is how things stand.
  assert.deepEqual(newsOf([withdrawn, other], null), []);
  // But one that looked and found nothing does.
  assert.deepEqual(newsOf([other], {}), [other]);
});

test("what this browser saw is remembered as text and read back", () => {
  const seen = seenOf([lent("on_loan", { updatedAt: 100, dueOn: 20800 }), borrowed("asked", { id: L2, updatedAt: 50 })]);
  assert.deepEqual(seen, { [L1]: { at: 100, state: "on_loan", dueOn: 20800 }, [L2]: { at: 50, state: "asked", dueOn: null } });
  // Kept with the server's time of the answer that said so.
  assert.deepEqual(readSeen(JSON.stringify({ time: 120, loans: seen })), { time: 120, loans: seen });
  assert.equal(readSeen(null), null);
  assert.equal(readSeen("not json"), null);
  assert.equal(readSeen("[1,2]"), null);
  // What cannot be read of it is left out, the rest counts.
  assert.deepEqual(readSeen(JSON.stringify({ time: 5, loans: { [L1]: { at: 1, state: "asked" }, bad: { at: "x", state: "asked" }, worse: { at: 1, state: "lost" } } })), { time: 5, loans: { [L1]: { at: 1, state: "asked", dueOn: null } } });
  assert.deepEqual(readSeen(JSON.stringify({ time: 5, loans: {} })), { time: 5, loans: {} });
  // What was written before the time was kept with it: seen at the beginning of time, so every answer is newer.
  assert.deepEqual(readSeen(JSON.stringify(seen)), { time: 0, loans: seen });
  assert.deepEqual(readSeen("{}"), { time: 0, loans: {} });
});

// ---- each step is told once ----

/** A browser as the page uses these rules: what it remembers, and the notices that stand on its page. */
function browser() {
  let memory: LoanMemory | null = null;
  let shown: Notice[] = [];
  let count = 0;
  const said: string[] = [];
  const apply = (notices: LoanNotices) => {
    for (const id of notices.unsay) shown = withoutAbout(shown, aboutLoan(id));
    for (const { loan, key } of notices.say) {
      said.push(`${key} ${loan.id}`);
      shown = withNotice(shown, { id: ++count, text: `${key} ${loan.id}`, about: aboutLoan(loan.id) });
    }
  };
  return {
    /** A look at the server, answered at [time]. */
    look(loans: Loan[], time: number) {
      const taken = takeLoanAnswer(memory, loans, time);
      if (taken.late) return false;
      memory = taken.memory;
      apply(taken.notices);
      return true;
    },
    /** A step of the reader's own, as the server answers it. */
    step(loan: Loan, gone = false) {
      shown = withoutAbout(shown, aboutLoan(loan.id));
      memory = rememberStep(memory, loan, gone);
    },
    /** Every sentence that was ever put on the page, in order. */
    said,
    /** What stands on the page now. */
    get page() {
      return shown.map((notice) => notice.text);
    },
    get memory() {
      return memory;
    },
    /** Another window of the same browser: it shares what is remembered and has a page of its own. */
    share(other: { memory: LoanMemory | null }) {
      memory = other.memory;
    },
  };
}

test("a step of the other side is told when it is first seen, and at no later look", () => {
  const me = browser();
  const asked = borrowed("asked", { updatedAt: 100, byMe: true });
  // The first look after signing in tells no news, whatever it finds.
  me.look([borrowed("handed", { updatedAt: 90 })], 95);
  assert.deepEqual(me.said, []);
  me.look([asked], 110);
  const agreed = borrowed("agreed", { updatedAt: 200 });
  me.look([agreed], 210);
  assert.deepEqual(me.said, [`notify_loan_agreed ${L1}`]);
  // The look every minute, the look when the window comes to the front, the look after a step somewhere else: nothing new.
  for (const time of [220, 230, 230, 300]) me.look([agreed], time);
  assert.deepEqual(me.said, [`notify_loan_agreed ${L1}`]);
  assert.deepEqual(me.page, [`notify_loan_agreed ${L1}`]);
});

test("a notice does not outlive the reader's answer to it, and a second handover is told once", () => {
  // The case of the picture with two notices: handed over, "I did not get it", handed over again, "I have it".
  const me = browser();
  me.look([borrowed("agreed", { updatedAt: 100 })], 110);
  me.look([borrowed("handed", { updatedAt: 200 })], 210);
  assert.deepEqual(me.page, [`notify_loan_handed ${L1}`]);
  // She did not get it, and says so: what the page said is answered.
  me.step(borrowed("agreed", { updatedAt: 300, byMe: true }));
  assert.deepEqual(me.page, []);
  me.look([borrowed("agreed", { updatedAt: 300, byMe: true })], 310);
  assert.deepEqual(me.page, []);
  // Handed over again: news again, and one notice, not two.
  me.look([borrowed("handed", { updatedAt: 400 })], 410);
  assert.deepEqual(me.page, [`notify_loan_handed ${L1}`]);
  // "I have it": nothing is left to say, on this page and after the look that follows the step.
  me.step(borrowed("on_loan", { updatedAt: 500, byMe: true }));
  me.look([borrowed("on_loan", { updatedAt: 500, byMe: true })], 510);
  assert.deepEqual(me.page, []);
  assert.deepEqual(me.said, [`notify_loan_handed ${L1}`, `notify_loan_handed ${L1}`]);
});

test("the latest step of a loan takes the place of the one before, and a tap taken back takes the notice away", () => {
  const me = browser();
  const other = lent("asked", { id: L2, updatedAt: 50 });
  me.look([borrowed("agreed", { updatedAt: 100, dueOn: 20800 })], 110);
  me.look([borrowed("handed", { updatedAt: 200, dueOn: 20800 }), other], 210);
  assert.deepEqual(me.page, [`notify_loan_handed ${L1}`, `notify_loan_asked ${L2}`]);
  // Another day for the same loan: one notice about it, the newer one. The notice about the other loan stays.
  me.look([borrowed("handed", { updatedAt: 300, dueOn: 20830 }), other], 310);
  assert.deepEqual(me.page, [`notify_loan_asked ${L2}`, `notify_loan_due_changed ${L1}`]);
  // "Handed over" taken back has no words of its own, and what was said about the loan is no longer so.
  me.look([borrowed("agreed", { updatedAt: 400, dueOn: 20830 }), other], 410);
  assert.deepEqual(me.page, [`notify_loan_asked ${L2}`]);
  // A step the reader took on another device, and a loan that is gone, take their notices away as well.
  me.look([borrowed("agreed", { updatedAt: 400, dueOn: 20830 }), lent("agreed", { id: L2, updatedAt: 500, byMe: true })], 510);
  assert.deepEqual(me.page, []);
  me.look([borrowed("handed", { updatedAt: 600, dueOn: 20830 })], 610);
  assert.deepEqual(me.page, [`notify_loan_handed ${L1}`]);
  me.look([], 710);
  assert.deepEqual(me.page, []);
});

test("an answer that comes in late changes nothing, so old news is not new again", () => {
  // Two windows of one browser. The second asks first and is answered last.
  const first = browser();
  const second = browser();
  const before = [borrowed("agreed", { updatedAt: 100, dueOn: 20800 })];
  const after = [borrowed("agreed", { updatedAt: 200, dueOn: 20830 })];
  first.look(before, 110);
  second.share(first);
  // The first window sees the new day and tells of it.
  assert.equal(first.look(after, 210), true);
  assert.deepEqual(first.said, [`notify_loan_due_changed ${L1}`]);
  // The second window's answer is from before that. It is not taken: nothing said, nothing remembered.
  second.share(first);
  assert.equal(second.look(before, 150), false);
  assert.deepEqual(second.said, []);
  assert.deepEqual(second.memory, first.memory);
  // So the next look of either window has nothing to announce.
  first.share(second);
  first.look(after, 310);
  second.share(first);
  second.look(after, 320);
  assert.deepEqual(first.said, [`notify_loan_due_changed ${L1}`]);
  assert.deepEqual(second.said, []);
  // The same in one window, when two of its looks cross.
  const alone = browser();
  alone.look(before, 110);
  alone.look(after, 210);
  assert.equal(alone.look(before, 150), false);
  alone.look(after, 310);
  assert.deepEqual(alone.said, [`notify_loan_due_changed ${L1}`]);
  // A server that does not say when it answered is taken at its word, as before.
  assert.equal(alone.look(after, 0), true);
  assert.deepEqual(alone.said, [`notify_loan_due_changed ${L1}`]);
});

test("the reader's own step is an answer about one loan, and leaves what is remembered of the others", () => {
  // The second window saw a new question. The first window, which has not, takes a step in another loan.
  const first = browser();
  const second = browser();
  const mine = borrowed("handed", { updatedAt: 100 });
  first.look([mine], 110);
  second.share(first);
  const question = lent("asked", { id: L2, updatedAt: 200 });
  second.look([mine, question], 210);
  assert.deepEqual(second.said, [`notify_loan_asked ${L2}`]);
  first.share(second);
  first.step(borrowed("on_loan", { updatedAt: 300, byMe: true }));
  // What the second window told stays told: the first window's next look does not announce it again.
  first.look([borrowed("on_loan", { updatedAt: 300, byMe: true }), question], 310);
  assert.deepEqual(first.said, []);
  assert.deepEqual(first.memory, { time: 310, loans: { [L1]: { at: 300, state: "on_loan", dueOn: null }, [L2]: { at: 200, state: "asked", dueOn: null } } });
  // The step moves the time on: a look that asked before it is late.
  assert.equal(rememberStep({ time: 110, loans: {} }, borrowed("on_loan", { updatedAt: 300, byMe: true }), false)?.time, 300);
  assert.equal(takeLoanAnswer({ time: 300, loans: {} }, [mine], 250).late, true);
  // A loan that was put away is forgotten, and a browser that remembers nothing stays that way until its first look.
  assert.deepEqual(rememberStep({ time: 400, loans: { [L1]: { at: 300, state: "returned", dueOn: null } } }, borrowed("returned", { updatedAt: 300 }), true), { time: 400, loans: {} });
  assert.equal(rememberStep(null, mine, false), null);
});

test("what a look gives the page to say: one sentence or none for each loan that changed", () => {
  const seen = seenOf([borrowed("agreed", { updatedAt: 100 }), lent("asked", { id: L2, updatedAt: 50 })]);
  // Nothing changed: nothing to say, nothing to take back.
  assert.deepEqual(loanNotices([borrowed("agreed", { updatedAt: 100 }), lent("asked", { id: L2, updatedAt: 50 })], seen), { say: [], unsay: [] });
  // The other side's step with words, the reader's own step, and a loan that is gone.
  const handed = borrowed("handed", { updatedAt: 200 });
  assert.deepEqual(loanNotices([handed], seen), { say: [{ loan: handed, key: "notify_loan_handed" }], unsay: [L2] });
  assert.deepEqual(loanNotices([borrowed("withdrawn", { updatedAt: 200, byMe: true }), lent("asked", { id: L2, updatedAt: 50 })], seen), { say: [], unsay: [L1] });
  // Never looked before: nothing at all.
  assert.deepEqual(loanNotices([handed], null), { say: [], unsay: [] });
});

test("each piece of news has its sentence, by the rules the app tells its notifications by", () => {
  const before = (state: LoanState, dueOn: number | null = null) => ({ at: 1, state, dueOn });
  // To the lender.
  assert.equal(newsKey(lent("asked"), undefined), "notify_loan_asked");
  assert.equal(newsKey(lent("withdrawn"), before("asked")), "notify_loan_withdrawn");
  // A question this browser never showed is not missed when it is gone.
  assert.equal(newsKey(lent("withdrawn"), undefined), null);
  assert.equal(newsKey(lent("on_loan"), before("handed")), "notify_loan_on_loan");
  assert.equal(newsKey(lent("on_loan"), undefined), "notify_loan_on_loan");
  assert.equal(newsKey(lent("agreed"), before("handed")), "notify_loan_not_received");
  assert.equal(newsKey(lent("given_back"), before("on_loan")), "notify_loan_given_back");
  // "Not given back yet" has no sentence: the loan simply shows where it stands.
  assert.equal(newsKey(lent("on_loan"), before("given_back")), null);
  assert.equal(newsKey(lent("on_loan"), before("on_loan")), null);
  assert.equal(newsKey(lent("returned"), before("given_back")), null);
  // To the borrower.
  assert.equal(newsKey(borrowed("agreed"), before("asked")), "notify_loan_agreed");
  assert.equal(newsKey(borrowed("agreed"), undefined), "notify_loan_agreed");
  assert.equal(newsKey(borrowed("declined", { reason: "Not this one" }), before("asked")), "notify_loan_declined");
  assert.equal(newsKey(borrowed("declined", { reason: "taken" }), before("asked")), "notify_loan_taken");
  assert.equal(newsKey(borrowed("cancelled"), before("agreed")), "notify_loan_cancelled");
  assert.equal(newsKey(borrowed("handed"), before("agreed")), "notify_loan_handed");
  assert.equal(newsKey(borrowed("returned"), before("given_back")), "notify_loan_returned");
  assert.equal(newsKey(borrowed("on_loan"), before("given_back")), "notify_loan_not_returned");
  // "Handed over" taken back needs no words.
  assert.equal(newsKey(borrowed("agreed"), before("handed")), null);
  // Another day, in whatever state the day can be changed.
  assert.equal(newsKey(borrowed("agreed", { dueOn: null }), before("agreed", 20800)), "notify_loan_due_changed");
  assert.equal(newsKey(borrowed("handed", { dueOn: 20830 }), before("handed", 20800)), "notify_loan_due_changed");
  assert.equal(newsKey(borrowed("on_loan", { dueOn: 20830 }), before("on_loan", 20800)), "notify_loan_due_changed");
  assert.equal(newsKey(borrowed("given_back", { dueOn: 20830 }), before("given_back", 20800)), "notify_loan_due_changed");
  // Seen for the first time while out, there is no telling what the lender did.
  assert.equal(newsKey(borrowed("on_loan"), undefined), null);
  // A friendship that ends takes the open questions with it. A friend who ends it answers
  // mine with a no and takes their own back, and I am told both like any no and any
  // question taken back.
  assert.equal(newsKey(borrowed("declined"), before("asked")), "notify_loan_declined");
  assert.equal(newsKey(lent("withdrawn"), before("asked")), "notify_loan_withdrawn");
  // My own question that I took back, also by ending the friendship myself, is no news to me.
  assert.equal(newsKey(borrowed("withdrawn"), before("asked")), null);
  assert.deepEqual(newsOf([borrowed("withdrawn", { byMe: true, updatedAt: 9 }), lent("declined", { byMe: true, updatedAt: 9 })], {}), []);
});

test("a loan is listed where the reader looks for it, and says how it stands", () => {
  assert.equal(sectionOf(lent("asked")), "todo");
  assert.equal(sectionOf(lent("given_back")), "todo");
  assert.equal(sectionOf(borrowed("handed")), "todo");
  assert.equal(sectionOf(borrowed("asked")), "open");
  assert.equal(sectionOf(lent("agreed")), "open");
  assert.equal(sectionOf(lent("handed")), "open");
  assert.equal(sectionOf(lent("on_loan")), "lent");
  assert.equal(sectionOf(borrowed("on_loan")), "borrowed");
  assert.equal(sectionOf(borrowed("given_back")), "borrowed");
  for (const state of ["returned", "declined", "withdrawn", "cancelled"] as const) assert.equal(sectionOf(lent(state)), "past");

  assert.deepEqual(standingOf(lent("asked")), { key: "loan_l_asked", moment: null });
  assert.deepEqual(standingOf(borrowed("asked", { askedAt: 77 })), { key: "loan_b_asked", moment: 77 });
  assert.deepEqual(standingOf(lent("on_loan", { receivedAt: 88 })), { key: "loan_l_on_loan", moment: 88 });
  assert.deepEqual(standingOf(lent("returned", { closedAt: 99 })), { key: "loan_l_returned", moment: 99 });
  // The borrower gave it back on the day they said so. A lender who closed the loan alone names the day of closing.
  assert.deepEqual(standingOf(borrowed("returned", { givenBackAt: 90, closedAt: 99 })), { key: "loan_b_returned", moment: 90 });
  assert.deepEqual(standingOf(borrowed("returned", { givenBackAt: null, closedAt: 99 })), { key: "loan_b_returned", moment: 99 });
  // Somebody else got the book: a sentence of its own, and no reason to quote.
  assert.equal(standingOf(borrowed("declined", { reason: "taken" })).key, "loan_b_taken");
  assert.equal(standingOf(lent("declined", { reason: "taken" })).key, "loan_l_taken");
  assert.equal(givenReason(borrowed("declined", { reason: "taken" })), "");
  assert.equal(givenReason(borrowed("declined", { reason: " Not this one " })), "Not this one");
  assert.equal(givenReason(borrowed("cancelled", { reason: "I need it myself after all" })), "I need it myself after all");
  assert.equal(givenReason(borrowed("declined")), "");
  assert.equal(givenReason(borrowed("on_loan", { reason: "left over" })), "");
});

// ---- availability ----

test("a book of mine that a loan has reserved or out is held, and no other", () => {
  const loans = [lent("asked", { bookId: 1 }), lent("agreed", { id: L2, bookId: 2 }), lent("handed", { id: "h", bookId: 3 }), lent("on_loan", { id: "o", bookId: 4 }), lent("given_back", { id: "g", bookId: 5 }), lent("returned", { id: "r", bookId: 6 }), lent("cancelled", { id: "c", bookId: 7 })];
  assert.deepEqual([...heldBookIds(loans)].sort(), [2, 3, 4, 5]);
  // What I borrowed is somebody else's book: its id means nothing in my library.
  assert.deepEqual([...heldBookIds([borrowed("on_loan", { bookId: 9 })])], []);
  assert.deepEqual([...heldBookIds([])], []);
});

// ---- the id of a borrowed copy ----

test("the id of a borrowed copy is made from the loan's id, the same on every device", () => {
  // The values of the contract. The Android app is tested with the same four.
  assert.equal(loanBookId("3f2a9c1e-7b4d-4e8a-9c0d-112233445566"), 1111235846714580);
  assert.equal(loanBookId("0000000a-bcde-4f01-8234-56789abcdef0"), 11259364);
  assert.equal(loanBookId("ffffffff-ffff-4fff-8fff-ffffffffffff"), 4503599627370484);
  // Capitals count the same.
  assert.equal(loanBookId("9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D"), 2728844865026004);
  assert.equal(loanBookId("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"), 2728844865026004);
  // Zero is no id for a book. (An id that Supabase makes cannot begin like this: its thirteenth digit is a 4.)
  assert.equal(loanBookId("00000000-0000-0abc-8000-000000000000"), 1);
  assert.equal(loanBookId("00000000-0000-4000-8000-000000000000"), 4);
  assert.equal(loanBookId(""), 1);
  // Thirteen hexadecimal digits always fit a number JavaScript keeps exactly.
  assert.ok(Number.isSafeInteger(loanBookId("ffffffff-ffff-ffff-ffff-ffffffffffff")));
  assert.equal(loanBookId("ffffffff-ffff-ffff-ffff-ffffffffffff"), 2 ** 52 - 1);
});

// ---- the books follow the loans ----

test("as lender, a book that is out carries who has it, since when, and the loan", () => {
  const mine = library(book({ id: 7, title: "Emma" }), book({ id: 8, title: "Persuasion" }));
  for (const state of ["on_loan", "given_back"] as const) {
    const after = follow([lent(state)], mine);
    assert.equal(after.books[0].lentTo, "Ben");
    assert.equal(after.books[0].lentSince, DAY, "the day the borrower got it");
    assert.equal(after.books[0].loanId, L1);
    assert.equal(after.books[0].updatedAt, NOW);
    assert.equal(after.books[1], mine.books[1], "no other book is touched");
  }
  // A book lent by hand before is taken over by the loan.
  const byHand = library(book({ id: 7, title: "Emma", lentTo: "Somebody", lentSince: 100 }));
  assert.equal(follow([lent("on_loan")], byHand).books[0].lentTo, "Ben");
  // Unless the book carries this loan already: then nothing is written again, whatever was edited since.
  const carried = library(book({ id: 7, title: "Emma", lentTo: "Benjamin", lentSince: DAY - 9, loanId: L1 }));
  assert.equal(follow([lent("on_loan")], carried), carried);
  // A book that is gone from the library is not brought back by a loan of it.
  const without = library(book({ id: 8, title: "Persuasion" }));
  assert.equal(follow([lent("on_loan")], without), without);
});

test("as lender, in any other state the book that carried the loan is at home again", () => {
  const out = library(book({ id: 7, title: "Emma", lentTo: "Ben", lentSince: DAY, loanId: L1 }));
  for (const state of ["asked", "agreed", "handed", "returned", "declined", "withdrawn", "cancelled"] as const) {
    const after = follow([lent(state)], out);
    assert.equal(after.books[0].lentTo, "", state);
    assert.equal(after.books[0].lentSince, null, state);
    assert.equal(after.books[0].loanId, "", state);
  }
  // Every book that carries it, should there be more than one.
  const twice = follow([lent("returned")], library(book({ id: 7, title: "Emma", lentTo: "Ben", loanId: L1 }), book({ id: 8, title: "Emma again", lentTo: "Ben", loanId: L1 })));
  assert.deepEqual(twice.books.map((b) => [b.lentTo, b.loanId]), [["", ""], ["", ""]]);
  // It is the book that carries the loan, wherever the loan says the book is.
  const moved = library(book({ id: 99, title: "Emma, second copy", lentTo: "Ben", lentSince: DAY, loanId: L1 }), book({ id: 7, title: "Emma" }));
  const after = follow([lent("returned")], moved);
  assert.equal(after.books[0].loanId, "");
  assert.equal(after.books[1], moved.books[1]);
  // A book lent by hand, or reserved but never out, is none of the loan's business.
  const byHand = library(book({ id: 7, title: "Emma", lentTo: "Somebody", lentSince: 100 }));
  for (const state of ["asked", "agreed", "handed", "returned", "cancelled"] as const) assert.equal(follow([lent(state)], byHand), byHand, state);
});

test("as borrower, a book that is out stands on my own shelf as borrowed", () => {
  const empty = library();
  const shared = { ...sharedBookCodec.read({ id: 7, title: "Emma" }), description: "A match-maker meets her match.", rating: 5, review: "Mine to keep." };
  for (const state of ["on_loan", "given_back"] as const) {
    const after = follow([borrowed(state)], empty, (peer, bookId) => (peer === ANNA && bookId === 7 ? shared : undefined));
    assert.equal(after.books.length, 1);
    const copy = after.books[0];
    assert.equal(copy.id, loanBookId(L1));
    assert.equal(copy.id, 1111235846714580);
    assert.equal(copy.title, "Emma");
    assert.equal(copy.authors, "Jane Austen");
    assert.equal(copy.isbn, "9780141439587");
    assert.equal(copy.coverUrl, "https://example.org/emma.jpg");
    assert.equal(copy.pageCount, 474);
    assert.equal(copy.format, "PAPERBACK");
    // What the friend's shelf says beyond that: the blurb. Their stars and their review stay theirs.
    assert.equal(copy.description, "A match-maker meets her match.");
    assert.equal(copy.rating, 0);
    assert.equal(copy.review, "");
    assert.equal(copy.status, "NONE");
    assert.equal(copy.ownership, "BORROWED");
    assert.equal(copy.borrowedFrom, "Anna");
    assert.equal(copy.loanId, L1);
    assert.equal(copy.addedAt, NOON, "added when it was received");
  }
  // Without the friend's shelf at hand the loan says enough.
  assert.equal(follow([borrowed("on_loan")], empty).books[0].description, "");
  // Before the book is in my hands nothing stands on my shelf.
  for (const state of ["asked", "agreed", "handed", "declined", "withdrawn", "cancelled"] as const) assert.equal(follow([borrowed(state)], empty), empty, state);
});

test("my copy is the book that carries the loan, else the one with the loan's id, else a wish for the same book", () => {
  // 1. The book that carries the loan, whatever its id.
  const carrying = library(book({ id: 5, title: "Emma (my note)", ownership: "NOT_OWNED", loanId: L1, review: "Half way." }), book({ id: loanBookId(L1), title: "Another" }));
  let after = follow([borrowed("on_loan")], carrying);
  assert.equal(after.books.length, 2);
  assert.equal(after.books[0].ownership, "BORROWED");
  assert.equal(after.books[0].borrowedFrom, "Anna");
  assert.equal(after.books[0].review, "Half way.");
  assert.equal(after.books[1], carrying.books[1]);

  // 2. The book with the id made from the loan: another device made it, or it lost its mark.
  const made = library(book({ id: loanBookId(L1), title: "Emma", ownership: "OWNED" }));
  after = follow([borrowed("on_loan")], made);
  assert.equal(after.books.length, 1);
  assert.equal(after.books[0].ownership, "BORROWED");
  assert.equal(after.books[0].loanId, L1);

  // 3. A wish for the same book, by its ISBN: it becomes the borrowed copy, with all it holds.
  const wished = library(book({ id: 40, title: "Emma. A Novel", isbn: "9780141439587", status: "WISHLIST", ownership: "NOT_OWNED", tags: "austen", addedAt: 5 }));
  after = follow([borrowed("on_loan")], wished);
  assert.equal(after.books.length, 1);
  assert.equal(after.books[0].id, 40);
  assert.equal(after.books[0].ownership, "BORROWED");
  assert.equal(after.books[0].borrowedFrom, "Anna");
  assert.equal(after.books[0].loanId, L1);
  assert.equal(after.books[0].status, "WISHLIST");
  assert.equal(after.books[0].tags, "austen");
  assert.equal(after.books[0].addedAt, 5);
  // Of two wishes for it, the one with the lower id, wherever it stands in the document: the same on every device.
  const two = library(book({ id: 60, title: "Emma", authors: "Jane Austen", ownership: "NOT_OWNED" }), book({ id: 40, title: "Emma", authors: "Jane Austen", ownership: "NOT_OWNED" }));
  after = follow([borrowed("on_loan")], two);
  assert.deepEqual(after.books.map((b) => [b.id, b.ownership]), [[60, "NOT_OWNED"], [40, "BORROWED"]]);
  // Or by title and first author, whatever the case and the punctuation.
  const byName = library(book({ id: 41, title: "EMMA!", authors: "jane austen, Fiona Stafford", ownership: "NOT_OWNED" }));
  assert.equal(follow([borrowed("on_loan")], byName).books[0].id, 41);
  assert.equal(follow([borrowed("on_loan")], byName).books.length, 1);

  // A copy I own, or one borrowed by hand from somebody else, is not the friend's book: a new one is added.
  for (const ownership of ["OWNED", "BORROWED"] as const) {
    const own = library(book({ id: 42, title: "Emma", authors: "Jane Austen", isbn: "9780141439587", ownership }));
    after = follow([borrowed("on_loan")], own);
    assert.equal(after.books.length, 2, ownership);
    assert.equal(after.books[0], own.books[0]);
    assert.equal(after.books[1].id, loanBookId(L1));
  }
  // Another book by the same author is another book.
  const other = library(book({ id: 43, title: "Persuasion", authors: "Jane Austen", ownership: "NOT_OWNED" }));
  assert.equal(follow([borrowed("on_loan")], other).books.length, 2);

  assert.equal(sameAsLoaned(borrowed("on_loan").book, book({ title: "Something else", isbn: "9780141439587" })), true);
  assert.equal(sameAsLoaned({ ...borrowed("on_loan").book, isbn: "" }, book({ title: "Something else", isbn: "" })), false);
});

test("as borrower, once the book is back with its owner my copy says: not mine", () => {
  const mine = library(book({ id: loanBookId(L1), title: "Emma", ownership: "BORROWED", borrowedFrom: "Anna", loanId: L1, status: "READ", rating: 4.5, review: "Wonderful.", finishedOn: DAY - 2 }));
  const after = follow([borrowed("returned")], mine);
  assert.equal(after.books[0].ownership, "NOT_OWNED");
  // It keeps the loan, whom it was borrowed from, and everything the reader noted in it: read, not mine.
  assert.equal(after.books[0].loanId, L1);
  assert.equal(after.books[0].borrowedFrom, "Anna");
  assert.equal(after.books[0].status, "READ");
  assert.equal(after.books[0].rating, 4.5);
  assert.equal(after.books[0].review, "Wonderful.");
  assert.equal(after.books[0].finishedOn, DAY - 2);
  assert.equal(after.books[0].updatedAt, NOW);
});

test("a returned loan does not flip a book the reader has meanwhile marked as their own", () => {
  // They liked it and bought it: the copy is theirs now, and a return of the borrowed one changes nothing.
  const bought = library(book({ id: loanBookId(L1), title: "Emma", ownership: "OWNED", borrowedFrom: "Anna", loanId: L1 }));
  assert.equal(follow([borrowed("returned")], bought), bought);
  // Nor one that already says "not mine".
  const noted = library(book({ id: loanBookId(L1), title: "Emma", ownership: "NOT_OWNED", borrowedFrom: "Anna", loanId: L1 }));
  assert.equal(follow([borrowed("returned")], noted), noted);
  // A loan that ended any other way never had a copy to speak of.
  const borrowedByHand = library(book({ id: 3, title: "Emma", ownership: "BORROWED", borrowedFrom: "Anna" }));
  for (const state of ["returned", "declined", "withdrawn", "cancelled"] as const) assert.equal(follow([borrowed(state)], borrowedByHand), borrowedByHand, state);
});

test("doing it twice changes nothing, at every step of a loan and on both sides", () => {
  const lender = library(book({ id: 7, title: "Emma", authors: "Jane Austen", isbn: "9780141439587" }), book({ id: 8, title: "Persuasion" }));
  const borrower = library(book({ id: 30, title: "Mansfield Park" }));
  let mine = lender;
  let theirs = borrower;
  for (const state of ["asked", "agreed", "handed", "on_loan", "given_back", "on_loan", "given_back", "returned"] as const) {
    const once = follow([lent(state)], mine);
    assert.equal(follow([lent(state)], once), once, `lender, ${state}`);
    assert.deepEqual(writeVault(follow([lent(state)], JSON.parse(JSON.stringify(once)) as Vault)), writeVault(once));
    mine = once;
    const onceTheirs = follow([borrowed(state)], theirs);
    assert.equal(follow([borrowed(state)], onceTheirs), onceTheirs, `borrower, ${state}`);
    theirs = onceTheirs;
  }
  // At the end the lender's book is at home, and the borrower has the book as read, not mine.
  assert.equal(mine.books[0].lentTo, "");
  assert.equal(mine.books[0].loanId, "");
  assert.equal(theirs.books.length, 2);
  assert.equal(theirs.books[1].ownership, "NOT_OWNED");
  assert.equal(theirs.books[1].loanId, L1);
  // A library no loan has anything to say about comes back as the very same document.
  assert.equal(follow([], lender), lender);
  assert.equal(follow([lent("asked"), borrowed("asked", { id: L2 })], lender), lender);
});

test("two devices of one account that both see the loan make the same book, and the library has it once", () => {
  const start = library(book({ id: 30, title: "Mansfield Park" }));
  // The phone and the browser each look at the server on their own, at different moments.
  const onPhone = followLoans([borrowed("on_loan")], () => undefined, utcZone, NOW)(start);
  const inBrowser = followLoans([borrowed("on_loan")], () => undefined, utcZone, NOW + 60_000)(start);
  const made = (vault: Vault) => vault.books[1];
  assert.equal(made(onPhone).id, made(inBrowser).id);
  assert.equal(made(onPhone).id, loanBookId(L1));
  // The very same book, to the last field: it is stamped with the moment it was received, not with the moment of writing.
  assert.deepEqual(made(inBrowser), made(onPhone));
  assert.equal(made(onPhone).updatedAt, NOON);
  // Whichever saved second finds the book of the first and adds nothing.
  const second = followLoans([borrowed("on_loan")], () => undefined, utcZone, NOW + 60_000)(onPhone);
  assert.equal(second, onPhone);
  assert.equal(second.books.length, 2);
  // The same when the save of one is applied on top of the other after a conflict: adding the book again replaces it.
  const merged = addBook(made(inBrowser), [], made(inBrowser).addedAt)(onPhone);
  assert.equal(merged.books.length, 2);
});

test("a whole loan, seen from both libraries", () => {
  let annas = library(book({ id: 7, title: "Emma", authors: "Jane Austen", isbn: "9780141439587" }));
  let bens = library(book({ id: 50, title: "Emma", authors: "Jane Austen", status: "WISHLIST", ownership: "NOT_OWNED" }));
  const step = (state: LoanState, more: Partial<Loan> = {}) => {
    annas = follow([lent(state, more)], annas);
    bens = follow([borrowed(state, more)], bens);
  };
  step("asked", { receivedAt: null });
  step("agreed", { receivedAt: null, dueOn: DAY + 14 });
  step("handed", { receivedAt: null, dueOn: DAY + 14 });
  // Reserved and handed over, but not confirmed: nothing has changed in either library.
  assert.equal(annas.books[0].lentTo, "");
  assert.equal(bens.books[0].ownership, "NOT_OWNED");
  step("on_loan", { dueOn: DAY + 14 });
  assert.equal(annas.books[0].lentTo, "Ben");
  assert.equal(annas.books[0].lentSince, DAY);
  // Ben's wish is the borrowed copy now: no second Emma on his shelf.
  assert.equal(bens.books.length, 1);
  assert.equal(bens.books[0].id, 50);
  assert.equal(bens.books[0].ownership, "BORROWED");
  assert.equal(bens.books[0].borrowedFrom, "Anna");
  // Ben reads it and writes about it while it is with him.
  bens = modifyBook(50, (b) => ({ ...b, status: "READ", review: "Badly done, Emma!" }), NOW)(bens);
  step("given_back", { dueOn: DAY + 14 });
  assert.equal(annas.books[0].lentTo, "Ben", "still out until the lender has it back");
  assert.equal(bens.books[0].ownership, "BORROWED");
  step("returned", { dueOn: DAY + 14 });
  assert.equal(annas.books[0].lentTo, "");
  assert.equal(annas.books[0].lentSince, null);
  assert.equal(annas.books[0].loanId, "");
  assert.equal(bens.books[0].ownership, "NOT_OWNED");
  assert.equal(bens.books[0].review, "Badly done, Emma!");
  assert.equal(bens.books[0].loanId, L1);
  // What is written is a vault the app reads: no null, no empty loan.
  const written = writeVault(annas) as { books: Record<string, unknown>[] };
  assert.equal("loanId" in written.books[0], false);
  assert.equal("lentSince" in written.books[0], false);
  assert.deepEqual(writeVault(readVault(writeVault(bens))), writeVault(bens));
});

test("a lender who closes the loan alone, and a borrowed copy that was deleted", () => {
  // "I already have it back": on loan straight to returned.
  const annas = follow([lent("returned")], library(book({ id: 7, title: "Emma", lentTo: "Ben", lentSince: DAY, loanId: L1 })));
  assert.equal(annas.books[0].loanId, "");
  const bens = follow([borrowed("returned", { givenBackAt: null })], library(book({ id: loanBookId(L1), title: "Emma", ownership: "BORROWED", borrowedFrom: "Anna", loanId: L1 })));
  assert.equal(bens.books[0].ownership, "NOT_OWNED");
  // A copy the borrower deleted while the book is still with them stands there again after the next look.
  const deleted = deleteBook(loanBookId(L1))(library(book({ id: loanBookId(L1), title: "Emma", ownership: "BORROWED", loanId: L1 })));
  assert.equal(deleted.books.length, 0);
  assert.equal(follow([borrowed("on_loan")], deleted).books.length, 1);
  // After the return a deleted copy stays deleted.
  assert.equal(follow([borrowed("returned")], deleted), deleted);
});

// ---- the edges: a friend without a name, a loan ended by hand, a book that cannot go ----

test("the sample loan of the contract is the loan the sample library carries", () => {
  const dune = readLoan(JSON.parse(sample("loan.json")))!;
  assert.equal([dune.role, dune.state, dune.peerName, dune.bookId, dune.dueOn, dune.byMe].join(" "), "lender on_loan Ben 3 20800 false");
  assert.equal(dune.book.title, "Dune");
  assert.equal(dune.note, "Für die Ferien?");
  // The library of the sample has done what the rules say: Dune is lent to Ben since the day he got it, by this loan.
  const vault = readVault(JSON.parse(sample("vault.json")));
  assert.deepEqual([vault.books[2].lentTo, vault.books[2].lentSince, vault.books[2].loanId], ["Ben", 20779, dune.id]);
  assert.equal(followLoans([dune], () => undefined, utcZone, NOW)(vault), vault);
  // And from a library that has not heard of the loan yet, the rules make exactly that.
  const fresh = { ...vault, books: vault.books.map((b) => (b.id === 3 ? { ...b, lentTo: "", lentSince: null, loanId: "" } : b)) };
  const made = followLoans([dune], () => undefined, utcZone, 1795313600000)(fresh);
  assert.deepEqual(writeVault(made), writeVault(vault));
  assert.equal(heldBookIds([dune]).has(3), true);
  assert.equal(tyingLoan(vault.books[2], [dune]), dune);
});

test("a friend who never gave themselves a name is written as a question mark", () => {
  // An empty name on a book would mean that it is at home, or borrowed from nobody.
  for (const peerName of ["", "   "]) {
    assert.equal(nameOnBook(lent("on_loan", { peerName })), "?");
    const mine = follow([lent("on_loan", { peerName })], library(book({ id: 7, title: "Emma" })));
    assert.equal(mine.books[0].lentTo, "?");
    assert.equal(mine.books[0].loanId, L1);
    const theirs = follow([borrowed("on_loan", { peerName })], library());
    assert.equal(theirs.books[0].borrowedFrom, "?");
    // A wish that becomes the copy, and a copy that is there already, say the same.
    const wish = follow([borrowed("on_loan", { peerName })], library(book({ id: 40, title: "Emma", authors: "Jane Austen", ownership: "NOT_OWNED" })));
    assert.deepEqual([wish.books[0].ownership, wish.books[0].borrowedFrom], ["BORROWED", "?"]);
    // And doing it twice still changes nothing.
    assert.equal(follow([lent("on_loan", { peerName })], mine), mine);
    assert.equal(follow([borrowed("on_loan", { peerName })], theirs), theirs);
  }
  // A name is written as it is.
  assert.equal(nameOnBook(lent("on_loan")), "Ben");
  // Once the book is back the question mark goes like any name.
  const back = follow([lent("returned", { peerName: "" })], library(book({ id: 7, title: "Emma", lentTo: "?", lentSince: DAY, loanId: L1 })));
  assert.deepEqual([back.books[0].lentTo, back.books[0].loanId], ["", ""]);
});

test("whatever ends a loan by hand on a book that has no known loan empties the loan it carried", () => {
  // The other account is gone, or the loan was put away: the book is lent or borrowed by hand again.
  const lentOut = book({ id: 7, title: "Emma", lentTo: "Ben", lentSince: DAY, loanId: L1 });
  // "Got it back".
  assert.deepEqual([backByHand(lentOut).lentTo, backByHand(lentOut).lentSince, backByHand(lentOut).loanId], ["", null, ""]);
  // Lent again by hand, to somebody else.
  assert.deepEqual([lentByHand(lentOut, "Cleo", DAY + 1).lentTo, lentByHand(lentOut, "Cleo", DAY + 1).lentSince, lentByHand(lentOut, "Cleo", DAY + 1).loanId], ["Cleo", DAY + 1, ""]);
  // Another ownership, on a copy that was borrowed.
  const copy = book({ id: 9, title: "Emma", ownership: "BORROWED", borrowedFrom: "Anna", loanId: L1, review: "Kept." });
  const mine = ownedByHand(copy, "OWNED", false);
  assert.deepEqual([mine.ownership, mine.loanId, mine.borrowedFrom, mine.review], ["OWNED", "", "Anna", "Kept."]);
  assert.equal(ownedByHand(copy, "NOT_OWNED", false).loanId, "");
  // Choosing what it says already ends nothing.
  assert.equal(ownedByHand(copy, "BORROWED", false), copy);
  // While the server still tells of the loan, the loan is not forgotten: it is shown with the book until it is put away.
  assert.equal(ownedByHand({ ...copy, ownership: "NOT_OWNED" }, "OWNED", true).loanId, L1);
  // Afterwards no rule finds the book any more: a returned loan that comes up again changes nothing.
  assert.equal(follow([borrowed("returned")], library(mine)).books[0], mine);
  assert.equal(follow([lent("returned")], library(backByHand(lentOut))).books[0].loanId, "");
});

test("a book that is part of a known loan which is not over cannot be deleted", () => {
  const mine = book({ id: 7, title: "Emma" });
  // As the lender's book, from the question on: the loan would point at nothing.
  for (const state of ["asked", "agreed", "handed", "on_loan", "given_back"] as const) assert.equal(tyingLoan(mine, [lent(state)])?.id, L1, state);
  // As the borrower's copy: the next look at the server would bring it back.
  const copy = book({ id: loanBookId(L1), title: "Emma", ownership: "BORROWED", loanId: L1 });
  for (const state of ["on_loan", "given_back"] as const) assert.equal(tyingLoan(copy, [borrowed(state)])?.id, L1, state);
  // A loan that is over holds nothing.
  for (const state of ["returned", "declined", "withdrawn", "cancelled"] as const) {
    assert.equal(tyingLoan(mine, [lent(state)]), undefined, state);
    assert.equal(tyingLoan({ ...copy, ownership: "NOT_OWNED" }, [borrowed(state)]), undefined, state);
  }
  // Nor does a loan the server no longer tells of, a loan of another book, or what I asked somebody else for.
  assert.equal(tyingLoan({ ...mine, lentTo: "Ben", loanId: L1 }, []), undefined);
  assert.equal(tyingLoan(mine, [lent("on_loan", { bookId: 8 })]), undefined);
  assert.equal(tyingLoan(mine, [borrowed("asked", { bookId: 7 })]), undefined);
  // Of several, the one that is not over.
  assert.equal(tyingLoan(mine, [lent("declined", { id: "d" }), lent("asked", { id: L2 })])?.id, L2);
});

// ---- which loans belong to a book ----

test("the page of a book shows the loan it carries, and every question that is still open for it", () => {
  const out = book({ id: 7, title: "Emma", lentTo: "Ben", loanId: L1 });
  const carried = lent("on_loan");
  const another = lent("asked", { id: L2, peerName: "Cleo" });
  const over = lent("declined", { id: "d" });
  const elsewhere = lent("asked", { id: "e", bookId: 8 });
  assert.equal(loanOf(out, [another, carried]), carried);
  assert.deepEqual(loansAbout(out, [another, over, elsewhere, carried]), [carried, another]);
  // A book at home: the questions for it, and nothing that is over.
  const home = book({ id: 7, title: "Emma" });
  assert.equal(loanOf(home, [carried]), undefined);
  assert.deepEqual(loansAbout(home, [another, over, elsewhere]), [another]);
  // A book that carries a loan the server no longer tells of is lent by hand again.
  assert.equal(loanOf(out, [another]), undefined);
  // My borrowed copy shows the loan it came in by, also once that is over, until it is put away.
  const copy = book({ id: loanBookId(L1), title: "Emma", ownership: "NOT_OWNED", loanId: L1 });
  const back = borrowed("returned");
  assert.deepEqual(loansAbout(copy, [back, another]), [back]);
});

test("on a friend's shelf a book shows my loan that is running, or else the last one that ended", () => {
  const running = borrowed("agreed", { id: L2, askedAt: 300 });
  const ended = borrowed("returned", { askedAt: 100 });
  const earlier = borrowed("declined", { id: "d", askedAt: 50 });
  // The server lists the newest question first.
  assert.deepEqual(myLoanOf([running, ended, earlier], ANNA, 7), { open: running, last: ended });
  assert.deepEqual(myLoanOf([ended, earlier], ANNA, 7), { open: undefined, last: ended });
  assert.deepEqual(myLoanOf([running], ANNA, 8), { open: undefined, last: undefined });
  assert.deepEqual(myLoanOf([running], BEN, 7), { open: undefined, last: undefined });
  // What I lend out myself is not a loan of mine on anybody's shelf.
  assert.deepEqual(myLoanOf([lent("on_loan", { peer: ANNA })], ANNA, 7), { open: undefined, last: undefined });
});

// ---- saved like any edit ----

/** A server in memory that keeps a library by revision, as shelfmark_vault_pull and shelfmark_vault_push do. */
class Shelf implements VaultApi {
  revision = 0;
  payload: Record<string, unknown> | null = null;
  /** Runs before a save is looked at, to let another device save first. */
  beforePush: (() => void) | null = null;

  async pull(known: number) {
    await Promise.resolve();
    return { revision: this.revision, payload: this.revision === known || this.revision === 0 ? null : structuredClone(this.payload) };
  }

  async push(payload: Record<string, unknown>, expected: number) {
    await Promise.resolve();
    const hook = this.beforePush;
    this.beforePush = null;
    hook?.();
    if (expected !== this.revision) throw new ServerError("conflict");
    this.payload = structuredClone(payload);
    this.revision++;
    return { revision: this.revision };
  }

  saveFromElsewhere(change: (vault: Vault) => Vault) {
    this.payload = writeVault(change(this.payload ? readVault(this.payload) : emptyVault()));
    this.revision++;
  }
}

test("what the loans do to the books is saved like any edit, and survives the phone saving in between", async () => {
  const server = new Shelf();
  server.saveFromElsewhere(() => library(book({ id: 7, title: "Emma" })));
  const store = new VaultStore(server);
  await store.load();
  // While the website saves that Emma is out, the phone saves a review of it. And for Ben's
  // account the other way round: the phone made the borrowed copy first.
  server.beforePush = () => server.saveFromElsewhere((vault) => ({ ...vault, books: vault.books.map((b) => ({ ...b, review: "From the phone" })) }));
  await store.mutate(followLoans([lent("on_loan")], () => undefined, utcZone, NOW));
  assert.equal(await store.settled(), true);
  const saved = readVault(server.payload).books[0];
  assert.equal(saved.review, "From the phone");
  assert.equal(saved.lentTo, "Ben");
  assert.equal(saved.loanId, L1);
  assert.equal(server.revision, 3);

  const bens = new Shelf();
  const bensStore = new VaultStore(bens);
  await bensStore.load();
  bens.beforePush = () => bens.saveFromElsewhere((vault) => followLoans([borrowed("on_loan")], () => undefined, utcZone, NOW - 500)(vault));
  await bensStore.mutate(followLoans([borrowed("on_loan")], () => undefined, utcZone, NOW));
  assert.equal(await bensStore.settled(), true);
  // One copy, the one both devices would have made.
  const books = readVault(bens.payload).books;
  assert.equal(books.length, 1);
  assert.equal(books[0].id, loanBookId(L1));
});
