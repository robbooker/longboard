import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient,requestOriginAllowed } from "@/lib/chatAdmin";
import { attachmentIds } from "@/lib/chatAttachments";
import { requireChatUser } from "@/lib/chatAuth";
import { DM_ERRORS } from "@/lib/chatDirectMessages";
import { CHAT_UUID } from "@/lib/chatMembers";
import { readInbox } from '@/lib/chatReads/inbox';
import { SUMMARY_THREAD } from "@/lib/chatRoomSummary";
import { NextRequest,NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req:NextRequest) { return readInbox(req,await requireChatUser(req)); }
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const payload = await req.json().catch(() => null);
  if(payload?.action==="read"&&payload.target===SUMMARY_THREAD){
    if(typeof payload.clientId!=="string"||!CHAT_UUID.test(payload.clientId))return json({error:"invalid_client_id"},400);
    const db=createChatAdminClient();if(!db)return json({error:"inbox_unavailable"},503);
    const rooms=allowedChatRooms(auth.access);
    const message=await db.from("chat_summary_deliveries").select("seq").eq("account_id",auth.user.id).eq("id",payload.clientId).in("room_slug",rooms).maybeSingle();
    if(message.error)return json({error:"inbox_unavailable"},503);
    if(!message.data)return json({error:"message_not_found"},404);
    const result=await db.from("chat_summary_deliveries").update({read_at:new Date().toISOString()}).eq("account_id",auth.user.id).in("room_slug",rooms).lte("seq",message.data.seq).is("read_at",null);
    return result.error?json({error:"inbox_unavailable"},503):json({ok:true});
  }
  if (payload?.action === "edit" || payload?.action === "delete") {
    if (typeof payload.target !== "string" || !CHAT_UUID.test(payload.target)) return json({ error: "invalid_target" }, 400);
    if (typeof payload.messageId !== "string" || !CHAT_UUID.test(payload.messageId)) return json({ error: "invalid_message_id" }, 400);
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 || payload.expectedRevision > 2147483647) return json({ error: "invalid_revision" }, 400);
    if (payload.action === "edit" && (typeof payload.body !== "string" || payload.body.length > 2000)) return json({ error: "invalid_message" }, 400);
    const admin = createChatAdminClient();
    if (!admin) return json({ error: "server_not_configured" }, 503);
    const { data, error } = await admin.rpc("longboard_chat_dm_message_action", {
      p_user_id: auth.user.id, p_conversation: payload.target, p_message: payload.messageId,
      p_action: payload.action, p_expected_revision: payload.expectedRevision,
      p_body: payload.action === "edit" ? payload.body : null,
    });
    if (error) return json({ error: DM_ERRORS[error.message] || "Could not update this message. Please try again." }, error.message === "message_not_found" || error.message === "conversation_not_found" ? 404 : 409);
    return json(data);
  }
  const actions = ["request", "send", "accept", "decline", "block", "unblock", "report", "read", "settings"];
  if (!payload || !actions.includes(payload.action)) return json({ error: "invalid_action" }, 400);
  if (payload.action !== "settings" && (typeof payload.target !== "string" || !CHAT_UUID.test(payload.target))) return json({ error: "invalid_target" }, 400);
  if (["request", "send", "read"].includes(payload.action) && (typeof payload.clientId !== "string" || !CHAT_UUID.test(payload.clientId))) return json({ error: "invalid_client_id" }, 400);
  let files:string[];
  try { files=attachmentIds(payload.attachmentIds); } catch { return json({error:"invalid_files"},400); }
  if(files.length&&payload.action!=="send")return json({error:"Accept the request before sharing files."},400);
  if (["request", "send", "report"].includes(payload.action) && (typeof payload.body !== "string" || (!payload.body.trim()&&!files.length) || payload.body.length > (payload.action === "report" ? 1000 : 2000))) return json({ error: "invalid_message" }, 400);
  if (payload.action === "settings" && typeof payload.value !== "boolean") return json({ error: "invalid_settings" }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  const { data, error } = await admin.rpc(files.length?"longboard_chat_dm_media_send":"longboard_chat_dm_action", {
    ...(files.length?{p_files:files}:{}),
    p_user_id: auth.user.id, p_action: payload.action, p_target: payload.action === "settings" ? null : payload.target,
    p_body: typeof payload.body === "string" ? payload.body : null,
    p_client_id: typeof payload.clientId === "string" ? payload.clientId : null,
    p_value: typeof payload.value === "boolean" ? payload.value : null,
  });
  if (error) {
    const key = Object.keys(DM_ERRORS).find((code) => error.message === code);
    return json({ error: key ? DM_ERRORS[key] : "Could not update your inbox. Please try again." }, key?.includes("rate_limited") ? 429 : 409);
  }
  return json(data);
}
