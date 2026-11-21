// #482 AI Insights: an admin's dry run for any day. It reads that New York day's SS room, writes the
// write-up with the real model and returns the text without posting anything (no write-up, no SS
// note, nothing recorded). POST {"day":"2026-11-20"} while signed in as an admin.
import { requireAdmin } from "@/lib/auth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { validDay } from "@/lib/chatAiInsights";
import { claudeAiInsightsModel } from "@/lib/chatAiInsightsModel";
import { runAiInsightsDay } from "@/lib/chatAiInsightsServer";
import { supabaseAiInsightsStore } from "@/lib/chatAiInsightsStore";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "forbidden" }, 403);
  const auth = await requireAdmin(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const body = (await request.json().catch(() => null)) as { day?: unknown } | null;
  if (!validDay(body?.day)) return json({ error: "invalid_day", message: "Send a New York day as YYYY-MM-DD." }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  try {
    const result = await runAiInsightsDay({
      day: body.day,
      dryRun: true,
      store: supabaseAiInsightsStore(db),
      model: claudeAiInsightsModel,
      // A dry run never posts, so nothing is ever published.
      publish: async () => undefined,
    });
    return json(result);
  } catch (error) {
    console.error("[api/admin/ai-insights] dry run failed", error instanceof Error ? error.message : error);
    return json({ error: "ai_insights_failed" }, 502);
  }
}
