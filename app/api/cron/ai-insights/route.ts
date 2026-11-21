// #482 AI Insights: the daily write-up of the SS room, at 8:30 PM New York on trading days.
// vercel.json runs this at 00:30 and 01:30 UTC, Tuesday to Saturday (8:30 PM New York in summer and
// in winter); cronDecision lets only the run in New York's 8 PM hour go ahead. Posting is once per
// New York day (the database's record), so a second run does nothing.
import { NextRequest, NextResponse } from "next/server";
import { cronDecision } from "@/lib/chatAiInsights";
import { claudeAiInsightsModel } from "@/lib/chatAiInsightsModel";
import { runAiInsightsDay } from "@/lib/chatAiInsightsServer";
import { supabaseAiInsightsStore } from "@/lib/chatAiInsightsStore";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { publishRoomEvent } from "@/lib/chatRealtimePublish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;
  const decision = cronDecision();
  if (!decision.run) return NextResponse.json({ status: "skipped", reason: decision.reason, day: decision.day });
  const db = createChatAdminClient();
  if (!db) return NextResponse.json({ error: "chat_server_not_configured" }, { status: 503 });
  try {
    const result = await runAiInsightsDay({
      day: decision.day,
      dryRun: false,
      store: supabaseAiInsightsStore(db),
      model: claudeAiInsightsModel,
      publish: (room, row) => publishRoomEvent(room, { kind: "message", eventType: "INSERT", row }),
    });
    console.info("[api/cron/ai-insights]", JSON.stringify(result));
    return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
  } catch (error) {
    console.error("[api/cron/ai-insights] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "ai_insights_failed" }, { status: 500 });
  }
}
