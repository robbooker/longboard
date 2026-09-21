import { withMessageMemberships } from '@/lib/chatMembershipProjection';
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
    const { data: conversation, error: lookupError } = await client.from("longboard_chat_conversations").select("id,requester_id,recipient_id,status").eq("id", conversationId).or(`requester_id.eq.${member.id},recipient_id.eq.${member.id}`).maybeSingle();
    if (lookupError) return json({ error: "inbox_unavailable" }, 503);
    if (!conversation) return json({ error: "conversation_not_found" }, 404);
    const ids = req.nextUrl.searchParams.get("ids");
    const messageIds = ids?.split(",");
    if (messageIds && (messageIds.length > 100 || messageIds.some(id => !CHAT_UUID.test(id)))) return json({ error: "invalid_message_ids" }, 400);
    const before = req.nextUrl.searchParams.get("before");
    if (before && !/^\d{1,16}$/.test(before)) return json({ error: "invalid_cursor" }, 400);
    const around=req.nextUrl.searchParams.get('around'),after=req.nextUrl.searchParams.get('after');
    if((around&&!CHAT_UUID.test(around))||(after&&!/^\d{1,16}$/.test(after))||[Boolean(around),Boolean(after),Boolean(before),Boolean(ids)].filter(Boolean).length>1)return json({error:'invalid_cursor'},400);
    if(around||after){
      if(conversation.status==='declined')return json({error:'conversation_not_found'},404);
      const other=conversation.requester_id===member.id?conversation.recipient_id:conversation.requester_id;
      const blocks=await client.from('longboard_chat_blocks').select('blocker_id').or(`and(blocker_id.eq.${member.id},blocked_id.eq.${other}),and(blocker_id.eq.${other},blocked_id.eq.${member.id})`).limit(1);
      if(blocks.error)return json({error:'inbox_unavailable'},503);
      if(blocks.data?.length)return json({error:'conversation_not_found'},404);
    }
    const fields="id, seq, sender_id, client_id, body, created_at, edited_at, deleted_at, revision, attachment_ids";
    if(around){
      const anchor=await client.from('longboard_chat_direct_messages').select(fields).eq('conversation_id',conversationId).eq('id',around).maybeSingle();
      if(anchor.error)return json({error:'messages_unavailable'},503);
      if(!anchor.data)return json({error:'message_not_found'},404);
      const [older,newer]=await Promise.all([
        client.from('longboard_chat_direct_messages').select(fields).eq('conversation_id',conversationId).lt('seq',anchor.data.seq).order('seq',{ascending:false}).limit(26),
        client.from('longboard_chat_direct_messages').select(fields).eq('conversation_id',conversationId).gt('seq',anchor.data.seq).order('seq',{ascending:true}).limit(26),
      ]);
      if(older.error||newer.error)return json({error:'messages_unavailable'},503);
      return json({messages:[...(older.data??[]).slice(0,25).reverse(),anchor.data,...(newer.data??[]).slice(0,25)],hasMore:(older.data?.length??0)>25,hasNewer:(newer.data?.length??0)>25});
    }
    if(after){
      const page=await client.from('longboard_chat_direct_messages').select(fields).eq('conversation_id',conversationId).gt('seq',after).order('seq',{ascending:true}).limit(51);
      if(page.error)return json({error:'messages_unavailable'},503);
      return json({messages:(page.data??[]).slice(0,50),hasNewer:(page.data?.length??0)>50});
    }
    let query = client.from("longboard_chat_direct_messages").select("id, seq, sender_id, client_id, body, created_at, edited_at, deleted_at, revision, attachment_ids").eq("conversation_id", conversationId).order("seq", { ascending: false }).limit(51);
    if (messageIds) query = query.in("id", messageIds).limit(100);
    else if (before) query = query.lt("seq", before);
    const { data, error } = await query;
    if (error) return json({ error: "messages_unavailable" }, 503);
    return json({ messages: await withMessageMemberships(client,(messageIds ? data ?? [] : (data ?? []).slice(0, 50)).reverse()), hasMore: !messageIds && (data?.length ?? 0) > 50 });
  }
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  const { data, error } = await admin.rpc("longboard_chat_inbox", { p_user_id: auth.user.id });
  if(error)return json({error:"inbox_unavailable"},503);
  try { const summaries=await summaryConversation(admin,auth.user.id,auth.access);return json({conversations:summaries?[summaries,...(data??[])]:data}); }
  catch {return json({error:"inbox_unavailable"},503);}

}
