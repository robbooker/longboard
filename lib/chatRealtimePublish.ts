import * as Ably from "ably";
import { after } from "next/server";
import {
  chatAblyKey,
  chatRealtimeRollout,
  chatRoomChannel,
  type ChatRealtimeEvent,
} from "./chatRealtimeChannels";
import { createChatAdminClient } from "./chatAdmin";
import { chatEventStreamRollout } from "./chatEventStream";
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
  "attachment_media",
  "buddy_status",
  "unread_seq",
  // EVENT-STREAM: the number of this row's latest change in its room (docs/chat-event-stream.md).
  "event_seq",
] as const;

export function publishedRow(row: Record<string, unknown>) {
  return Object.fromEntries(PUBLISHED_FIELDS.filter((key) => key in row).map((key) => [key, row[key]]));
}

/**
 * EVENT-STREAM: the room's last change number, for events whose own row may not be the only
 * change (edits and deletes can change other rows; "changed" signals carry no row). A new
 * message's own number is enough, so sends skip this read and keep their speed. Only while
 * CHAT_EVENT_STREAM is on; any failure just leaves the head out (the event still goes).
 */
async function roomHead(room: ChatRoom, event: ChatRealtimeEvent): Promise<number | undefined> {
  if (chatEventStreamRollout(process.env.CHAT_EVENT_STREAM) === "off") return undefined;
  if (event.kind === "message" && event.eventType === "INSERT") return undefined;
  // Reactions and pause/reopen change no message row.
  if (event.kind === "changed" && !event.topics.some((topic) => topic === "history" || topic === "room"))
    return undefined;
  const admin = createChatAdminClient();
  if (!admin) return undefined;
  try {
    const { data, error } = await admin
      .from("longboard_chat_room_event_heads")
      .select("seq")
      .eq("room_slug", room)
      .maybeSingle();
    return !error && typeof data?.seq === "number" ? data.seq : undefined;
  } catch {
    return undefined;
  }
}

let client: Ably.Rest | null = null;
/**
 * Best-effort fan-out to a room's Ably channel. Never throws: the database stays the
 * source of truth and subscribers still reconcile on a timer if a publish is lost.
 */
export async function publishRoomEvent(room: ChatRoom, event: ChatRealtimeEvent): Promise<void> {
  const key = chatAblyKey();
  if (!key || chatRealtimeRollout(process.env.CHAT_ABLY_ROLLOUT) === "off") return;
  try {
    client ??= new Ably.Rest({ key });
    const head = await roomHead(room, event);
    const payload = {
      ...(event.kind === "message" ? { ...event, row: publishedRow(event.row) } : event),
      ...(head ? { head } : {}),
    };
    await client.channels.get(chatRoomChannel(room)).publish(event.kind, payload);
  } catch {
    console.info("[chat-realtime] publish-failed");
  }
}

/**
 * Publish after the response is sent. Scheduling can never fail the caller's request.
 * `event` may be built lazily (after the response) when it needs another read first.
 */
export function publishRoomEventAfterResponse(
  room: ChatRoom,
  event: ChatRealtimeEvent | (() => Promise<ChatRealtimeEvent>),
): void {
  const publish = async () => {
    let built: ChatRealtimeEvent;
    try {
      built = typeof event === "function" ? await event() : event;
    } catch {
      console.info("[chat-realtime] publish-failed");
      return;
    }
    await publishRoomEvent(room, built);
  };
  try {
    after(publish);
  } catch {
    // Outside a request scope (scripts, tests): publish directly; publishRoomEvent never throws.
    void publish();
  }
}
