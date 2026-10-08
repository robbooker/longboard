import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { boundChatActivity } from "@/lib/chatActivity";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { createHash } from "node:crypto";
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
// Temporary (Oct 8): find the occasional multi-second bell calls. Logs every
// call over 500 ms, plus a 2% sample of all calls as a baseline. The account is
// a short one-way tag, never the id. `inflight` counts bell reads running on
// this server instance when this one started. Remove with the old-window cache above.
const SLOW_MS = 500;
let inflight = 0;
function logBell(req: NextRequest, account: string, inboxMs: number, unreadMs: number, concurrent: number) {
  const slow = Math.max(inboxMs, unreadMs) >= SLOW_MS;
  if (!slow && Math.random() >= 0.02) return;
  const why = req.nextUrl.searchParams.get("why") ?? "none";
  const tag = createHash("sha256").update(`chat-bell:${account}`).digest("hex").slice(0, 8);
  console.info(
    `[chat-bell-time] ${slow ? "slow" : "sample"} inbox=${inboxMs} unread=${unreadMs} inflight=${concurrent} acct=${tag} why=${/^[a-z:+-]{1,60}$/.test(why) ? why : "other"}`,
  );
}
export async function readActivity(req: NextRequest, auth: ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const rooms = allowedChatRooms(auth.access),
    key = `${auth.user.id}:${rooms.join(",")}`,
    now = Date.now();
  const cached = recent.get(key);
  if (!req.nextUrl.searchParams.has("why") && cached && now - cached.at < OLD_WINDOW_MS)
    return json(cached.body);
  const db = createChatAdminClient();
  if (!db) return json({ error: "Notifications unavailable." }, 503);
  const started = performance.now(),
    concurrent = ++inflight;
  const timed = async <T>(call: PromiseLike<T>) => {
    const value = await call;
    return { value, ms: Math.round(performance.now() - started) };
  };
  const [inbox, unreadCall] = await Promise.all([
    timed(db.rpc("chat_activity_inbox", { actor: auth.user.id, rooms })),
    timed(db.rpc("chat_room_unread", { actor: auth.user.id, rooms })),
  ]).finally(() => inflight--);
  logBell(req, auth.user.id, inbox.ms, unreadCall.ms, concurrent);
  const result = inbox.value,
    unread = unreadCall.value;
  if (result.error || unread.error) return json({ error: "Notifications unavailable." }, 503);
  const body = boundChatActivity({ ...result.data, ...unread.data });
  recent.delete(key);
  if ((forgotten.get(auth.user.id) ?? -Infinity) < now) recent.set(key, { at: now, body });
  if (recent.size > OLD_WINDOW_MAX) recent.delete(recent.keys().next().value!);
  return json(body);
}
