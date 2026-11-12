import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { rowNewsItems, rowNewsSince, rowNewsTicker } from "@/lib/chatGainersRowNews";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #437 Gainers Table: one stock's press releases from the last 30 days, newest first, for the panel
 * under its row. For the members who can open the Gainers room (the table's own rule), nobody else.
 * Only DilutionTracker's releases the lookup program already saved (#387, chat_gainers_news_for);
 * no outside news source is read. Read when a row is opened, not on the table's 15-second re-read.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const ticker = rowNewsTicker(request.nextUrl.searchParams.get("ticker"));
  if (!ticker) return json({ error: "invalid_ticker" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "news_unavailable" }, 503);
  const now = Date.now();
  try {
    const { data, error } = await db.rpc("chat_gainers_news_for", { p_tickers: [ticker], p_since: rowNewsSince(now) });
    if (error) return json({ error: "news_unavailable" }, 503);
    return json({ ticker, items: rowNewsItems(data, ticker, now) });
  } catch {
    return json({ error: "news_unavailable" }, 503);
  }
}
