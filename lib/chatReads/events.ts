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
  rows: Array<Record<string, unknown> & { id: string; event_seq: number; attachment_ids?: string[] }>;
  deleted: Array<{ id: string; event_seq: number }>;
};

/**
 * EVENT-STREAM catch-up: the room's head, and (with `after`) the current state of every
 * message changed after it, oldest change first. Without `after` only the head (a fresh
 * cursor). Same readers and same columns as the room's Ably channel: anyone who may read the
 * room, display fields only. More than CHAT_EVENT_CATCH_UP_LIMIT changes answers
 * `complete: false` with no events, and the window does one full history read instead.
 * 404 while CHAT_EVENT_STREAM is off for this account, so the window stops asking.
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
    deleted = snapshot.deleted ?? [];
  if (rows.length > CHAT_EVENT_CATCH_UP_LIMIT || deleted.length > CHAT_EVENT_CATCH_UP_LIMIT)
    return json({ head: snapshot.head, complete: false, events: [] });
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
    ...deleted.map((row) => ({ seq: row.event_seq, deletedId: row.id })),
  ].sort((a, b) => a.seq - b.seq);
  return json({ head: snapshot.head, complete: true, events });
}
