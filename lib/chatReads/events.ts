import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { withAttachmentMedia } from "@/lib/chatAttachmentMedia";
import type { ChatAuthResult } from "@/lib/chatAuth";
import {
  CHAT_EVENT_CATCH_UP_LIMIT,
  chatEventStreamRollout,
  type ChatStreamEvent,
} from "@/lib/chatEventStream";
import { publishedRow } from "@/lib/chatRealtimePublish";
import { parseChatRoom } from "@/lib/publicChat";
import { NextRequest, NextResponse } from "next/server";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

type Snapshot = {
  head: number;
  /** EVENT-STREAM step 2 (migration 20261017140000): the room's latest pin change, 0 when none. */
  pins?: number;
  /** Step 3 (migration 20261017150000): the room's latest pause/reopen, 0 when none. */
  state?: number;
  /** Step 3: each message whose reactions changed after the cursor, with its latest number. */
  reactions?: Array<{ id: string; event_seq: number }>;
  rows: Array<Record<string, unknown> & { id: string; event_seq: number; attachment_ids?: string[] }>;
  /** `reply_to_id` (null for a top-level message) only once migration 20261017140000 ran. */
  deleted: Array<{ id: string; event_seq: number; reply_to_id?: string | null }>;
};

/**
 * EVENT-STREAM catch-up: the room's head, and (with `after`) the current state of every
 * message changed after it, oldest change first. Without `after` only the head (a fresh
 * cursor). Same readers and same columns as the room's Ably channel: anyone who may read the
 * room, display fields only. More than CHAT_EVENT_CATCH_UP_LIMIT changes answers
 * `complete: false` with no events, and the window does one full history read instead.
 * 404 while CHAT_EVENT_STREAM is off for this account, so the window stops asking.
 *
 * Step 2: `pins` is the number of the room's latest pin change (its presence tells the window
 * that pins are numbered), and a deleted reply names its conversation (`parentId`).
 *
 * Step 3: `state` is the number of the room's latest pause/reopen (its presence tells the window
 * that reactions and room state are numbered), and each message whose reactions changed is an
 * event `{ seq, reactionsId }` (the window re-reads just that message's reactions).
 */
export async function readEvents(req: NextRequest, auth: ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const rollout = chatEventStreamRollout(process.env.CHAT_EVENT_STREAM);
  if (rollout === "off" || (rollout === "admins" && !auth.access.admin))
    return json({ error: "event_stream_off" }, 404);
  const room = parseChatRoom(req.nextUrl.searchParams.get("room"));
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const afterParam = req.nextUrl.searchParams.get("after");
  if (afterParam !== null && !/^\d{1,15}$/.test(afterParam)) return json({ error: "invalid_cursor" }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  // No cursor: list nothing, just the head.
  const after = afterParam === null ? Number.MAX_SAFE_INTEGER : Number(afterParam);
  const { data, error } = await admin.rpc("chat_room_events_after", {
    p_room: room,
    p_after: after,
    p_limit: CHAT_EVENT_CATCH_UP_LIMIT,
  });
  // Migration not applied yet (no such function): the same as off, so windows stop asking.
  if (error?.code === "PGRST202" || error?.code === "42883") return json({ error: "event_stream_off" }, 404);
  const snapshot = data as Snapshot | null;
  if (error || !snapshot || typeof snapshot.head !== "number") return json({ error: "unavailable" }, 503);
  const rows = snapshot.rows ?? [],
    deleted = snapshot.deleted ?? [],
    reactions = snapshot.reactions ?? [];
  const numbers = {
    ...(typeof snapshot.pins === "number" ? { pins: snapshot.pins } : {}),
    ...(typeof snapshot.state === "number" ? { state: snapshot.state } : {}),
  };
  if (
    rows.length > CHAT_EVENT_CATCH_UP_LIMIT ||
    deleted.length > CHAT_EVENT_CATCH_UP_LIMIT ||
    reactions.length > CHAT_EVENT_CATCH_UP_LIMIT
  )
    return json({ head: snapshot.head, complete: false, events: [], ...numbers });
  let shown = rows;
  // Images carry their sizes, as the live publish does.
  if (rows.some((row) => row.attachment_ids?.length))
    try {
      shown = await withAttachmentMedia(admin, { room }, rows);
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  const events: ChatStreamEvent[] = [
    ...shown.map((row) => ({ seq: row.event_seq, row: publishedRow(row) })),
    ...deleted.map((row) => ({
      seq: row.event_seq,
      deletedId: row.id,
      ...(row.reply_to_id !== undefined ? { parentId: row.reply_to_id } : {}),
    })),
    ...reactions.map((row) => ({ seq: row.event_seq, reactionsId: row.id })),
  ].sort((a, b) => a.seq - b.seq);
  return json({ head: snapshot.head, complete: true, events, ...numbers });
}
