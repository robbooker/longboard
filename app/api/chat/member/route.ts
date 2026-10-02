import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { chatName, findChatMember, guestTokenHash } from "@/lib/chatMembers";
import {CHAT_NAME_HELP} from "@/lib/chatDisplayName";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return auth.status === 401 ? json({ signedIn: false, member: null }) : json({ error: auth.error }, auth.status);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  try { return json({ signedIn: true, member: await findChatMember(admin, auth.user.id) }); }
  catch { return json({ error: "member_lookup_failed" }, 503); }
}
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const payload = await req.json().catch(() => null);
  if (payload?.action !== undefined && payload.action !== 'rename') return json({error:'invalid_action'},400);
  const rename = payload?.action === 'rename';
  const name = chatName(payload?.displayName);
  if (!name) return json({ error: CHAT_NAME_HELP }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  const { data, error } = await admin.rpc(rename ? 'chat_update_member_name' : 'longboard_chat_link_member', rename
    ? {p_account:auth.user.id,p_name:name}
    : {p_user_id:auth.user.id,p_name:name,p_token_hash:guestTokenHash(payload?.token)});
  if (error?.code === "23505" && error.message.includes("longboard_chat_member_name_idx")) return json({ error: "That member name is taken. Please choose another." }, 409);
  if (rename && error) return json({error:error.message.includes('invalid_display_name') ? CHAT_NAME_HELP : error.message.includes('member_required') ? 'Your chat membership could not be verified. Please try again.' : 'Your name could not be updated. Please try again.'},error.message.includes('member_required')?403:error.message.includes('invalid_display_name')?400:503);
  if (error) return json({ error: error.message.includes("paused") ? "Chat is paused. Please link your name when the room reopens." : "Could not link your chat name. Please try again." }, 409);
  return json({ signedIn: true, accountId:auth.user.id, member: { id: data.id, display_name: data.display_name, accepts_requests: data.accepts_requests, ...(data.name_revision===undefined?{}:{name_revision:data.name_revision}) } });
}
