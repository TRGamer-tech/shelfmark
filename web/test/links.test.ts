// What the address says when somebody arrives through the link of a mail.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mailLinkOf } from "../src/lib/supabase/links.ts";

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

test("confirming a new account, or an ordinary visit, asks for no new password", () => {
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}&type=signup`), null);
  assert.equal(mailLinkOf(`https://shelf.example/#${SIGN_IN}`), null);
  assert.equal(mailLinkOf("https://shelf.example/"), null);
  assert.equal(mailLinkOf("https://shelf.example/book?id=5"), null);
  assert.equal(mailLinkOf("https://shelf.example/#content"), null);
  assert.equal(mailLinkOf(""), null);
});

test("the word alone, without a sign-in, opens nothing", () => {
  assert.equal(mailLinkOf("https://shelf.example/#type=recovery"), null);
  assert.equal(mailLinkOf("https://shelf.example/#type=recovery&access_token="), null);
  // Behind the "?" it is not Supabase speaking: anybody can write an address like that.
  assert.equal(mailLinkOf(`https://shelf.example/?${SIGN_IN}&type=recovery`), null);
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
