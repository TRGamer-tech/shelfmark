// What the address says when somebody arrives through the link of a mail.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mailLinkOf, noticeFor, wantsPassword } from "../src/lib/supabase/links.ts";

const SIGN_IN = "access_token=eyJhbGciOiJIUzI1NiJ9.e30.abc&expires_in=3600&expires_at=1795000000&refresh_token=r1&token_type=bearer";

test("the link of a password mail is recognised on the page it was asked to lead to", () => {
  assert.equal(mailLinkOf(`https://shelf.example/reset#${SIGN_IN}&type=recovery`), "recovery");
});

test("and on the address of the site itself, where a mail asked for in the app leads", () => {
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}&type=recovery`), "recovery");
  assert.equal(mailLinkOf(`https://shelf.example#${SIGN_IN}&type=recovery`), "recovery");
  // The order of what stands behind the "#" does not matter.
  assert.equal(mailLinkOf(`https://shelf.example/#type=recovery&${SIGN_IN}`), "recovery");
  assert.equal(mailLinkOf(`http://127.0.0.1:3210/?lang=de#${SIGN_IN}&type=recovery`), "recovery");
});

test("the link that confirms a new account is told from the others", () => {
  // Exactly what Supabase sends the browser to after the click in the mail: the site URL with a trailing slash.
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}&type=signup`), "signup");
  assert.equal(mailLinkOf(`https://shelf.example/de#${SIGN_IN}&type=signup`), "signup");
});

test("the other kinds of mail are known by name as well", () => {
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}&type=magiclink`), "magiclink");
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}&type=invite`), "invite");
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}&type=email_change`), "email_change");
  // The first of the two mails of a change of address: a sentence, and no sign-in.
  assert.equal(mailLinkOf("https://shelf.example/#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email"), "pending");
});

test("an ordinary visit, or a sign-in of a kind the site did not send for, says nothing", () => {
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}`), null);
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}&type=something_new`), null);
  assert.equal(mailLinkOf("https://shelf.example/"), null);
  assert.equal(mailLinkOf("https://shelf.example/book?id=5"), null);
  assert.equal(mailLinkOf("https://shelf.example/#content"), null);
  assert.equal(mailLinkOf("https://shelf.example/#download"), null);
  assert.equal(mailLinkOf(""), null);
});

test("the word alone, without a sign-in, opens nothing", () => {
  assert.equal(mailLinkOf("https://shelf.example/#type=recovery"), null);
  assert.equal(mailLinkOf("https://shelf.example/#type=signup"), null);
  assert.equal(mailLinkOf("https://shelf.example/#type=recovery&access_token="), null);
  // Behind the "?" it is not Supabase speaking: anybody can write an address like that.
  assert.equal(mailLinkOf(`https://shelf.example/?${SIGN_IN}&type=recovery`), null);
  assert.equal(mailLinkOf(`https://shelf.example/?${SIGN_IN}&type=signup`), null);
});

test("a link that is too old or was used before is told apart", () => {
  const expired = "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  assert.equal(mailLinkOf(`https://shelf.example/#${expired}`), "failed");
  assert.equal(mailLinkOf(`https://shelf.example/reset#${expired}`), "failed");
  // Some versions of the server say it behind the "?" as well, or only there.
  assert.equal(mailLinkOf(`https://shelf.example/?${expired}#${expired}`), "failed");
  assert.equal(mailLinkOf(`https://shelf.example/?${expired}`), "failed");
  assert.equal(mailLinkOf("https://shelf.example/#error_description=Something"), "failed");
});

test("two kinds of link leave a password to be chosen first", () => {
  assert.equal(wantsPassword("recovery"), true);
  assert.equal(wantsPassword("invite"), true);
  for (const link of ["signup", "magiclink", "email_change", "pending", "failed", null] as const) assert.equal(wantsPassword(link), false);
});

test("somebody who is not signed in after a link is told what became of it", () => {
  // The address is confirmed even when the sign-in behind the link did not take.
  assert.equal(noticeFor("signup"), "confirmed");
  assert.equal(noticeFor("email_change"), "email_changed");
  assert.equal(noticeFor("pending"), "link_pending");
  // No link ends in silence.
  for (const link of ["recovery", "invite", "magiclink", "failed"] as const) assert.equal(noticeFor(link), "link_failed");
  assert.equal(noticeFor(null), null);
});
