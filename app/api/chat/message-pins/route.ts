import {NextRequest} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {canAccessChatRoom} from '@/lib/chatAccess';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {CHAT_UUID} from '@/lib/chatMembers';
import {parseChatRoom} from '@/lib/publicChat';
import {projectRoomMessagePins} from '@/lib/chatRoomMessagePins';
import {readMessagePins,messagePinsJson as json,messagePinsError} from '@/lib/chatReads/messagePins';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return readMessagePins(req,await requireChatUser(req));}
export async function POST(req:NextRequest){
 if(!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 if(auth.user.role!=='admin')return json({error:'admin_required'},403);
 const raw=await req.text();if(raw.length>2048)return json({error:'invalid_pin'},400);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid_pin'},400);}
 const room=parseChatRoom(body?.room);
 if(!room||!['pin','unpin'].includes(body?.action)||typeof body?.messageId!=='string'||!CHAT_UUID.test(body.messageId))return json({error:'invalid_pin'},400);
 if(!canAccessChatRoom(auth.access,room))return json({error:'room_forbidden'},403);
 const db=createChatAdminClient();if(!db)return json({error:'pins_unavailable'},503);
 try{
  const {data,error}=await db.rpc('set_chat_room_message_pin',{p_actor:auth.user.id,p_room:room,p_message:body.messageId,p_pin:body.action==='pin'});
  return error?messagePinsError(error):json(projectRoomMessagePins(data,true));
 }catch{return json({error:'pins_unavailable'},503);}
}
