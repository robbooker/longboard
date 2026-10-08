import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { boundChatActivity } from "@/lib/chatActivity";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { NextRequest, NextResponse } from "next/server";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
// Windows opened before today's chat updates (Oct 8) poll the bell every 2 s and
// can't reload themselves; they send no `why`. Serve them a result up to 10 s
// old from this instance so they can't hammer the database. Current windows
// always read fresh. Remove once those old windows are gone.
const OLD_WINDOW_MS = 10_000,
  OLD_WINDOW_MAX = 500;
const recent = new Map<string, { at: number; body: unknown }>(),
  forgotten = new Map<string, number>();
export function forgetRecentActivity(account: string) {
  for (const key of recent.keys()) if (key.startsWith(`${account}:`)) recent.delete(key);
  // A read already in flight must not store what it saw before this change.
  forgotten.delete(account);
  forgotten.set(account, Date.now());
  if (forgotten.size > OLD_WINDOW_MAX) forgotten.delete(forgotten.keys().next().value!);
}
export async function readActivity(req: NextRequest, auth: ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  // Temporary: a 10% sample of why windows reload the bell, to find what drives its call rate.
  if (Math.random() < 0.1) {
    const why = req.nextUrl.searchParams.get("why") ?? "none";
    console.info(`[chat-bell] why=${/^[a-z:+-]{1,60}$/.test(why) ? why : "other"}`);
  }
  const rooms = allowedChatRooms(auth.access),
    key = `${auth.user.id}:${rooms.join(",")}`,
    now = Date.now();
  const cached = recent.get(key);
  if (!req.nextUrl.searchParams.has("why") && cached && now - cached.at < OLD_WINDOW_MS)
    return json(cached.body);
  const db = createChatAdminClient();
  if (!db) return json({ error: "Notifications unavailable." }, 503);
  const [result, unread] = await Promise.all([
    db.rpc("chat_activity_inbox", { actor: auth.user.id, rooms }),
    db.rpc("chat_room_unread", { actor: auth.user.id, rooms }),
  ]);
  if (result.error || unread.error) return json({ error: "Notifications unavailable." }, 503);
  const body = boundChatActivity({ ...result.data, ...unread.data });
  recent.delete(key);
  if ((forgotten.get(auth.user.id) ?? -Infinity) < now) recent.set(key, { at: now, body });
  if (recent.size > OLD_WINDOW_MAX) recent.delete(recent.keys().next().value!);
  return json(body);
}
