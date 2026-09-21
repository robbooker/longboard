import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient} from '@/lib/chatAdmin';
import {canAccessChatRoom} from '@/lib/chatAccess';
import {CHAT_UUID,findChatMember} from '@/lib/chatMembers';
import {parseChatRoom} from '@/lib/publicChat';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
/** A fresh read-marker snapshot. Never use the client coordinator's cached activity here. */
export async function GET(req:NextRequest){
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const conversation=req.nextUrl.searchParams.get('conversation');
 const room=parseChatRoom(req.nextUrl.searchParams.get('room'));
 if(conversation?!CHAT_UUID.test(conversation):!room)return json({error:'invalid_target'},400);
 if(!conversation&&!canAccessChatRoom(auth.access,room!))return json({error:'room_forbidden'},403);
 const db=createChatAdminClient();if(!db)return json({error:'unavailable'},503);
 try{
  const member=await findChatMember(db,auth.user.id);if(!member)return json({error:'member_required'},403);
  if(conversation){
   const c=await db.from('longboard_chat_conversations').select('id,requester_id,recipient_id,requester_read_seq,recipient_read_seq,status').eq('id',conversation).or(`requester_id.eq.${member.id},recipient_id.eq.${member.id}`).maybeSingle();
   if(c.error)throw c.error;if(!c.data||c.data.status==='declined')return json({error:'conversation_not_found'},404);
   const other=c.data.requester_id===member.id?c.data.recipient_id:c.data.requester_id;
   const blocks=await db.from('longboard_chat_blocks').select('blocker_id').or(`and(blocker_id.eq.${member.id},blocked_id.eq.${other}),and(blocker_id.eq.${other},blocked_id.eq.${member.id})`).limit(1);
   if(blocks.error)throw blocks.error;if(blocks.data?.length)return json({error:'conversation_not_found'},404);
   const through=c.data.requester_id===member.id?c.data.requester_read_seq:c.data.recipient_read_seq;
   const result=await db.from('longboard_chat_direct_messages').select('id').eq('conversation_id',conversation).neq('sender_id',member.id).is('deleted_at',null).gt('seq',through).order('seq',{ascending:false}).limit(1);
   if(result.error)throw result.error;return json({messageId:result.data?.[0]?.id??null});
  }
  const read=await db.from('chat_room_reads').select('through_seq').eq('account_id',auth.user.id).eq('room_slug',room).maybeSingle();
  if(read.error)throw read.error;
  const result=await db.from('longboard_chat_messages').select('id,reply_to_id,unread_seq').eq('room_slug',room).or(`member_id.is.null,member_id.neq.${member.id}`).gt('unread_seq',read.data?.through_seq??0).order('unread_seq',{ascending:false}).limit(1);
  if(result.error)throw result.error;
  const readThrough=result.data?.[0]?.unread_seq??0;
  let message: {id:string;reply_to_id:string|null}|undefined=result.data?.[0];const seen=new Set<string>();
  // Threads can be nested. Resolve only within the authorized room; fail safely on cycles/deletions.
  for(let depth=0;message?.reply_to_id&&depth<20;depth++){
   if(seen.has(message.id))return json({messageId:null});seen.add(message.id);
   const parent: {data:{id:string;reply_to_id:string|null}|null;error:unknown}=await db.from('longboard_chat_messages').select('id,reply_to_id').eq('room_slug',room).eq('id',message.reply_to_id).maybeSingle();
   if(parent.error)throw parent.error;message=parent.data??undefined;
  }
  return json({messageId:message&&!message.reply_to_id?message.id:null,readThrough});
 }catch{return json({error:'opening_unavailable'},503);}
}
