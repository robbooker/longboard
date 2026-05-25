import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { answerPedro, type PedroChatMessage } from "@/lib/pedro/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  if (!message) return null;
  return message.slice(0, 5000);
}

function cleanHistory(value: unknown): PedroChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-10)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;
      const content = typeof row.content === "string" ? row.content.trim().slice(0, 5000) : "";
      return role && content ? { role, content } : null;
    })
    .filter((item): item is PedroChatMessage => item !== null);
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const message = cleanMessage(body.message);
  if (!message) {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }

  try {
    const answer = await answerPedro({
      message,
      history: cleanHistory(body.history),
    });
    return NextResponse.json({
      ...answer,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[api/pedro] response failed", error);
    return NextResponse.json(
      {
        intent: "error",
        text: "I hit a snag while thinking through that. Try me again in a minute.",
      },
      { status: 500 },
    );
  }
}
