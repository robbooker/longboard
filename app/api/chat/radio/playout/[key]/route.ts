import { NextResponse, type NextRequest } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { sharedRadioPlayout, validRadioListenKey, type RadioPlayoutRow } from "@/lib/chatRadioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browsers ask again on every poll; the CDN answers all listeners from one copy and refreshes it
 * about every 5 seconds, so the database is read once per window however many are listening.
 * (The same headers TraderRadio.ai uses for its own playout.) Vercel's CDN caches by
 * CDN-Cache-Control and ignores Cache-Control when it is present; Cache-Control is what browsers get.
 */
const SHARED = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "public, s-maxage=5, stale-while-revalidate=20",
};
/** The relay answers in well under a second; a struggling database is not waited on. */
const READ_TIMEOUT_MS = 3_500;

/** One read of the relay row, or null when it cannot be read (no database, an error or a timeout). */
async function readPlayoutRow(): Promise<RadioPlayoutRow | null> {
  const db = createChatAdminClient();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from("squawkbox_relay_state")
      .select("events:payload->events,generatedAt:payload->generatedAt,updated_at")
      .eq("key", "playout")
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
      .maybeSingle();
    return error ? null : (data as RadioPlayoutRow | null);
  } catch {
    return null;
  }
}

/**
 * #415 Trader Radio: what is on air. No sign-in check here (it would cost a database call per
 * listener per poll); the listening key in the address is the proof, and only /api/chat/radio/listen
 * hands one out. Reads one row, and of it only the squawk list and two timestamps; #497 this server
 * keeps that read for a few seconds and shares it across keys and concurrent requests.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!validRadioListenKey(key))
    return NextResponse.json(
      { error: "radio_key_expired" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  // The key is checked above on every request; only then is the shared playout handed over.
  const playout = await sharedRadioPlayout(readPlayoutRow);
  // An unreadable relay is answered as "off air" and cached like any other answer (here and on the
  // CDN), so a database having a bad minute is asked once per window rather than once per listener.
  return NextResponse.json(playout, { headers: SHARED });
}
