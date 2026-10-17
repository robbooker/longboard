import { parseChatRoom, type ChatRoom } from "./publicChat";

/** Server-issued Ably channel for one room. Subscribers get it only via /api/chat/realtime-token. */
export const chatRoomChannel = (room: ChatRoom) => `private:chat:room:${room}`;
/** Only a real room's channel; typing channels (`….typing`) share the prefix but are not rooms. */
export const chatRoomFromChannel = (channel: string): ChatRoom | null =>
  channel.startsWith("private:chat:room:") ? parseChatRoom(channel.slice("private:chat:room:".length)) : null;

/** "pins": the room's pinned messages changed (EVENT-STREAM step 2; older windows ignore it). */
export type ChatRealtimeTopic = "room" | "history" | "status" | "reactions" | "pins";
/**
 * `message` carries display fields only; `changed` tells subscribers what to reload.
 * EVENT-STREAM: `head` (when CHAT_EVENT_STREAM is on) is the room's last change number when
 * the event was sent; a message row also carries its own number as `row.event_seq`.
 * Step 3: a reaction signal (one message) carries the number of that message's latest reaction
 * change as `seq`, so an in-order reaction needs no catch-up.
 */
export type ChatRealtimeEvent =
  | { kind: "message"; eventType: "INSERT" | "UPDATE"; row: Record<string, unknown>; head?: number }
  | { kind: "changed"; topics: ChatRealtimeTopic[]; messageId?: string; head?: number; seq?: number };

/** A chat-only key (capability `private:chat:room:*`) is preferred over the shared chart key. */
export function chatAblyKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.CHAT_ABLY_API_KEY || env.ABLY_API_KEY || undefined;
}

export type ChatRealtimeRollout = "off" | "admins" | "all";
export function chatRealtimeRollout(value: string | undefined): ChatRealtimeRollout {
  return value === "all" || value === "admins" ? value : "off";
}

/** Window event for one room message's reactions changing; MessageReactions reloads just it. */
export const CHAT_REACTION_EVENT = "chat-reaction-event";
export type ChatReactionEventDetail = { room: ChatRoom; messageId: string };

const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RoomEventDetail = {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  /**
   * EVENT-STREAM step 2: this change belongs to a room whose numbered events are in step, so no
   * "room" reload follows it; the open thread, reply counts and pins apply it themselves.
   */
  numbered?: boolean;
};
/** How the window's event stream stands for the room an event arrived in. */
export type RoomStreamState = {
  /** The room is in step and the event is numbered: a catch-up covers whatever it implies. */
  numbered: boolean;
  /** Pin changes are numbered in this room (so a catch-up reports them). */
  pins: boolean;
  /** Step 3: reactions and pause/reopen are numbered in this room (a catch-up reports them). */
  state?: boolean;
};
/**
 * What one Ably room event means for this window: a room event to merge (only for
 * rooms on screen) and which update topics to reload. Mirrors the Postgres channel.
 */
export function ablyRoomEventActions(
  room: ChatRoom,
  visibleRooms: readonly ChatRoom[],
  name: string,
  data: unknown,
  stream: RoomStreamState = { numbered: false, pins: false },
): {
  detail: RoomEventDetail | null;
  topics: Array<ChatRealtimeTopic | "activity">;
  /** A reaction change on one message: reload just that message's reactions. */
  reaction?: ChatReactionEventDetail;
} {
  const visible = visibleRooms.includes(room);
  const event = data as Partial<ChatRealtimeEvent> | null;
  const numbered = visible && stream.numbered;
  if (name === "message" && event?.kind === "message" && event.row && typeof event.row.id === "string") {
    const detail: RoomEventDetail = {
      eventType: event.eventType === "UPDATE" ? "UPDATE" : "INSERT",
      new: event.row,
      old: {},
      ...(numbered ? { numbered } : {}),
    };
    const threads = detail.eventType !== "INSERT" || !!event.row.reply_to_id;
    return {
      detail: visible ? detail : null,
      // In step, the thread, counts and pins take the row itself instead of a "room" reload.
      topics: visible && threads && !numbered ? ["room", "activity"] : ["activity"],
    };
  }
  if (name === "changed" && event?.kind === "changed" && Array.isArray(event.topics)) {
    let topics = event.topics.filter((topic): topic is ChatRealtimeTopic =>
      ["room", "history", "status", "reactions", "pins"].includes(topic),
    );
    // Pin changes move no unread badge.
    const activity: Array<"activity"> =
      topics.length && topics.every((t) => t === "pins") ? [] : ["activity"];
    if (!visible) return { detail: null, topics: activity };
    // A numbered signal for a room in step: the catch-up it triggers brings the changed rows (and
    // pin changes and pause/reopen, once those are numbered) instead of full reloads.
    if (numbered)
      topics = topics.filter(
        (t) =>
          t !== "history" &&
          t !== "room" &&
          (t !== "pins" || !stream.pins) &&
          (t !== "status" || !stream.state),
      );
    if (
      topics.length === 1 &&
      topics[0] === "reactions" &&
      typeof event.messageId === "string" &&
      CHAT_ID.test(event.messageId)
    )
      return { detail: null, topics: ["activity"], reaction: { room, messageId: event.messageId } };
    return { detail: null, topics: [...topics, ...activity] };
  }
  return { detail: null, topics: [] };
}
