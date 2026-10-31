import type { NextRequest } from "next/server";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { parseFaqSuggestion } from "@/lib/chatFaq";
import { draftFaqSuggestionAfterResponse } from "@/lib/chatFaqDraft";
import { pagesJson, readBody, requirePagesMember } from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// #332 LB-FAQ: "Suggest a topic". Any chat member sends one; it is posted to the private Admins room
// by the database, which names the verified member and applies the rate limit. Members can't read
// that room, and suggestions never appear on the FAQ page. #338: it also waits for an admin's review
// on Marketing HQ. The AI's draft is written after the response, so it never delays or blocks this.

const UNAVAILABLE = "Suggestions are unavailable. Please try again.";

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, memberId } = gate.viewer;
  const question = parseFaqSuggestion(await readBody(req));
  if (!question.ok) return pagesJson({ error: question.error }, 400);
  try {
    const { data, error } = await admin.rpc("post_chat_faq_suggestion", { p_member: memberId, p_topic: question.value });
    if (error?.message?.includes("faq_suggestion_rate_limited"))
      return pagesJson({ error: "You've sent a few suggestions recently. Please try again later." }, 429);
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    publishRoomEventAfterResponse("admins", { kind: "changed", topics: ["history"] });
    const suggestionId = (data as { suggestionId?: unknown } | null)?.suggestionId;
    if (typeof suggestionId === "string") draftFaqSuggestionAfterResponse(admin, suggestionId, question.value);
    return pagesJson({ ok: true }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
