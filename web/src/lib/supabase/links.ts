// What the address says when somebody arrives through the link of a mail.
//
// Supabase checks the link itself and then sends the browser on to this site, with its
// answer behind the "#" of the address: a sign-in, or a note that the link was no good.
// Where it sends people is not up to the site alone. A mail asked for on the website
// leads to /confirmed or /reset. One that named no page, as older versions of the
// Android app send them, leads to the address of the site itself. So the answer has to
// be understood wherever it lands.

/**
 * - "signup": the link that confirms a new account. The address is confirmed and the
 *   reader is signed in.
 * - "recovery": the link of a "forgot the password" mail. A new password is due.
 * - "invite": somebody was invited by whoever runs the server. They are signed in and
 *   have no password yet, so one is due as well.
 * - "magiclink": a link that signs in and nothing else.
 * - "email_change": the link that confirms a new e-mail address.
 * - "pending": the first of two confirmations was accepted, the other mail is still to be
 *   opened. Nobody is signed in by it.
 * - "failed": the link was too old or used before.
 * - null: an ordinary visit.
 */
export type MailLink = "signup" | "recovery" | "invite" | "magiclink" | "email_change" | "pending" | "failed" | null;

export function mailLinkOf(address: string): MailLink {
  const hashAt = address.indexOf("#");
  const beforeHash = hashAt < 0 ? address : address.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const hash = new URLSearchParams(hashAt < 0 ? "" : address.slice(hashAt + 1));
  // A failure is reported behind the "?" as well by some versions of the server.
  const query = new URLSearchParams(queryAt < 0 ? "" : beforeHash.slice(queryAt + 1));
  for (const key of ["error", "error_code", "error_description"]) {
    if (hash.has(key) || query.has(key)) return "failed";
  }
  if ((hash.get("access_token") ?? "") === "") {
    // No sign-in and no failure, only a sentence: that is how the first half of a change of address is answered.
    return (hash.get("message") ?? "") !== "" ? "pending" : null;
  }
  switch (hash.get("type")) {
    case "signup":
      return "signup";
    case "recovery":
      return "recovery";
    case "invite":
      return "invite";
    case "email_change":
      return "email_change";
    case "magiclink":
      return "magiclink";
    default:
      // A sign-in of a kind this site does not send for, e.g. after a third-party login. Nothing to say about it.
      return null;
  }
}

/** True when the link leaves the reader to choose a password before anything else. */
export function wantsPassword(link: MailLink): boolean {
  return link === "recovery" || link === "invite";
}

export interface LinkSession {
  access_token: string;
  refresh_token: string;
}

/**
 * The sign-in a link carries behind the "#", or null when it carries none that can be
 * taken. Only what stands behind the "#" counts: behind the "?" anybody can write.
 */
export function sessionOf(address: string): LinkSession | null {
  const hashAt = address.indexOf("#");
  if (hashAt < 0) return null;
  const hash = new URLSearchParams(address.slice(hashAt + 1));
  const access_token = hash.get("access_token") ?? "";
  const refresh_token = hash.get("refresh_token") ?? "";
  return access_token !== "" && refresh_token !== "" ? { access_token, refresh_token } : null;
}

/**
 * The address as it should read once the link was understood: without what stands
 * behind the "#", and without the words of a failure behind the "?". Whatever else was
 * asked for stays. Nothing of a link remains where a reload or the Back button would
 * tell the same story again.
 */
export function withoutLink(address: string): string {
  const hashAt = address.indexOf("#");
  const beforeHash = hashAt < 0 ? address : address.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = new URLSearchParams(queryAt < 0 ? "" : beforeHash.slice(queryAt + 1));
  for (const key of ["error", "error_code", "error_description"]) query.delete(key);
  const rest = query.toString();
  return rest === "" ? base : `${base}?${rest}`;
}

/**
 * What becomes of somebody who arrived through the link of a mail, once it is known
 * whether they are signed in.
 *
 * - "confirmed": the link confirmed a new account. They belong on the confirmation
 *   page, signed in or not: Supabase only hands that link out once the address is
 *   confirmed, so it counts even when the sign-in behind it did not take.
 * - "stale": the link was too old or used before. The confirmation page says what that
 *   usually means. Most links that fail are confirmation links a mail program opened first.
 * - "password": signed in, and a new password is due.
 * - "welcome": signed in. The shelf says in a passing line what the link did.
 * - "turned_away": not signed in. The sign-in page says why.
 * - "none": nothing to do or to say, either because there was no link, or because the
 *   page for a new password speaks for itself.
 */
export type Outcome = "confirmed" | "stale" | "password" | "welcome" | "turned_away" | "none";

export function outcomeOf(link: MailLink, signedIn: boolean, onReset: boolean): Outcome {
  if (link === null) return "none";
  if (link === "signup") return "confirmed";
  if (link === "failed") {
    // On the page for a new password the link was one for a password, and that page says so itself.
    if (onReset) return signedIn ? "welcome" : "none";
    return "stale";
  }
  if (signedIn) return wantsPassword(link) ? "password" : "welcome";
  return onReset ? "none" : "turned_away";
}

/**
 * What to tell somebody who came through a link and is not signed in afterwards, as the
 * word the sign-in page understands. Null for the links the confirmation page speaks for.
 */
export function noticeFor(link: MailLink): "email_changed" | "link_pending" | "link_failed" | null {
  switch (link) {
    case null:
    case "signup":
      return null;
    case "email_change":
      return "email_changed";
    case "pending":
      return "link_pending";
    default:
      return "link_failed";
  }
}
