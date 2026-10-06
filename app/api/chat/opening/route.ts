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
 const thread=req.nextUrl.searchParams.get('thread');
 const room=parseChatRoom(req.nextUrl.searchParams.get('room'));
 if((thread&&!CHAT_UUID.test(thread))||(thread&&conversation)||(conversation?!CHAT_UUID.test(conversation):!room))return json({error:'invalid_target'},400);
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
   const result=await db.from('longboard_chat_direct_messages').select('id').eq('conversation_id',conversation).neq('sender_id',member.id).is('deleted_at',null).gt('seq',through).order('seq',{ascending:true}).limit(1);
   if(result.error)throw result.error;return json({messageId:result.data?.[0]?.id??null});
  }
  const read=await db.from('chat_room_reads').select('through_seq').eq('account_id',auth.user.id).eq('room_slug',room).maybeSingle();
  if(read.error)throw read.error;
  const eligible=()=>db.from('longboard_chat_messages').select('id,reply_to_id,unread_seq').eq('room_slug',room).eq('removed',false).is('deleted_at',null).or(`member_id.is.null,member_id.neq.${member.id}`).gt('unread_seq',read.data?.through_seq??0);
  const oldest=await eligible().order('unread_seq',{ascending:true}).limit(80);
  const latest=await eligible().order('unread_seq',{ascending:false}).limit(1);
  if(oldest.error||latest.error)throw oldest.error||latest.error;
  let first=oldest.data?.[0];
  if(thread){
   const parent=await db.from('longboard_chat_messages').select('id').eq('room_slug',room).eq('removed',false).eq('id',thread).maybeSingle();
   if(parent.error)throw parent.error;if(!parent.data)return json({error:'thread_not_found'},404);
   const children=await eligible().eq('reply_to_id',thread).order('unread_seq',{ascending:true}).limit(1);
   if(children.error)throw children.error;first=children.data?.[0];
   return json({messageId:first?.id??null,readThrough:first?.id===oldest.data?.[0]?.id?first?.unread_seq??0:0,latestThrough:latest.data?.[0]?.unread_seq??0});
  }
  // A removed ancestor can leave a hidden branch. Search a bounded candidate
  // page and cache ancestry; never silently open latest when valid unread may remain.
  type Ancestor={id:string;reply_to_id:string|null};
  const parents=new Map<string,Ancestor|null>();let lookups=0;
  for(const candidate of oldest.data??[]){
   let message:Ancestor|null=candidate;const seen=new Set<string>();
   while(message?.reply_to_id){
    if(seen.has(message.id)){message=null;break;}seen.add(message.id);
    const parentId:string=message.reply_to_id;
    if(!parents.has(parentId)){
     if(++lookups>20)return json({error:'opening_unavailable'},503);
     const parent:{data:Ancestor|null;error:unknown}=await db.from('longboard_chat_messages').select('id,reply_to_id').eq('room_slug',room).eq('removed',false).eq('id',parentId).maybeSingle();
     if(parent.error)throw parent.error;parents.set(parentId,parent.data);
    }
    message=parents.get(parentId)??null;
   }
   if(message)return json({messageId:message.id,unreadMessageId:candidate.id,parentId:candidate.reply_to_id,readThrough:candidate.unread_seq??0,latestThrough:latest.data?.[0]?.unread_seq??0});
  }
  if(oldest.data?.length)return json({error:'opening_unavailable'},503);
  return json({messageId:null,unreadMessageId:null,parentId:null,readThrough:0,latestThrough:0});
 }catch{return json({error:'opening_unavailable'},503);}
}
