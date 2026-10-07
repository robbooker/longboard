import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { resolveClarityConversation } from "@/lib/clarity/pair";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Whether "Make clearer" is available in this DM, plus the caller's own originals.
 * Only rows the caller sent are ever read; the other participant's originals never leave the database.
 */
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  try {
    const target = await resolveClarityConversation(
      db,
      auth.user.id,
      req.nextUrl.searchParams.get("conversation"),
    );
    if (!target) return json({ enabled: false }, 404);
    const rows = await db
      .from("chat_clarity_drafts")
      .select(
        "message_id,original_body,suggested_body,intent,why_changed,ambiguity_note,used_suggestion,created_at",
      )
      .eq("conversation_id", target.conversationId)
      .eq("sender_member_id", target.senderMemberId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (rows.error) return json({ error: "unavailable" }, 503);
    return json({
      enabled: true,
      sender: target.sender,
      recipient: target.recipient,
      originals: rows.data ?? [],
    });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
