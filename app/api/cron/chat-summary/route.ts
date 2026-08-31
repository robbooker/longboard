import { NextRequest, NextResponse } from "next/server";
import { easternHour, generateChatSummary } from "@/lib/chatSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  if (easternHour() !== 23) {
    return NextResponse.json({ status: "skipped", reason: "not_summary_hour" });
  }

  try {
    return NextResponse.json(await generateChatSummary());
  } catch (error) {
    console.error("[api/cron/chat-summary] failed", error);
    return NextResponse.json({ error: "chat_summary_failed" }, { status: 500 });
  }
}
