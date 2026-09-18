import { canAccessChatRoom } from '@/lib/chatAccess';
import { readPublicRoomState } from '@/lib/chatAdmin';
import type { ChatAuthResult } from '@/lib/chatAuth';
import { parseChatRoom } from '@/lib/publicChat';
import { NextRequest,NextResponse } from 'next/server';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function readRoom(request:NextRequest,auth:ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const room = parseChatRoom(request.nextUrl.searchParams.get("room"));
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({error:"room_forbidden"},403);
  try {
    return json(await readPublicRoomState(undefined, room));
  } catch {
    return json({ error: "chat_status_unavailable" }, 503);
  }

}
