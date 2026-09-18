import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {canAccessChatRoom} from '@/lib/chatAccess';
import {CHAT_UUID} from '@/lib/chatMembers';
import {parseChatRoom} from '@/lib/publicChat';
export async function POST(req:NextRequest){
 const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
 if(!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const p=await req.json().catch(()=>null);const room=p?.kind==='room'?parseChatRoom(p.room):null;
 const conversation=p?.kind==='dm'&&typeof p.conversationId==='string'&&CHAT_UUID.test(p.conversationId)?p.conversationId:null;
 if((!room&&!conversation)||!['read','set'].includes(p?.action))return json({error:'invalid_target'},400);
 if(!canAccessChatRoom(auth.access,room??'social'))return json({error:'room_forbidden'},403);
 const ids=p.action==='read'?p.messageIds:[p.messageId];
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!CHAT_UUID.test(id)))return json({error:'invalid_target'},400);
 if(p.action==='set'&&(!['like','heart','laugh'].includes(p.emoji)||typeof p.active!=='boolean'))return json({error:'invalid_reaction'},400);
 const db=createChatAdminClient();if(!db)return json({error:'unavailable'},503);
 const args={p_actor:auth.user.id,p_room:room,p_conversation:conversation};
 const {data,error}=await(p.action==='read'?db.rpc('read_chat_message_reactions',{...args,p_messages:ids}):db.rpc('set_chat_message_reaction',{...args,p_message:ids[0],p_emoji:p.emoji,p_active:p.active}));
 if(error){const codes:Record<string,number>={room_forbidden:403,member_required:403,conversation_not_found:404,message_not_found:404,conversation_unavailable:403,chat_paused:423,invalid_reaction:400};return json({error:codes[error.message]?error.message:'reactions_unavailable'},codes[error.message]??503);}
 return json({messages:data});
}
