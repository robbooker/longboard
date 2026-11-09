import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { retryWelcomes, supabaseWelcomeStore } from "@/lib/members/welcome";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** #390: the one automatic retry of a welcome email that failed to send (when no webhook came since). */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createChatAdminClient();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const results = await retryWelcomes(supabaseWelcomeStore(db), 10);
  return NextResponse.json(
    { retried: results.length, sent: results.filter((r) => r === "sent").length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
