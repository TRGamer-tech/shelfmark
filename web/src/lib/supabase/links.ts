// What the address says when somebody arrives through the link of a mail.
//
// Supabase checks the link itself and then sends the browser on to this site, with its
// answer behind the "#" of the address: a sign-in, or a note that the link was no good.
// Where it sends people is not up to the site alone. A mail asked for on the website
// leads to /reset, one asked for in the Android app, and every confirmation mail, leads
// to the address of the site itself. So the answer has to be understood wherever it lands.

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

/**
 * What to tell somebody who came through a link and is not signed in afterwards, as the
 * word the sign-in page understands. A confirmation counts even when the sign-in behind
 * it did not take: Supabase only hands that link out once the address is confirmed.
 */
export function noticeFor(link: MailLink): "confirmed" | "email_changed" | "link_pending" | "link_failed" | null {
  switch (link) {
    case null:
      return null;
    case "signup":
      return "confirmed";
    case "email_change":
      return "email_changed";
    case "pending":
      return "link_pending";
    default:
      return "link_failed";
  }
}
