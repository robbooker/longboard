// CHAT-TIMING retention: timings are kept 30 days. Runs daily (vercel.json), like the other
// chat cleanup crons; quiet no-op until the chat_timings table exists.
import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";

export const dynamic = "force-dynamic";
const CHAT_TIMING_RETENTION_DAYS = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createChatAdminClient();
  if (!db) return NextResponse.json({ error: "Cleanup unavailable" }, { status: 503 });
  const cutoff = new Date(Date.now() - CHAT_TIMING_RETENTION_DAYS * 86_400_000).toISOString();
  const { error, count } = await db.from("chat_timings").delete({ count: "exact" }).lt("created_at", cutoff);
  if (error) {
    if (["42P01", "PGRST205"].includes(String(error.code)))
      return NextResponse.json({ deleted: 0, ready: false }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "Cleanup failed; it runs again tomorrow." }, { status: 503 });
  }
  return NextResponse.json({ deleted: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
