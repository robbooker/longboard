import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient} from '@/lib/chatAdmin';
import {canAccessChatRoom} from '@/lib/chatAccess';
import {CHAT_UUID} from '@/lib/chatMembers';
import {parseChatRoom} from '@/lib/publicChat';
export const dynamic='force-dynamic';
const fields='id,room_slug,guest_id,member_id,author_label,body,bot_slug,reply_to_id,created_at,edited_at,attachment_ids';
export async function GET(req:NextRequest){
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const room=parseChatRoom(req.nextUrl.searchParams.get('room')),id=req.nextUrl.searchParams.get('messageId')||'';
 if(!room||!CHAT_UUID.test(id))return json({error:'Invalid conversation.'},400);
 if(!canAccessChatRoom(auth.access,room))return json({error:'Room not available.'},403);
 const db=createChatAdminClient();if(!db)return json({error:'Conversation unavailable.'},503);
 const parent=await db.from('longboard_chat_messages').select(fields).eq('room_slug',room).eq('id',id).maybeSingle();
 if(parent.error)return json({error:'Conversation unavailable.'},503);
 if(!parent.data)return json({error:'This comment was deleted or is unavailable.'},404);
 const replies=await db.from('longboard_chat_messages').select(fields).eq('room_slug',room).eq('reply_to_id',id).order('created_at',{ascending:false}).limit(101);
 if(replies.error)return json({error:'Replies unavailable.'},503);
 return json({parent:parent.data,replies:(replies.data??[]).slice(0,100).reverse(),hasMore:(replies.data?.length??0)>100});
}
