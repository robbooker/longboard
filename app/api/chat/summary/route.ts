import { NextRequest,NextResponse } from 'next/server';
import { requireChatUser } from '@/lib/chatAuth';
import { createChatAdminClient,requestOriginAllowed } from '@/lib/chatAdmin';
import { canAccessChatRoom } from '@/lib/chatAccess';
import { parseChatRoom } from '@/lib/publicChat';
import { CHAT_UUID,findChatMember } from '@/lib/chatMembers';
import { deliverRoomSummary,SummaryError } from '@/lib/chatRoomSummary';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest){
 if(!requestOriginAllowed(req))return json({error:'Origin not allowed.'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const body=await req.json().catch(()=>null);
 const room=parseChatRoom(body?.room);
 if(!body||!room||typeof body.clientId!=='string'||!CHAT_UUID.test(body.clientId))return json({error:'Invalid summary request.'},400);
 if(!canAccessChatRoom(auth.access,room))return json({error:'You do not have access to this room.'},403);
 const db=createChatAdminClient();if(!db)return json({error:'Summary service is unavailable.'},503);
 try{
  if(!await findChatMember(db,auth.user.id))return json({error:'Choose your chat name first.'},409);
  return json(await deliverRoomSummary(db,auth.user.id,room,body.clientId));
 }catch(e){return json({error:e instanceof SummaryError?e.message:'Summary service is unavailable.'},e instanceof SummaryError?e.status:503);}
}
