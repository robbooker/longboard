import { NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatOwner } from "@/lib/chatOwner";
import { deskFromTradeZero } from "@/lib/tradingDesk";
import { sampleTradeZeroFeed } from "@/lib/tradingDeskSample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #468 Trading Desk (mock-up): GET only, read-only. The owner's own signed-in browser gets the desk;
 * everyone else (signed out, members, other admins, bots, API and agent tokens) gets the same 404 as
 * an address that doesn't exist, so the route doesn't say it is there.
 * For now the data is sample data (lib/tradingDeskSample.ts); the home computer's feed replaces it later.
 */
export async function GET() {
  const auth = await requireChatUser();
  if (!auth.ok || !isChatOwner(auth)) return json({ error: "not_found" }, 404);
  const now = new Date();
  return json({ desk: deskFromTradeZero(sampleTradeZeroFeed(now)), serverNow: now.toISOString() });
}
