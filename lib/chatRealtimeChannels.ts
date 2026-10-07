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
