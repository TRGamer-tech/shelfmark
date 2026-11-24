// Says in plain reasons why the server did not do what was asked. The pages turn a
// reason into a sentence in the reader's language.

import { ServerError } from "../sync.ts";

interface RpcFailure {
  message?: string | null;
  code?: string | null;
}

const looksOffline = (message: string) => /failed to fetch|fetch failed|networkerror|load failed|network request failed|aborted/i.test(message);

/** The reason behind a failed call of one of the shelfmark_ functions. */
export function rpcReason(error: RpcFailure, status: number): string {
  const message = error.message ?? "";
  // A refusal of the server: "shelfmark:<reason>".
  const refusal = /shelfmark:([a-z_]+)/.exec(message);
  if (refusal) return refusal[1];
  if (status === 0 || looksOffline(message)) return "network";
  if (status === 401 || status === 403 || error.code === "PGRST301" || error.code === "42501") return /api key/i.test(message) ? "key" : "signed_out";
  // The function is not there: schema.sql has not been run on this project, or an older one has.
  if (status === 404 || error.code === "PGRST202") return "setup";
  return error.code ? String(error.code) : `http_${status}`;
}

export function rpcError(error: RpcFailure, status: number): ServerError {
  return new ServerError(rpcReason(error, status), error.message ?? undefined);
}

interface AuthFailure {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

/**
 * Why signing in, signing up or changing the password did not work. The result is the
 * name of a text: one of the app's account_error_ texts, or server_error_ for the rest.
 */
export function authProblem(error: AuthFailure): { key: string; detail: string } {
  const message = error.message ?? "";
  const code = error.code ?? "";
  const is = (...codes: string[]) => codes.includes(code);
  if (is("invalid_credentials") || /invalid login credentials/i.test(message)) return { key: "account_error_credentials", detail: code };
  if (is("email_not_confirmed") || /email not confirmed/i.test(message)) return { key: "account_error_unconfirmed", detail: code };
  if (is("user_already_exists", "email_exists") || /already registered/i.test(message)) return { key: "account_error_exists", detail: code };
  if (is("weak_password", "same_password") || /password should be/i.test(message)) return { key: "account_error_weak", detail: code };
  if (is("validation_failed", "email_address_invalid") || /validate email|invalid format/i.test(message)) return { key: "account_error_email", detail: code };
  // Not the reader's doing: the mail service of the server has sent all it may for the hour, or does not write to this address.
  if (is("over_email_send_rate_limit") || /email rate limit/i.test(message)) return { key: "account_error_mail_limit", detail: code };
  if (is("email_address_not_authorized") || /address not authorized/i.test(message)) return { key: "account_error_mail_refused", detail: code };
  if (is("over_request_rate_limit") || error.status === 429) return { key: "account_error_rate", detail: code };
  if (is("signup_disabled", "email_provider_disabled")) return { key: "account_error_closed", detail: code };
  if (is("session_not_found", "session_expired", "refresh_token_not_found", "bad_jwt") || error.name === "AuthSessionMissingError") return { key: "account_error_signed_out", detail: code };
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || looksOffline(message)) return { key: "server_error_network", detail: "network" };
  return { key: "server_error_other", detail: code || String(error.status ?? "") || "unknown" };
}

/**
 * The text for a reason the server gave when asked for a book or for a step in a loan.
 * Two reasons mean something else there than with friends: "full" is too many open
 * questions, not too many friends.
 */
export function loanProblemKey(reason: string): string {
  switch (reason) {
    case "full":
      return "loan_error_full";
    case "not_friends":
      return "loan_error_not_friends";
    // Gone with the account of the other side, or put away on another device.
    case "unknown_loan":
      return "loan_error_gone";
    default:
      return serverProblemKey(reason);
  }
}

/** The text for a reason the server gave, as serverProblem in the app. */
export function serverProblemKey(reason: string): string {
  switch (reason) {
    case "network":
      return "server_error_network";
    case "setup":
      return "server_error_setup";
    case "key":
      return "server_error_key";
    case "unknown_code":
      return "server_error_unknown_code";
    case "own_code":
      return "server_error_own_code";
    case "full":
      return "server_error_full";
    case "taken":
      return "loan_error_taken";
    // The loan has moved on since the page last looked.
    case "not_allowed":
      return "loan_error_not_allowed";
    case "outdated":
      return "server_error_outdated";
    case "signed_out":
      return "account_error_signed_out";
    // The library is there, but this website cannot read it (lib/model.ts, inspectVault).
    case "newer":
      return "web_library_newer";
    case "unreadable":
      return "web_library_unreadable";
    default:
      return "server_error_other";
  }
}
