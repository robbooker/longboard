import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { boundChatActivity } from "@/lib/chatActivity";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { NextRequest, NextResponse } from "next/server";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function readActivity(req: NextRequest, auth: ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  // Temporary: a 10% sample of why windows reload the bell, to find what drives its call rate.
  if (Math.random() < 0.1) {
    const why = req.nextUrl.searchParams.get("why") ?? "none";
    console.info(`[chat-bell] why=${/^[a-z:+-]{1,60}$/.test(why) ? why : "other"}`);
  }
  const db = createChatAdminClient();
  if (!db) return json({ error: "Notifications unavailable." }, 503);
  const [result, unread] = await Promise.all([
    db.rpc("chat_activity_inbox", { actor: auth.user.id, rooms: allowedChatRooms(auth.access) }),
    db.rpc("chat_room_unread", { actor: auth.user.id, rooms: allowedChatRooms(auth.access) }),
  ]);
  return result.error || unread.error
    ? json({ error: "Notifications unavailable." }, 503)
    : json(boundChatActivity({ ...result.data, ...unread.data }));
}
