import * as Ably from "ably";
import { after } from "next/server";
import { chatRealtimeRollout, chatRoomChannel, type ChatRealtimeEvent } from "./chatRealtimeChannels";
import type { ChatRoom } from "./publicChat";

// Display columns only: never send client_id, guest_id or search_document to subscribers.
const PUBLISHED_FIELDS = [
  "id",
  "room_slug",
  "member_id",
  "author_label",
  "body",
  "bot_slug",
  "reply_to_id",
  "created_at",
  "edited_at",
  "deleted_at",
  "removed",
  "revision",
  "attachment_ids",
  "buddy_status",
  "unread_seq",
] as const;

export function publishedRow(row: Record<string, unknown>) {
  return Object.fromEntries(PUBLISHED_FIELDS.filter((key) => key in row).map((key) => [key, row[key]]));
}

let client: Ably.Rest | null = null;
/**
 * Best-effort fan-out to a room's Ably channel. Never throws: the database stays the
 * source of truth and subscribers still reconcile on a timer if a publish is lost.
 */
export async function publishRoomEvent(room: ChatRoom, event: ChatRealtimeEvent): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  if (!key || chatRealtimeRollout(process.env.CHAT_ABLY_ROLLOUT) === "off") return;
  try {
    client ??= new Ably.Rest({ key });
    const payload = event.kind === "message" ? { ...event, row: publishedRow(event.row) } : event;
    await client.channels.get(chatRoomChannel(room)).publish(event.kind, payload);
  } catch {
    console.info("[chat-realtime] publish-failed");
  }
}

/** Publish after the response is sent. Scheduling can never fail the caller's request. */
export function publishRoomEventAfterResponse(room: ChatRoom, event: ChatRealtimeEvent): void {
  try {
    after(() => publishRoomEvent(room, event));
  } catch {
    // Outside a request scope (scripts, tests): publish directly; publishRoomEvent never throws.
    void publishRoomEvent(room, event);
  }
}
