// Server-side only: the member token is sent only to ShortScout's fixed endpoint.
const SHORTSCOUT_ORIGIN = "https://xejuximbbpnzqylukrsn.supabase.co";
const PAID_LEVELS = new Set(["monthly", "annual", "lifetime", "mastermind"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ShortScoutMembership =
  | { ok: true; subject: string; level: string }
  | { ok: false; reason: "invalid_session" | "not_paid" | "unavailable" };

/** Never accept a caller-supplied subject, email, membership, or service-key health response. */
export async function verifyShortScoutMembership(
  accessToken: string,
  request: typeof fetch = fetch,
): Promise<ShortScoutMembership> {
  if (!accessToken || accessToken.length > 16384 || /\s/.test(accessToken)) {
    return { ok: false, reason: "invalid_session" };
  }
  try {
    const response = await request(`${SHORTSCOUT_ORIGIN}/functions/v1/chat-auth-bridge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) return { ok: false, reason: "invalid_session" };
    if (response.status === 403) return { ok: false, reason: "not_paid" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const result: unknown = await response.json();
    if (!result || typeof result !== "object") return { ok: false, reason: "unavailable" };
    const body = result as Record<string, unknown>;
    if (body.allowed !== true || typeof body.userId !== "string" || !UUID.test(body.userId)
      || typeof body.membershipLevel !== "string" || !PAID_LEVELS.has(body.membershipLevel)) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, subject: body.userId, level: body.membershipLevel };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
