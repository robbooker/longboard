import { NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatOwner } from "@/lib/chatOwner";
import { deskFromTradeZero } from "@/lib/tradingDesk";
import { sampleTradeZeroFeed } from "@/lib/tradingDeskSample";
import { readDeskSnapshot } from "@/lib/tradingDeskStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #468 Trading Desk: GET only, read-only. The owner's own signed-in browser gets the desk; everyone
 * else (signed out, members, other admins, bots, API and agent tokens) gets the same 404 as an address
 * that doesn't exist, so the route doesn't say it is there.
 * #469: the data is the home computer's latest TradeZero snapshot (saved by ./feed), however old (the
 * desk turns amber when it is); until one has arrived, or when it can't be read, the sample data
 * (lib/tradingDeskSample.ts), which the desk marks "Sample data".
 */
export async function GET() {
  const auth = await requireChatUser();
  if (!auth.ok || !isChatOwner(auth)) return json({ error: "not_found" }, 404);
  const stored = await readDeskSnapshot();
  const now = new Date();
  return json({
    desk: deskFromTradeZero(stored?.feed ?? sampleTradeZeroFeed(now)),
    serverNow: now.toISOString(),
  });
}
