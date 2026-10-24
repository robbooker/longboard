import { createHash } from "node:crypto";
import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { boundChatActivity, type ChatActivity } from "@/lib/chatActivity";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { chatBellCountDifferences, chatBellCountersRollout, chatBellCountsOnly } from "@/lib/chatBellCounters";
import { NextRequest, NextResponse } from "next/server";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
// Reads without a `why` (old windows and the batched updates path) get a result up to
// 10 s old from this instance, so bursts can't hammer the database. Kept after the
// Oct 14 busy-hour check: the bell holds at ~206 calls/min with this in place.
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
// D-212: until 20261024120000_chat_activity_counters.sql is applied, use the inbox (and look
// again a minute later), so the app works before and after the migration.
let countersMissingUntil = 0;
const missingFunction = (error: { code?: string; message?: string }) =>
  error.code === "PGRST202" || error.code === "42883" || /chat_activity_counts/.test(error.message ?? "");
const accountTag = (account: string) => createHash("sha256").update(account).digest("hex").slice(0, 8);
export function resetBellCountersForTests() {
  countersMissingUntil = 0;
  recent.clear();
  forgotten.clear();
}

export async function readActivity(req: NextRequest, auth: ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const rooms = allowedChatRooms(auth.access),
    now = Date.now();
  // D-212: the closed bell asks for the numbers only (`lists=0`); see lib/chatBellCounters.ts.
  const rollout = chatBellCountersRollout(process.env.CHAT_BELL_COUNTERS);
  const counters =
    req.nextUrl.searchParams.get("lists") === "0" &&
    (rollout === "all" || (rollout === "admins" && auth.access.admin)) &&
    now >= countersMissingUntil;
  const key = `${auth.user.id}:${rooms.join(",")}:${counters ? "counts" : "full"}`;
  const cached = recent.get(key);
  if (!req.nextUrl.searchParams.has("why") && cached && now - cached.at < OLD_WINDOW_MS)
    return json(cached.body);
  const db = createChatAdminClient();
  if (!db) return json({ error: "Notifications unavailable." }, 503);
  let body: ChatActivity | null = null,
    roomUnread: Awaited<ReturnType<typeof db.rpc>> | null = null;
  if (counters) {
    const [counts, unread] = await Promise.all([
      db.rpc("chat_activity_counts", { actor: auth.user.id, rooms }),
      db.rpc("chat_room_unread", { actor: auth.user.id, rooms }),
    ]);
    if (counts.error && missingFunction(counts.error)) countersMissingUntil = Date.now() + 60_000;
    if (unread.error) return json({ error: "Notifications unavailable." }, 503);
    roomUnread = unread;
    // Any failure of the counters falls back to the inbox below, never to empty numbers.
    if (!counts.error && counts.data && typeof counts.data === "object")
      body = boundChatActivity({ ...chatBellCountsOnly(counts.data), ...unread.data } as ChatActivity);
  }
  if (!body) {
    const [result, unread, check] = await Promise.all([
      db.rpc("chat_activity_inbox", { actor: auth.user.id, rooms }),
      roomUnread ?? db.rpc("chat_room_unread", { actor: auth.user.id, rooms }),
      rollout === "compare" && now >= countersMissingUntil
        ? db.rpc("chat_activity_counts", { actor: auth.user.id, rooms })
        : null,
    ]);
    if (result.error || unread.error) return json({ error: "Notifications unavailable." }, 503);
    if (check?.error && missingFunction(check.error)) countersMissingUntil = Date.now() + 60_000;
    else if (check && !check.error) {
      // Numbers only, never message text; the account is a short one-way tag.
      const differs = chatBellCountDifferences(result.data, check.data);
      if (differs.length || Math.random() < 0.02)
        console.info(
          `[chat-bell-counters] ${differs.length ? "mismatch" : "match"} acct=${accountTag(auth.user.id)}${
            differs.length
              ? ` fields=${differs.join(",")} inbox=${JSON.stringify(Object.fromEntries(differs.map((k) => [k, result.data?.[k]])))} counters=${JSON.stringify(Object.fromEntries(differs.map((k) => [k, check.data?.[k]])))}`
              : ""
          }`,
        );
    }
    body = boundChatActivity({ ...result.data, ...unread.data });
  }
  recent.delete(key);
  if ((forgotten.get(auth.user.id) ?? -Infinity) < now) recent.set(key, { at: now, body });
  if (recent.size > OLD_WINDOW_MAX) recent.delete(recent.keys().next().value!);
  return json(body);
}
