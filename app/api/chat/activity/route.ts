import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {allowedChatRooms} from '@/lib/chatAccess';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {CHAT_UUID} from '@/lib/chatMembers';
import {parseChatRoom} from '@/lib/publicChat';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const cursor=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
export async function GET(req:NextRequest){
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const db=createChatAdminClient();if(!db)return json({error:'Notifications unavailable.'},503);
 const [result,unread]=await Promise.all([
  db.rpc('chat_activity_inbox',{actor:auth.user.id,rooms:allowedChatRooms(auth.access)}),
  db.rpc('chat_room_unread',{actor:auth.user.id,rooms:allowedChatRooms(auth.access)})
 ]);
 return result.error||unread.error?json({error:'Notifications unavailable.'},503):json({...result.data,...unread.data});
}
export async function POST(req:NextRequest){
 if(!requestOriginAllowed(req))return json({error:'Invalid origin.'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const body=await req.json().catch(()=>null);
 if(!body||!['mention','room','dm','all'].includes(body.kind))return json({error:'Invalid action.'},400);
 let rooms=allowedChatRooms(auth.access);
 if(body.kind==='room'){
  const room=parseChatRoom(body.room);
  if(!room)return json({error:'Invalid room.'},400);
  if(!rooms.includes(room))return json({error:'Room not available.'},403);
  rooms=[room];
 }
 const mentionThrough=body.kind==='dm'?0:body.mentionThrough;
 const dmThrough=['dm','all'].includes(body.kind)?body.dmThrough:0;
 if(!cursor(mentionThrough)||!cursor(dmThrough)||(['mention','dm'].includes(body.kind)&&(typeof body.id!=='string'||!CHAT_UUID.test(body.id))))return json({error:'Invalid notification cursor.'},400);
 if(body.kind==='room'&&!cursor(body.roomThrough??0))return json({error:'Invalid room cursor.'},400);
 const db=createChatAdminClient();if(!db)return json({error:'Notifications unavailable.'},503);
 if(body.kind==='room'&&body.roomThrough){
  const read=await db.rpc('read_chat_room',{actor:auth.user.id,room:rooms[0],through_seq:body.roomThrough});
  if(read.error)return json({error:'Could not mark room read.'},503);
 }
 const result=await db.rpc('read_chat_activity',{actor:auth.user.id,rooms,mention_through:mentionThrough,mention_id:body.kind==='mention'?body.id:null,dm_through:dmThrough,dm_conversation:body.kind==='dm'?body.id:null});
 return result.error?json({error:'Could not mark notifications read.'},503):json({ok:true});
}
