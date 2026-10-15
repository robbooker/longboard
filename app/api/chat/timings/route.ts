// CHAT-TIMING intake. Sampled chat tabs post one small batch (navigator.sendBeacon) when they
// hide. The reply never matters to the browser, so every outcome other than a bad origin is a
// quiet 204: no error reaches a reader and nothing is retried. GET returns the server clock,
// read once per sampled session to correct delivery_lag for the device's clock offset.
import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { CHAT_TIMING_MAX_BODY, ChatTimingRateLimit, parseChatTimingBatch } from "@/lib/chatTimings";

export const dynamic = "force-dynamic";

const limiter = new ChatTimingRateLimit();
/** Until the chat_timings migration is applied, stop calling the database for a while. */
let missingUntil = 0;
const MISSING_TABLE = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

const quiet = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

function callerKey(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0].trim() : req.headers.get("x-real-ip")) || "unknown";
}

export async function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return new NextResponse(null, { status: 403 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > CHAT_TIMING_MAX_BODY) return quiet();
  if (Date.now() < missingUntil) return quiet();
  if (!limiter.allow(callerKey(req))) return quiet();
  const text = await req.text().catch(() => "");
  const batch = parseChatTimingBatch(text);
  if (!batch) return quiet();
  // Only signed-in chat readers count; nothing about who they are is stored.
  const auth = await requireChatUser(req).catch(() => null);
  if (!auth?.ok) return quiet();
  const db = createChatAdminClient();
  if (!db) return quiet();
  try {
    const { error } = await db.rpc("record_chat_timings", { p_device: batch.device, p_rows: batch.rows });
    if (error && MISSING_TABLE.has(String(error.code))) missingUntil = Date.now() + 10 * 60_000;
  } catch {}
  return quiet();
}
