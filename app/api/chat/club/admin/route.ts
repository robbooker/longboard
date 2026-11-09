import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { easternDay } from "@/lib/chatGainersFacts";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { isChatAdmin } from "@/lib/chatRole";
import { postAdminPick, readDayState, resumeAutomatic } from "@/lib/stockClubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const TICKER = /^[A-Z][A-Z.]{0,9}$/;

async function adminOnly(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return { denied: json({ error: auth.error }, auth.status) };
  // People only: an API token (and so a bot) never sets the pick.
  if (auth.apiToken || !isChatAdmin(auth)) return { denied: json({ error: "admin_only" }, 403) };
  const db = createChatAdminClient();
  if (!db) return { denied: json({ error: "club_unavailable" }, 503) };
  return { db };
}

/** #386: today's Booker Stock Club state for admins: automatic picks on or off, candidates, posts. */
export async function GET(request: NextRequest) {
  const { denied, db } = await adminOnly(request);
  if (denied) return denied;
  try {
    const day = easternDay();
    const state = await readDayState(db, day);
    return json({
      day,
      locked: state.locked,
      candidates: state.candidates,
      candidatesAt: state.candidatesAt,
      posted: state.posted,
    });
  } catch {
    return json({ error: "club_unavailable" }, 503);
  }
}

/**
 * #386: an admin sets today's pick by hand ({ ticker }), which posts it now and stops automatic
 * changes for the rest of the day; or turns automatic picks back on ({ action: "resume" }).
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const { denied, db } = await adminOnly(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { ticker?: unknown; action?: unknown } | null;
  try {
    if (body?.action === "resume") return json(await resumeAutomatic(db));
    const ticker = typeof body?.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    if (!TICKER.test(ticker)) return json({ error: "invalid_ticker" }, 400);
    const result = await postAdminPick(db, ticker);
    if (!result.posted)
      return json({ error: result.reason ?? "not_posted" }, result.reason === "no_quote" ? 404 : 409);
    publishRoomEventAfterResponse("club", { kind: "changed", topics: ["history"] });
    return json({ posted: true, ticker, messageId: result.messageId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return json(
      { error: message === "room_paused" ? "room_paused" : "club_unavailable" },
      message === "room_paused" ? 423 : 503,
    );
  }
}
