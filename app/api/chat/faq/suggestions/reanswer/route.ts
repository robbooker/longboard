import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { parseFaqReanswer } from "@/lib/chatFaq";
import { writeFaqDraft } from "@/lib/chatFaqDraft";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #344: Marketing HQ asks for a new AI answer to one question here, with an optional note on what was
// wrong. Server-to-server, with the same write token as the review endpoint. The new answer only replaces
// the draft: the old one stays if the AI fails, and this never writes a FAQ item. An approved question's
// public answer stays until an admin approves the new one, and a rejected question goes back to waiting.

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

  const parsed = parseFaqReanswer(await req.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, parsed.error === "That suggestion is gone." ? 404 : 400);
  const { id, actorName, actorRef, note } = parsed.value;

  const db = createChatAdminClient();
  if (!db) return json({ error: "review_unavailable" }, 503);
  let draft: { topic: string; answer: string };
  try {
    const found = await db.from("chat_faq_suggestions").select("topic, ai_answer").eq("id", id).maybeSingle();
    if (found.error) return json({ error: "review_unavailable" }, 503);
    if (!found.data) return json({ error: "That suggestion is gone." }, 404);
    // What members read now, if it's on the FAQ; otherwise the draft being replaced.
    const item = await db.from("chat_faq_items").select("answer").eq("suggestion_id", id).maybeSingle();
    draft = await writeFaqDraft(db, { question: found.data.topic, note, previousAnswer: item.data?.answer ?? found.data.ai_answer });
  } catch (error) {
    // The message may quote the provider, never the question or the note.
    console.error("[chat-faq-reanswer]", error instanceof Error ? error.message.slice(0, 80) : "failed");
    return json({ error: "The AI couldn't write a new answer. The old one is still here." }, 502);
  }
  try {
    const { data, error } = await db.rpc("reanswer_chat_faq_suggestion", {
      p_id: id,
      p_actor_name: actorName,
      p_actor_ref: actorRef,
      p_note: note,
      p_topic: draft.topic,
      p_answer: draft.answer,
    });
    if (error?.message?.includes("faq_suggestion_not_found")) return json({ error: "That suggestion is gone." }, 404);
    if (error || !data) return json({ error: "review_unavailable" }, 503);
    return json(data);
  } catch {
    return json({ error: "review_unavailable" }, 503);
  }
}
