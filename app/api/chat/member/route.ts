import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { chatName, findChatMember, guestTokenHash } from "@/lib/chatMembers";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.status === 401 ? json({ signedIn: false, member: null }) : json({ error: auth.error }, auth.status);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  try { return json({ signedIn: true, member: await findChatMember(admin, auth.user.id) }); }
  catch { return json({ error: "member_lookup_failed" }, 503); }
}
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const payload = await req.json().catch(() => null);
  const name = chatName(payload?.displayName);
  if (!name) return json({ error: "Use a non-reserved chat name with 2–28 letters, numbers, spaces, periods, apostrophes, underscores or hyphens." }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  const { data, error } = await admin.rpc("longboard_chat_link_member", {
    p_user_id: auth.user.id, p_name: name, p_token_hash: guestTokenHash(payload?.token),
  });
  if (error?.code === "23505" && error.message.includes("longboard_chat_member_name_idx")) return json({ error: "That member name is taken. Please choose another." }, 409);
  if (error) return json({ error: error.message.includes("paused") ? "Chat is paused. Please link your name when the room reopens." : "Could not link your chat name. Please try again." }, 409);
  return json({ signedIn: true, member: { id: data.id, display_name: data.display_name, accepts_requests: data.accepts_requests } });
}
