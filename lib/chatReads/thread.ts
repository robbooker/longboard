import { withMessageMemberships } from '@/lib/chatMembershipProjection';
import { NextRequest,NextResponse } from 'next/server';

import { canAccessChatRoom } from '@/lib/chatAccess';
import { createChatAdminClient } from '@/lib/chatAdmin';
import { CHAT_UUID } from '@/lib/chatMembers';
import { parseChatRoom } from '@/lib/publicChat';

const fields='id,room_slug,guest_id,member_id,author_label,body,bot_slug,reply_to_id,created_at,edited_at,attachment_ids,client_id,buddy_status';

import type { ChatAuthResult } from '@/lib/chatAuth';
export async function readThread(req:NextRequest,auth:ChatAuthResult) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});if(!auth.ok)return json({error:auth.error},auth.status);
 const room=parseChatRoom(req.nextUrl.searchParams.get('room')),id=req.nextUrl.searchParams.get('messageId')||'';
 if(!room||!CHAT_UUID.test(id))return json({error:'Invalid conversation.'},400);
 if(!canAccessChatRoom(auth.access,room))return json({error:'Room not available.'},403);
 const db=createChatAdminClient();if(!db)return json({error:'Conversation unavailable.'},503);
 const parent=await db.from('longboard_chat_messages').select(fields).eq('room_slug',room).eq('id',id).maybeSingle();
 if(parent.error)return json({error:'Conversation unavailable.'},503);
 if(!parent.data)return json({error:'This comment was deleted or is unavailable.'},404);
 const replies=await db.from('longboard_chat_messages').select(fields).eq('room_slug',room).eq('reply_to_id',id).order('created_at',{ascending:false}).limit(101);
 if(replies.error)return json({error:'Replies unavailable.'},503);
 const projected=await withMessageMemberships(db,[parent.data,...(replies.data??[]).slice(0,100).reverse()]);
 return json({parent:projected[0],replies:projected.slice(1),hasMore:(replies.data?.length??0)>100});

}
