import type { NextRequest } from "next/server";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { parseFaqTopic } from "@/lib/chatFaq";
import { pagesJson, readBody, requirePagesMember } from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// #332 LB-FAQ: "Suggest a topic". Any chat member sends one; it is posted to the private Admins room
// by the database, which names the verified member and applies the rate limit. Members can't read
// that room, and suggestions never appear on the FAQ page.

const UNAVAILABLE = "Suggestions are unavailable. Please try again.";

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, memberId } = gate.viewer;
  const topic = parseFaqTopic(await readBody(req));
  if (!topic.ok) return pagesJson({ error: topic.error }, 400);
  try {
    const { error } = await admin.rpc("post_chat_faq_suggestion", { p_member: memberId, p_topic: topic.value });
    if (error?.message?.includes("faq_suggestion_rate_limited"))
      return pagesJson({ error: "You've sent a few suggestions recently. Please try again later." }, 429);
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    publishRoomEventAfterResponse("admins", { kind: "changed", topics: ["history"] });
    return pagesJson({ ok: true }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
