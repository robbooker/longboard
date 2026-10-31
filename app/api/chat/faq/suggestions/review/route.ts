import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { parseFaqReview } from "@/lib/chatFaq";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #338: Marketing HQ approves or rejects a FAQ suggestion here. Server-to-server:
// `Authorization: Bearer <CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN>`, a different secret from the read feed's.
// Marketing HQ verifies the signed-in admin and sends who it is; the database function does the rest,
// one decision per suggestion. This is the only code that can turn a suggestion into a FAQ item.

const MIN_SECRET_LENGTH = 32;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const digest = (text: string) => createHash("sha256").update(text).digest();

export async function POST(req: NextRequest) {
  const secret = process.env.CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN?.trim();
  // A write token that is also the read token isn't a separate secret, so it counts as not set.
  if (!secret || secret.length < MIN_SECRET_LENGTH || secret === process.env.CHAT_FAQ_SUGGESTIONS_READ_TOKEN?.trim())
    return json({ error: "review_not_configured" }, 503);
  const given = /^bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  // Hashing first makes both sides the same length, so the comparison never exits early on length.
  if (!given || !timingSafeEqual(digest(given), digest(secret))) return json({ error: "unauthorized" }, 401);

  const parsed = parseFaqReview(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, parsed.error === "That suggestion is gone." ? 404 : 400);
  const review = parsed.value;

  const db = createChatAdminClient();
  if (!db) return json({ error: "review_unavailable" }, 503);
  try {
    const { data, error } = await db.rpc("review_chat_faq_suggestion", {
      p_id: review.id,
      p_action: review.action,
      p_actor_name: review.actorName,
      p_actor_ref: review.actorRef,
      p_question: review.action === "approve" ? review.question : null,
      p_topic: review.action === "approve" ? review.topic : null,
      p_answer: review.action === "approve" ? review.answer : null,
    });
    if (error?.message?.includes("faq_suggestion_not_found")) return json({ error: "That suggestion is gone." }, 404);
    if (error?.message?.includes("invalid_faq_review")) return json({ error: "Add a question, topic and answer." }, 400);
    if (error || !data) return json({ error: "review_unavailable" }, 503);
    const result = data as { outcome: string; status: string; by?: string; at?: string };
    // Asked for what already happened (a double click): fine. Asked for the opposite: a conflict.
    const wanted = review.action === "approve" ? "approved" : "rejected";
    return json(result, result.status === wanted ? 200 : 409);
  } catch {
    return json({ error: "review_unavailable" }, 503);
  }
}
