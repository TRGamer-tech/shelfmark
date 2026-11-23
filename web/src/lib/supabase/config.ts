// Where the server is. The values come from the environment at build time, see
// .env.example. Only the publishable key is ever used: it is meant to be public, and
// what a caller may do is decided by the server for the signed-in account.

export interface ServerConfig {
  url: string;
  key: string;
}

/** Null when the site was built without a server, which is shown as a plain notice. */
export function serverConfig(): ServerConfig | null {
  // Each name is spelled out so that the build can put the value in its place.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  if (!/^https?:\/\//.test(url) || key === "") return null;
  return { url, key };
}
