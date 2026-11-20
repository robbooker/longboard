import { NextRequest, NextResponse } from "next/server";
import { gainersAuthorized } from "@/lib/chatGainers";
import { DESK_FEED_MAX_BYTES, DESK_FEED_TOKEN_ENV, parseTradingDeskSnapshot } from "@/lib/tradingDeskFeed";
import { saveDeskSnapshot } from "@/lib/tradingDeskStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * #469 Trading Desk feed: POST only. The home computer (scripts/trading-desk-feed) sends its latest
 * read-only TradeZero snapshot here with its own bearer token (CHAT_TRADING_DESK_FEED_TOKEN, compared
 * the way the gainers lookup's token is: SHA-256 of both, constant time). The token can do nothing
 * else: not read the desk, not reach any other route. The body is size-limited, checked field by
 * field (lib/tradingDeskFeed.ts) and saved as the one latest snapshot; nothing is sent back but "saved".
 */
export async function POST(request: NextRequest) {
  const secret = process.env[DESK_FEED_TOKEN_ENV];
  if (!secret || secret.length < 32) return json({ error: "feed_not_configured" }, 503);
  if (!gainersAuthorized(request.headers.get("authorization"), secret))
    return json({ error: "unauthorized" }, 401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    return json({ error: "invalid_content_type" }, 415);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > DESK_FEED_MAX_BYTES)
    return json({ error: "payload_too_large" }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_json" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > DESK_FEED_MAX_BYTES) {
        await reader.cancel();
        return json({ error: "payload_too_large" }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const feed = parseTradingDeskSnapshot(payload);
  if (!feed) return json({ error: "invalid_snapshot" }, 400);
  if ((await saveDeskSnapshot(feed)) !== "saved") return json({ error: "feed_unavailable" }, 503);
  return json({ saved: true });
}
