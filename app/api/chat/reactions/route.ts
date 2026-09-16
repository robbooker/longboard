import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { CHAT_UUID } from "@/lib/chatMembers";
import { parseChatRoom } from "@/lib/publicChat";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const room = parseChatRoom(req.nextUrl.searchParams.get("room"));
  const id = req.nextUrl.searchParams.get("messageId") ?? "";
  if (!room || !CHAT_UUID.test(id)) return json({ error: "invalid_request" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  try {
    const message = await db.from("longboard_chat_messages").select("id").eq("id", id).eq("room_slug", room).maybeSingle();
    if (message.error) return json({ error: "unavailable" }, 503);
    if (!message.data) return json({ error: "not_found" }, 404);
    const reactions = await db.from("longboard_chat_reactions").select("guest_id").eq("message_id", id).eq("active", true).order("created_at").order("guest_id").limit(11);
    if (reactions.error) return json({ error: "unavailable" }, 503);
    const ids = (reactions.data ?? []).slice(0, 10).map(r => r.guest_id);
    if (!ids.length) return json({ names: [], hasMore: false });
    // Guest rows also back member reactions and preserve historical display names.
    const people = await db.from("longboard_chat_guests").select("id,display_name").in("id", ids);
    if (people.error) return json({ error: "unavailable" }, 503);
    const names = new Map((people.data ?? []).map(p => [p.id, p.display_name]));
    return json({ names: ids.map(id => names.get(id) ?? "Former member"), hasMore: (reactions.data?.length ?? 0) > 10 });
  } catch { return json({ error: "unavailable" }, 503); }
}
