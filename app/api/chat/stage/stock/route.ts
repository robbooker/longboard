import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { gainersQuotes } from "@/lib/chatGainersQuotes";
import { gainersShares } from "@/lib/chatGainersShares";
import { parseStageTicker } from "@/lib/chatStageLive";
import { ChatTimingRateLimit } from "@/lib/chatTimings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// #512: an open stage asks for the stock the host put on screen when it is off today's table, and
// again every 15 seconds while it stays there: 20 in five minutes for each tab watching. 60 in five
// minutes per account (per server instance) leaves room for three tabs, and stops this address
// being used to look up one ticker after another.
const STOCK_LOOKUPS = 60;
const STOCK_LOOKUPS_WINDOW_MS = 5 * 60_000;
const limiter = new ChatTimingRateLimit(STOCK_LOOKUPS, STOCK_LOOKUPS_WINDOW_MS);

/**
 * #507: what the app can really say about a stock the host put on screen that is NOT on today's
 * Gainers Table: its price, % today and volume today (Polygon's snapshot) and its shares outstanding
 * (Polygon's ticker details), through the Gainers Table's own cached reads (15 seconds, and a day).
 * Nothing else: no borrow, cash, float or ownership, and no lookup on the home machine is started.
 * For the members who can open the Gainers room (the table's own rule). Asked only by an open stage
 * showing such a stock. A part Polygon has no answer for is null, and the stage shows "—".
 * #512: at most 60 lookups in five minutes per account (429 "rate_limited" after that; the stage
 * keeps the numbers it has, or "—", and asks again a minute later).
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const param = request.nextUrl.searchParams.get("ticker");
  const ticker = parseStageTicker(param);
  if (!ticker || ticker !== param) return json({ error: "invalid_ticker" }, 400);
  if (!limiter.allow(auth.user.id)) return json({ error: "rate_limited" }, 429);
  const [quotes, shares] = await Promise.all([
    gainersQuotes([ticker]).catch(() => null),
    gainersShares([ticker]).catch(() => null),
  ]);
  return json({ ticker, quote: quotes?.get(ticker) ?? null, sharesOutstanding: shares?.get(ticker) ?? null });
}
