import { withMessageMemberships } from '@/lib/chatMembershipProjection';
import {processChatPushJobs} from '@/lib/chatPush';
import { canAccessChatRoom,canWriteChatRoom } from "@/lib/chatAccess";
import { readPublicRoomState,requestOriginAllowed } from "@/lib/chatAdmin";
import { attachmentIds } from '@/lib/chatAttachments';
import { requireChatUser } from "@/lib/chatAuth";
import { processBuddyJobs } from "@/lib/chatBuddyJobs";
import { findChatMember } from "@/lib/chatMembers";
import { readRoom } from '@/lib/chatReads/room';
import { parseSummaryCommand } from "@/lib/chatSummaryCommand";
import { parseChatRoom } from "@/lib/publicChat";
import { createClient } from "@supabase/supabase-js";
import { after,NextRequest,NextResponse } from "next/server";
import { randomUUID } from 'node:crypto';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGES_PER_TEN_MINUTES = 30;

type ChatPayload = {
  room?: unknown;
  action?: unknown;
  token?: unknown;
  displayName?: unknown;
  body?: unknown;
  messageId?: unknown;
  replyTo?: unknown;
  active?: unknown;
  attachmentIds?: unknown;
  clientId?: unknown;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizedBody(value: unknown) {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length >= 1 && body.length <= 600 ? body : null;
}

export async function GET(request:NextRequest) { return readRoom(request,await requireChatUser(request)); }

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);

  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 500);

  let payload: ChatPayload;
  try {
    payload = await request.json() as ChatPayload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "invalid_json" }, 400);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const roomSlug = parseChatRoom(payload.room);
  if (!roomSlug) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, roomSlug)) return json({error:"room_forbidden"},403);
  const action = typeof payload.action === "string" ? payload.action : "";
  if (action !== "session" && action !== "react" && !canWriteChatRoom(auth.access,roomSlug)) return json({error:roomSlug==="gainers"?"Gainers is a read-only broadcast channel.":"Only admins can post in announcement channels."},403);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action !== "session") {
    try {
      const room = await readPublicRoomState(admin, roomSlug);
      if (!room.isOpen) return json({ error: "chat_paused", room }, 423);
    } catch {
      return json({ error: "chat_status_unavailable" }, 503);
    }
  }

  let guest: { id: string; display_name: string };
  let memberId: string;
  try {
    const member = await findChatMember(admin, auth.user.id);
    if (!member) return json({ error: "member_required", message: "Choose your member chat name first." }, 409);
    guest = member;
    memberId = member.id;
  } catch { return json({ error: "member_lookup_failed" }, 503); }
  if (action === "register") return json({ error: "member_name_linked" }, 409);
  if (action === "session") return json({ guestId: guest.id, displayName: guest.display_name, memberId });

  if (action === "send") {
    let files:string[];
    try { files=attachmentIds(payload.attachmentIds); } catch { return json({error:'invalid_attachments'},400); }
    const body = files.length && payload.body === '' ? '' : normalizedBody(payload.body);
    if (body === null) return json({ error: "invalid_message" }, 400);
    if(payload.clientId!==undefined&&(typeof payload.clientId!=='string'||!UUID_PATTERN.test(payload.clientId)))return json({error:'invalid_client_id'},400);
    const clientId=typeof payload.clientId==='string'?payload.clientId:randomUUID();
    const prior=payload.clientId ? await admin.from('longboard_chat_messages').select('*').eq('member_id',memberId).eq('client_id',clientId).maybeSingle() : {data:null,error:null};
    if(prior.error)return json({error:'message_lookup_failed'},503);
    if(prior.data){
      if(prior.data.room_slug!==roomSlug||prior.data.body!==body||(prior.data.reply_to_id??null)!==(payload.replyTo??null)||JSON.stringify(prior.data.attachment_ids)!==JSON.stringify(files))return json({error:'send_conflict'},409);
      return json({message:(await withMessageMemberships(admin,[prior.data]))[0]});
    }
    if (parseSummaryCommand(body,roomSlug)) return json({error:"Use the summary command in the updated chat page. Refresh and try again."},400);

    let replyTo: string | null = null;
    if (payload.replyTo !== undefined && payload.replyTo !== null) {
      if (typeof payload.replyTo !== 'string' || !UUID_PATTERN.test(payload.replyTo)) return json({error:'invalid_reply'},400);
      const parent = await admin.from('longboard_chat_messages').select('id').eq('id',payload.replyTo).eq('room_slug',roomSlug).maybeSingle();
      if (parent.error) return json({error:'reply_lookup_failed'},503);
      if (!parent.data) return json({error:'reply_not_found'},404);
      replyTo = parent.data.id;
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent, error: rateError } = await admin
      .from("longboard_chat_messages")
      .select("created_at")
      .eq("guest_id", guest.id)
      .gte("created_at", tenMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES_PER_TEN_MINUTES);

    if (rateError) return json({ error: "rate_check_failed" }, 500);
    if ((recent?.length ?? 0) >= MAX_MESSAGES_PER_TEN_MINUTES) {
      return json({ error: "rate_limited", message: "Please pause before sending more messages." }, 429);
    }
    if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 1500) {
      return json({ error: "rate_limited", message: "Please wait a moment before sending again." }, 429);
    }

    const { data, error } = await admin.rpc('send_chat_attachment_message',{
      sender:memberId,room:roomSlug,label:guest.display_name,content:body,reply:replyTo,files,client:clientId,
    });

    if (error || !data) return json({ error: error?.message?.startsWith("attachment_") ? "A file is no longer ready. Remove it and attach it again." : "message_send_failed" }, error?.message?.startsWith("attachment_") ? 409 : 500);

    after(async()=>{try{await processChatPushJobs();}catch{/* Cron retries the durable outbox. */}});
    // The insert trigger has durably queued Buddy in the same transaction.
    // after() accelerates work, but cron recovers if the function stops here.
    if (data.buddy_status === 'pending') after(async () => {
      try { await processBuddyJobs({messageId:data.id,limit:1}); }
      catch { console.error('[api/chat] Deferred Buddy worker unavailable; durable queue retained'); }
    });
    return json({message:(await withMessageMemberships(admin,[data]))[0]});
  }

  if (action === "react") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
    if (!UUID_PATTERN.test(messageId) || typeof payload.active !== "boolean") {
      return json({ error: "invalid_reaction" }, 400);
    }

    const { data: target, error: targetError } = await admin.from("longboard_chat_messages")
      .select("id").eq("id", messageId).eq("room_slug", roomSlug).maybeSingle();
    if (targetError) return json({ error: "message_lookup_failed" }, 503);
    if (!target) return json({ error: "message_not_found" }, 404);
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("longboard_chat_reactions")
      .upsert({ message_id: messageId, guest_id: guest.id, active: payload.active, updated_at: now }, { onConflict: "message_id,guest_id" })
      .select("message_id, guest_id, active, created_at, updated_at")
      .single();

    if (error || !data) return json({ error: "reaction_save_failed" }, 500);
    return json({ reaction: data });
  }

  return json({ error: "unknown_action" }, 400);
}
