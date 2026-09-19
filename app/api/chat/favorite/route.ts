import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {CHAT_UUID} from '@/lib/chatMembers';
import {parseChatRoom} from '@/lib/publicChat';
import {favoriteLabel,type FavoriteTarget} from '@/lib/chatFavorite';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function handle(req:NextRequest,write:boolean){
 if(write&&!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 let target:FavoriteTarget|null=null;
 if(write){
  const payload=await req.json().catch(()=>null),value=payload?.favorite;
  if(value!==null){
   if(value?.kind==='room'&&typeof value.room==='string'&&parseChatRoom(value.room))target={kind:'room',room:parseChatRoom(value.room)!};
   else if(value?.kind==='dm'&&typeof value.conversationId==='string'&&CHAT_UUID.test(value.conversationId))target={kind:'dm',conversationId:value.conversationId};
   else return json({error:'invalid_favorite'},400);
  }
 }
 const admin=createChatAdminClient();if(!admin)return json({error:'Favorite is unavailable. Please try again.'},503);
 try{
  const {data,error}=await admin.rpc('chat_favorite',{p_user_id:auth.user.id,p_action:write?(target?'set':'clear'):'get',p_room:target?.kind==='room'?target.room:null,p_conversation:target?.kind==='dm'?target.conversationId:null});
  if(error)return json({error:error.message==='favorite_unavailable'?'This favorite is no longer available.':error.message==='member_required'?'Choose your chat name first.':'Favorite is unavailable. Please try again.'},['favorite_unavailable','member_required'].includes(error.message)?403:503);
  const favorite=data?.kind==='room'&&typeof data.room==='string'&&parseChatRoom(data.room)?{kind:'room',room:data.room,label:favoriteLabel({kind:'room',room:parseChatRoom(data.room)!})}:data?.kind==='dm'&&typeof data.conversationId==='string'&&CHAT_UUID.test(data.conversationId)&&typeof data.label==='string'?{kind:'dm',conversationId:data.conversationId,label:data.label}:null;
  return json({favorite});
 }catch{return json({error:'Favorite is unavailable. Please try again.'},503);}
}
export const GET=(req:NextRequest)=>handle(req,false);
export const POST=(req:NextRequest)=>handle(req,true);
