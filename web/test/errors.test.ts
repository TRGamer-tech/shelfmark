import assert from "node:assert/strict";
import { test } from "node:test";
import { authProblem, loanProblemKey, rpcReason, serverProblemKey } from "../src/lib/supabase/errors.ts";
import { reasonOf, ServerError } from "../src/lib/sync.ts";

test("a refusal of the server is told by its reason", () => {
  assert.equal(rpcReason({ code: "P0001", message: "shelfmark:conflict" }, 400), "conflict");
  assert.equal(rpcReason({ code: "P0001", message: "shelfmark:unknown_code" }, 400), "unknown_code");
  assert.equal(rpcReason({ code: "P0001", message: "shelfmark:signed_out" }, 400), "signed_out");
  assert.equal(rpcReason({ code: "PGRST301", message: "JWT expired" }, 401), "signed_out");
  assert.equal(rpcReason({ code: "42501", message: "permission denied for function shelfmark_hello" }, 401), "signed_out");
  assert.equal(rpcReason({ message: "Invalid API key" }, 401), "key");
  assert.equal(rpcReason({ code: "PGRST202", message: "Could not find the function public.shelfmark_hello in the schema cache" }, 404), "setup");
  assert.equal(rpcReason({ message: "TypeError: Failed to fetch" }, 0), "network");
  assert.equal(rpcReason({ code: "54000", message: "something" }, 500), "54000");
  assert.equal(rpcReason({}, 500), "http_500");
  assert.equal(reasonOf(new ServerError("conflict")), "conflict");
  assert.equal(reasonOf(new TypeError("Failed to fetch")), "network");
});

test("problems with signing in name the text the app uses for them", () => {
  assert.equal(authProblem({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }).key, "account_error_credentials");
  assert.equal(authProblem({ code: "email_not_confirmed", message: "Email not confirmed", status: 400 }).key, "account_error_unconfirmed");
  assert.equal(authProblem({ code: "user_already_exists", message: "User already registered", status: 422 }).key, "account_error_exists");
  assert.equal(authProblem({ code: "weak_password", message: "Password should be at least 6 characters.", status: 422 }).key, "account_error_weak");
  assert.equal(authProblem({ code: "validation_failed", message: "Unable to validate email address: invalid format", status: 400 }).key, "account_error_email");
  assert.equal(authProblem({ status: 429, message: "slow down" }).key, "account_error_rate");
  // The mail service of the server has sent its few mails for the hour: that is said as what it is.
  assert.equal(authProblem({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }).key, "account_error_mail_limit");
  assert.equal(authProblem({ status: 429, message: "Email rate limit exceeded" }).key, "account_error_mail_limit");
  assert.equal(authProblem({ status: 400, code: "email_address_not_authorized", message: "Email address not authorized" }).key, "account_error_mail_refused");
  assert.equal(authProblem({ code: "signup_disabled", message: "Signups not allowed" }).key, "account_error_closed");
  assert.equal(authProblem({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }).key, "server_error_network");
  assert.equal(authProblem({ name: "AuthSessionMissingError", message: "Auth session missing!" }).key, "account_error_signed_out");
  // Without a code the words of the server still tell.
  assert.equal(authProblem({ message: "Invalid login credentials" }).key, "account_error_credentials");
  const other = authProblem({ code: "unexpected_failure", status: 500, message: "boom" });
  assert.equal(other.key, "server_error_other");
  assert.equal(other.detail, "unexpected_failure");
});

test("reasons of the friend functions have the app's words", () => {
  assert.equal(serverProblemKey("unknown_code"), "server_error_unknown_code");
  assert.equal(serverProblemKey("own_code"), "server_error_own_code");
  assert.equal(serverProblemKey("full"), "server_error_full");
  assert.equal(serverProblemKey("network"), "server_error_network");
  assert.equal(serverProblemKey("setup"), "server_error_setup");
  assert.equal(serverProblemKey("something_new"), "server_error_other");
});

test("what the server says about a loan is told in the app's words", () => {
  // The refusals of shelfmark_loan_ask and shelfmark_loan_act, as they come back.
  assert.equal(rpcReason({ code: "P0001", message: "shelfmark:taken" }, 400), "taken");
  assert.equal(rpcReason({ code: "P0001", message: "shelfmark:not_allowed" }, 400), "not_allowed");
  assert.equal(serverProblemKey("taken"), "loan_error_taken");
  // The loan has moved on. The page looks again and shows where it stands.
  assert.equal(serverProblemKey("not_allowed"), "loan_error_not_allowed");
  // A loan that is gone, with the account of the other side for instance.
  assert.equal(loanProblemKey("unknown_loan"), "loan_error_gone");
  // Two reasons mean something else with loans than with friends.
  assert.equal(loanProblemKey("full"), "loan_error_full");
  assert.equal(serverProblemKey("full"), "server_error_full");
  assert.equal(loanProblemKey("not_friends"), "loan_error_not_friends");
  // Everything else is said as anywhere.
  for (const reason of ["taken", "not_allowed", "outdated", "setup", "network", "signed_out", "something_new"]) assert.equal(loanProblemKey(reason), serverProblemKey(reason), reason);
  // A server from before the loans does not have the function at all.
  assert.equal(rpcReason({ code: "PGRST202", message: "Could not find the function public.shelfmark_loan_ask(p_book, p_friend) in the schema cache" }, 404), "setup");
  assert.equal(serverProblemKey("setup"), "server_error_setup");
  // And a client from before the loans is told that it is too old.
  assert.equal(rpcReason({ code: "P0001", message: "shelfmark:outdated" }, 400), "outdated");
  assert.equal(serverProblemKey("outdated"), "server_error_outdated");
});
