// Called once a day by the cron job in vercel.json. A free Supabase project is put to
// sleep when its database sees no activity for a week, and this is that activity. It
// uses the publishable key only, needs no sign-in and tells nothing about anyone.

import { serverConfig } from "@/lib/supabase/config";

export const maxDuration = 20;

export async function GET(): Promise<Response> {
  const config = serverConfig();
  // Always 200: a server that is asleep or not set up is no reason for the cron job to count failures.
  if (!config) return Response.json({ ok: false, reason: "not_configured" });
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/shelfmark_ping`, {
      method: "POST",
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return Response.json({ ok: false, reason: `http_${response.status}` });
    const answer = (await response.json().catch(() => null)) as { ok?: unknown; time?: unknown } | null;
    return Response.json({ ok: answer?.ok === true, time: typeof answer?.time === "number" ? answer.time : null });
  } catch {
    return Response.json({ ok: false, reason: "unreachable" });
  }
}
