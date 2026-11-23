// What the address says when somebody arrives through the link of a mail.
//
// Supabase checks the link itself and then sends the browser on to this site, with its
// answer behind the "#" of the address: a sign-in, or a note that the link was no good.
// Where it sends people is not up to the site alone. A mail asked for on the website
// leads to /reset, one asked for in the Android app leads to the address of the site
// itself, so the answer has to be understood wherever it lands.

export type MailLink = "recovery" | "failed" | null;

/**
 * "recovery": the link of a "forgot the password" mail was opened, and a new password is
 * due. "failed": the link was too old or used before. Null for an ordinary visit, and
 * for the link that confirms a new account, which simply signs in.
 */
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
  if (hash.get("type") === "recovery" && (hash.get("access_token") ?? "") !== "") return "recovery";
  return null;
}
