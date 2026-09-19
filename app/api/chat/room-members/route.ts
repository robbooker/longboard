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
  const params = req.nextUrl.searchParams;
  const room = parseChatRoom(params.get("room"));
  const cursor = params.get("cursor");
  const raw = params.get("q") ?? "";
  const query = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!params.has("room") || !room || ["room", "cursor", "q"].some(key => params.getAll(key).length > 1) ||
      (cursor !== null && !CHAT_UUID.test(cursor)) || raw.length > 112 || query.length > 28 || !/^[\p{L}\p{N} _.'-]*$/u.test(query)) {
    return json({ error: "Invalid member list query." }, 400);
  }
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_access_required" }, 403);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "Member list is unavailable. Please try again." }, 503);
  try {
    const { data, error } = await admin.rpc("longboard_chat_room_members", {
      p_user_id: auth.user.id, p_room: room, p_cursor: cursor, p_query: query,
    });
    if (error) return json({ error: error.message === "member_required" ? "Choose your chat name to view members." : error.message === "room_access_required" ? "room_access_required" : "Member list is unavailable. Please try again." }, ["member_required", "room_access_required"].includes(error.message) ? 403 : 503);
    const rows = (data ?? []) as Array<{ id: string; display_name: string }>;
    // Explicit projection: never expose account IDs, provider metadata or email.
    const members = rows.slice(0, 50).map(member => ({ id: member.id, display_name: member.display_name }));
    return json({ members, nextCursor: rows.length > 50 ? members.at(-1)!.id : null });
  } catch { return json({ error: "Member list is unavailable. Please try again." }, 503); }
}
