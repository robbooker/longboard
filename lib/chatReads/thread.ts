import {mergeConfirmedMessages} from '@/lib/chatPendingMessages';
import { withMessageMemberships } from '@/lib/chatMembershipProjection';
import { NextRequest,NextResponse } from 'next/server';

import { canAccessChatRoom } from '@/lib/chatAccess';
import { createChatAdminClient } from '@/lib/chatAdmin';
import { CHAT_UUID } from '@/lib/chatMembers';
import { parseChatRoom, isRecordingRoom } from '@/lib/publicChat';

const fields='id,room_slug,guest_id,member_id,author_label,body,bot_slug,reply_to_id,created_at,edited_at,deleted_at,removed,revision,attachment_ids,client_id,buddy_status';

import type { ChatAuthResult } from '@/lib/chatAuth';
export async function readThread(req:NextRequest,auth:ChatAuthResult) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});if(!auth.ok)return json({error:auth.error},auth.status);
 const room=parseChatRoom(req.nextUrl.searchParams.get('room')),id=req.nextUrl.searchParams.get('messageId')||'';
 if(!room||!CHAT_UUID.test(id))return json({error:'Invalid conversation.'},400);
 if(!canAccessChatRoom(auth.access,room))return json({error:'Room not available.'},403);
 if(isRecordingRoom(room))return json({error:'Replies are disabled in recording channels.'},403);
 const idsParam=req.nextUrl.searchParams.get('ids');const knownIds=idsParam?idsParam.split(','):[];
 if(knownIds.length>200||knownIds.some(id=>!CHAT_UUID.test(id)))return json({error:'invalid_message_ids'},400);
 const db=createChatAdminClient();if(!db)return json({error:'Conversation unavailable.'},503);
 const parent=await db.from('longboard_chat_messages').select(fields).eq('room_slug',room).eq('removed',false).eq('id',id).maybeSingle();
 if(parent.error)return json({error:'Conversation unavailable.'},503);
 if(!parent.data)return json({error:'This comment was deleted or is unavailable.'},404);
 const replies=await db.from('longboard_chat_messages').select(fields).eq('room_slug',room).eq('removed',false).eq('reply_to_id',id).order('created_at',{ascending:false}).limit(101);
 if(replies.error)return json({error:'Replies unavailable.'},503);
 const deleted=knownIds.length?await db.from('longboard_chat_messages').select(fields).eq('room_slug',room).eq('reply_to_id',id).eq('removed',true).in('id',knownIds).limit(200):{data:[],error:null};
 if(deleted.error)return json({error:'Replies unavailable.'},503);
 const canonical=mergeConfirmedMessages((replies.data??[]).slice(0,100).reverse(),deleted.data??[]);
 const projected=await withMessageMemberships(db,[parent.data,...canonical]);
 return json({parent:projected[0],replies:projected.slice(1),hasMore:(replies.data?.length??0)>100});

}
