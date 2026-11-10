import { NextResponse, type NextRequest } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { radioPlayout, validRadioListenKey, type RadioPlayoutRow } from "@/lib/chatRadioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browsers ask again on every poll; the CDN answers all listeners from one copy and refreshes it
 * about every 5 seconds, so the database is read once per window however many are listening.
 * (The same headers TraderRadio.ai uses for its own playout.)
 */
const SHARED = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "public, s-maxage=5, stale-while-revalidate=20",
};
/** The relay answers in well under a second; a struggling database is not waited on. */
const READ_TIMEOUT_MS = 3_500;

/**
 * #415 Trader Radio: what is on air. No sign-in check here (it would cost a database call per
 * listener per poll); the listening key in the address is the proof, and only /api/chat/radio/listen
 * hands one out. Reads one row, and of it only the squawk list and two timestamps.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!validRadioListenKey(key))
    return NextResponse.json(
      { error: "radio_key_expired" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  let row: RadioPlayoutRow | null = null;
  const db = createChatAdminClient();
  if (db) {
    try {
      const { data, error } = await db
        .from("squawkbox_relay_state")
        .select("events:payload->events,generatedAt:payload->generatedAt,updated_at")
        .eq("key", "playout")
        .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
        .maybeSingle();
      if (!error) row = data as RadioPlayoutRow | null;
    } catch {
      row = null;
    }
  }
  // An unreadable relay is answered as "off air" and cached like any other answer, so a database
  // having a bad minute is asked once per window rather than once per listener.
  return NextResponse.json(radioPlayout(row), { headers: SHARED });
}
