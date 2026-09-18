import { allowedChatRooms } from '@/lib/chatAccess';
import { createChatAdminClient } from '@/lib/chatAdmin';
import type { ChatAuthResult } from '@/lib/chatAuth';
import { CHAT_UUID,findChatMember } from '@/lib/chatMembers';
import { SUMMARY_THREAD,summaryConversation } from '@/lib/chatRoomSummary';
import { NextRequest,NextResponse } from 'next/server';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function readInbox(req:NextRequest,auth:ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const conversationId = req.nextUrl.searchParams.get("conversation");
  if (conversationId===SUMMARY_THREAD) {
    const db=createChatAdminClient();if(!db)return json({error:"inbox_unavailable"},503);
    const before=req.nextUrl.searchParams.get("before");
    if(before&&!/^\d{1,16}$/.test(before))return json({error:"invalid_cursor"},400);
    let query=db.from("chat_summary_deliveries").select("id,seq,body,created_at").eq("account_id",auth.user.id).in("room_slug",allowedChatRooms(auth.access)).order("seq",{ascending:false}).limit(51);
    if(before)query=query.lt("seq",before);
    const result=await query;
    if(result.error)return json({error:"messages_unavailable"},503);
    return json({messages:(result.data??[]).slice(0,50).reverse().map(m=>({...m,sender_id:SUMMARY_THREAD})),hasMore:(result.data?.length??0)>50});
  }
  if (conversationId) {
    if (!CHAT_UUID.test(conversationId)) return json({ error: "invalid_conversation" }, 400);
    // Derive the participant from the verified chat identity, never request input.
    const client = createChatAdminClient();
    if (!client) return json({error:"inbox_unavailable"},503);
    let member;
    try { member=await findChatMember(client,auth.user.id); }
    catch { return json({error:"inbox_unavailable"},503); }
    if (!member) return json({error:"member_required"},403);
    const { data: conversation, error: lookupError } = await client.from("longboard_chat_conversations").select("id").eq("id", conversationId).or(`requester_id.eq.${member.id},recipient_id.eq.${member.id}`).maybeSingle();
    if (lookupError) return json({ error: "inbox_unavailable" }, 503);
    if (!conversation) return json({ error: "conversation_not_found" }, 404);
    const ids = req.nextUrl.searchParams.get("ids");
    const messageIds = ids?.split(",");
    if (messageIds && (messageIds.length > 100 || messageIds.some(id => !CHAT_UUID.test(id)))) return json({ error: "invalid_message_ids" }, 400);
    const before = req.nextUrl.searchParams.get("before");
    if (before && !/^\d{1,16}$/.test(before)) return json({ error: "invalid_cursor" }, 400);
    let query = client.from("longboard_chat_direct_messages").select("id, seq, sender_id, client_id, body, created_at, edited_at, deleted_at, revision, attachment_ids").eq("conversation_id", conversationId).order("seq", { ascending: false }).limit(51);
    if (messageIds) query = query.in("id", messageIds).limit(100);
    else if (before) query = query.lt("seq", before);
    const { data, error } = await query;
    if (error) return json({ error: "messages_unavailable" }, 503);
    return json({ messages: (messageIds ? data ?? [] : (data ?? []).slice(0, 50)).reverse(), hasMore: !messageIds && (data?.length ?? 0) > 50 });
  }
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  const { data, error } = await admin.rpc("longboard_chat_inbox", { p_user_id: auth.user.id });
  if(error)return json({error:"inbox_unavailable"},503);
  try { const summaries=await summaryConversation(admin,auth.user.id,auth.access);return json({conversations:summaries?[summaries,...(data??[])]:data}); }
  catch {return json({error:"inbox_unavailable"},503);}

}
