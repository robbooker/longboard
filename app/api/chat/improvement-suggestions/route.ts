import { NextResponse, type NextRequest } from "next/server";
import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { parseImprovementSuggestion } from "@/lib/chatImprovements";
import { findChatMember } from "@/lib/chatMembers";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
export const dynamic = "force-dynamic";

// #352: "Suggest an Improvement" in What's New, the same path as the FAQ's "Suggest a topic". The
// database posts it to the private Admins room, names the verified member, stamps the time and applies
// the rate limit. Only the text is read from the request, and nothing from that room comes back.
// People only: API tokens, and so bots, are refused both here and by the token route list.

const UNAVAILABLE = "Suggestions are unavailable. Please try again.";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (auth.apiToken || !allowedChatRooms(auth.access).includes("whats-new")) return json({ error: "Suggestions are for chat members." }, 403);
  const suggestion = parseImprovementSuggestion(await req.json().catch(() => null));
  if (!suggestion.ok) return json({ error: suggestion.error }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: UNAVAILABLE }, 503);
  try {
    const member = await findChatMember(admin, auth.user.id);
    if (!member) return json({ error: "Choose your chat name first." }, 403);
    const { error } = await admin.rpc("post_chat_improvement_suggestion", { p_member: member.id, p_text: suggestion.value });
    if (error?.message?.includes("improvement_suggestion_rate_limited"))
      return json({ error: "You've sent a few suggestions recently. Please try again later." }, 429);
    if (error) return json({ error: UNAVAILABLE }, 503);
    publishRoomEventAfterResponse("admins", { kind: "changed", topics: ["history"] });
    return json({ ok: true }, 201);
  } catch {
    return json({ error: UNAVAILABLE }, 503);
  }
}
