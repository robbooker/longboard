import { NextRequest,NextResponse } from 'next/server';

import { canAccessChatRoom } from '@/lib/chatAccess';
import { createChatAdminClient } from '@/lib/chatAdmin';
import { CHAT_UUID } from '@/lib/chatMembers';
import { parseChatRoom } from '@/lib/publicChat';


import type { ChatAuthResult } from '@/lib/chatAuth';
export async function readCounts(req:NextRequest,auth:ChatAuthResult) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});if(!auth.ok)return json({error:auth.error},auth.status);
 const room=parseChatRoom(req.nextUrl.searchParams.get('room'));
 const ids=[...new Set((req.nextUrl.searchParams.get('ids')||'').split(',').filter(Boolean))];
 if(!room||ids.length>80||ids.some(id=>!CHAT_UUID.test(id)))return json({error:'Invalid conversations.'},400);
 if(!canAccessChatRoom(auth.access,room))return json({error:'Room not available.'},403);
 if(!ids.length)return json({counts:{}});
 const db=createChatAdminClient();if(!db)return json({error:'Counts unavailable.'},503);
 const result=await db.rpc('chat_thread_counts',{p_room:room,p_ids:ids});
 if(result.error)return json({error:'Counts unavailable.'},503);
 return json({counts:Object.fromEntries((result.data??[]).map((row:{message_id:string;reply_count:number})=>[row.message_id,Number(row.reply_count)]))});

}
