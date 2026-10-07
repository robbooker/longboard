import type { ChatRoom } from "./publicChat";

/** Server-issued Ably channel for one room. Subscribers get it only via /api/chat/realtime-token. */
export const chatRoomChannel = (room: ChatRoom) => `private:chat:room:${room}`;
export const chatRoomFromChannel = (channel: string) =>
  channel.startsWith("private:chat:room:") ? (channel.slice("private:chat:room:".length) as ChatRoom) : null;

export type ChatRealtimeTopic = "room" | "history" | "status";
/** `message` carries display fields only; `changed` tells subscribers what to reload. */
export type ChatRealtimeEvent =
  | { kind: "message"; eventType: "INSERT" | "UPDATE"; row: Record<string, unknown> }
  | { kind: "changed"; topics: ChatRealtimeTopic[] };

export type ChatRealtimeRollout = "off" | "admins" | "all";
export function chatRealtimeRollout(value: string | undefined): ChatRealtimeRollout {
  return value === "all" || value === "admins" ? value : "off";
}

export type RoomEventDetail = {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
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
): { detail: RoomEventDetail | null; topics: Array<ChatRealtimeTopic | "activity"> } {
  const visible = visibleRooms.includes(room);
  const event = data as Partial<ChatRealtimeEvent> | null;
  if (name === "message" && event?.kind === "message" && event.row && typeof event.row.id === "string") {
    const detail = { eventType: event.eventType === "UPDATE" ? "UPDATE" : "INSERT", new: event.row, old: {} };
    const threads = detail.eventType !== "INSERT" || !!event.row.reply_to_id;
    return {
      detail: visible ? detail : null,
      topics: visible && threads ? ["room", "activity"] : ["activity"],
    };
  }
  if (name === "changed" && event?.kind === "changed" && Array.isArray(event.topics)) {
    const topics = event.topics.filter((topic): topic is ChatRealtimeTopic =>
      ["room", "history", "status"].includes(topic),
    );
    return { detail: null, topics: visible ? [...topics, "activity"] : ["activity"] };
  }
  return { detail: null, topics: [] };
}
