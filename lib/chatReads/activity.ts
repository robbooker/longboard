import { createHash } from "node:crypto";
import { allowedChatRooms } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { boundChatActivity, type ChatActivity } from "@/lib/chatActivity";
import type { ChatAuthResult } from "@/lib/chatAuth";
import {
  CHAT_BELL_DRIFT_MS,
  chatBellCountDifferences,
  chatBellCountersRollout,
  chatBellCountsOnly,
} from "@/lib/chatBellCounters";
import { NextRequest, NextResponse } from "next/server";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
// Routine reads get a result up to 10 s old from this instance, so bursts can't hammer the
// database. Kept after the Oct 14 busy-hour check: the bell holds at ~206 calls/min with this in
// place. #498: that is the closed bell's timer read (and old windows, which send no `why`);
// see activityMayUseRecent for the reads that always go to the database.
const OLD_WINDOW_MS = 10_000,
  OLD_WINDOW_MAX = 500;
const recent = new Map<string, { at: number; body: unknown }>(),
  forgotten = new Map<string, number>();
/**
 * #498: whether a bell read may take this instance's recent answer. Only a routine re-check may:
 * the closed bell's timer (and old windows, which send no `why`). Every other read goes to the
 * database: the open bell and the repair read (`lists=1`), a read prompted by a change signal (the
 * change was often made by another member, maybe on another instance, where
 * forgetRecentActivity cannot reach), a tab coming back (it missed signals while hidden), and a
 * window's first read. `why` still never changes what is read, only whether a 10 s answer will do.
 */
export function activityMayUseRecent(params: URLSearchParams) {
  if (params.get("lists") === "1") return false;
  const why = params.get("why");
  return why === null || /^(again:)*timer$/.test(why);
}
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
// #462: people whose counters last disagreed with the inbox on this instance, and until when
// their numbers-only reads use the inbox instead.
const drifted = new Map<string, number>();
export function resetBellCountersForTests() {
  countersMissingUntil = 0;
  drifted.clear();
  recent.clear();
  forgotten.clear();
}

export async function readActivity(req: NextRequest, auth: ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const rooms = allowedChatRooms(auth.access),
    now = Date.now();
  // D-212: the closed bell asks for the numbers only (`lists=0`); see lib/chatBellCounters.ts.
  const rollout = chatBellCountersRollout(process.env.CHAT_BELL_COUNTERS);
  const lists = req.nextUrl.searchParams.get("lists");
  const countersOn =
    (rollout === "all" || (rollout === "admins" && auth.access.admin)) && now >= countersMissingUntil;
  const drifting = (drifted.get(auth.user.id) ?? 0) > now;
  if (!drifting) drifted.delete(auth.user.id);
  const counters = lists === "0" && countersOn && !drifting;
  const key = `${auth.user.id}:${rooms.join(",")}:${counters ? "counts" : "full"}`;
  const cached = recent.get(key);
  // #462: while this person's counters disagree with the inbox, every read checks again.
  if (
    !drifting &&
    activityMayUseRecent(req.nextUrl.searchParams) &&
    cached &&
    now - cached.at < OLD_WINDOW_MS
  )
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
      // compare: every read. #462: with the counters on, a window's full read (the open bell and
      // the repair read every few minutes, `lists=1`) checks them too.
      (rollout === "compare" && now >= countersMissingUntil) || (countersOn && !roomUnread && lists === "1")
        ? db.rpc("chat_activity_counts", { actor: auth.user.id, rooms })
        : null,
    ]);
    if (result.error || unread.error) return json({ error: "Notifications unavailable." }, 503);
    if (check?.error && missingFunction(check.error)) countersMissingUntil = Date.now() + 60_000;
    else if (check && !check.error) {
      // Numbers only, never message text; the account is a short one-way tag.
      const differs = chatBellCountDifferences(result.data, check.data);
      if (differs.length && rollout !== "compare") {
        // The counters' recent answer is the one in doubt; drop it with the rest.
        for (const cachedKey of recent.keys())
          if (cachedKey.startsWith(`${auth.user.id}:`)) recent.delete(cachedKey);
        drifted.delete(auth.user.id);
        drifted.set(auth.user.id, Date.now() + CHAT_BELL_DRIFT_MS);
        if (drifted.size > OLD_WINDOW_MAX) drifted.delete(drifted.keys().next().value!);
      } else if (!differs.length) drifted.delete(auth.user.id);
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
