import { chatRoomChannel } from "./chatRealtimeChannels";
import type { ChatRoom } from "./publicChat";

/**
 * Typing signals ride their own Ably channels, separate from the server-only room channels.
 * Names stay inside the chat key's `private:chat:room:*` capability (no extra `:`).
 * Nothing is stored: signals are ephemeral, carry no data, and the sender is the
 * Ably clientId the server pinned to the member's login in the token.
 */
export const chatTypingRoomChannel = (room: ChatRoom) => `${chatRoomChannel(room)}.typing`;
export const chatTypingDmChannel = (conversationId: string) => `private:chat:room:dm.${conversationId}.typing`;
export const isChatTypingDmChannel = (channel: string) =>
  channel.startsWith("private:chat:room:dm.") && channel.endsWith(".typing");

export const CHAT_TYPING_EVENT = "typing";
/** One signal per sender at most this often. */
export const TYPING_SIGNAL_INTERVAL_MS = 3000;
/** A typer disappears this long after their last signal. */
export const TYPING_EXPIRY_MS = 6000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_CLIENT = "chat:m:";
/** The token's clientId for a member. Ably rejects any publish claiming another clientId. */
export const chatTypingClientId = (memberId: string) => `${MEMBER_CLIENT}${memberId.toLowerCase()}`;
export function memberIdFromClientId(clientId: unknown): string | null {
  if (typeof clientId !== "string" || !clientId.startsWith(MEMBER_CLIENT)) return null;
  const id = clientId.slice(MEMBER_CLIENT.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

/** CHAT_TYPING=off removes every typing grant from new tokens (the indicator then never shows). */
export const chatTypingEnabled = (value: string | undefined) => value !== "off";

export type ChatCapability = Record<string, Array<"subscribe" | "publish">>;
/**
 * Room channels stay subscribe-only. Typing channels: subscribe where the member may read,
 * publish only where they may post, and both for DMs they can reply in.
 */
export function chatRealtimeCapability({
  rooms,
  writableRooms = [],
  conversations = [],
  typing,
}: {
  rooms: readonly ChatRoom[];
  writableRooms?: readonly ChatRoom[];
  conversations?: readonly string[];
  typing: boolean;
}): ChatCapability {
  const capability: ChatCapability = {};
  for (const room of rooms) {
    capability[chatRoomChannel(room)] = ["subscribe"];
    if (typing)
      capability[chatTypingRoomChannel(room)] = writableRooms.includes(room)
        ? ["publish", "subscribe"]
        : ["subscribe"];
  }
  if (typing)
    for (const id of conversations) if (UUID.test(id)) capability[chatTypingDmChannel(id.toLowerCase())] = ["publish", "subscribe"];
  return capability;
}

/** Sender-side limit: true at most once per interval. */
export function createTypingThrottle(interval = TYPING_SIGNAL_INTERVAL_MS) {
  let last = -Infinity;
  return {
    shouldSend(now: number) {
      if (now - last < interval) return false;
      last = now;
      return true;
    },
    reset() {
      last = -Infinity;
    },
  };
}

/** Who is typing: member id → time of their last signal. */
export type TypingRoster = Map<string, number>;
export function noteTyping(roster: TypingRoster, memberId: string, now: number) {
  roster.delete(memberId); // Re-insert so the order is by latest signal.
  roster.set(memberId, now);
}
/** Drops expired typers; returns when the next one expires (or null). */
export function expireTyping(roster: TypingRoster, now: number, ttl = TYPING_EXPIRY_MS): number | null {
  let next: number | null = null;
  for (const [id, at] of roster) {
    if (now - at >= ttl) roster.delete(id);
    else next = Math.min(next ?? Infinity, at + ttl);
  }
  return next;
}

/** Names to show, from the server's member list only; never yourself, never an unknown id. */
export function typingNames(
  roster: TypingRoster,
  selfId: string | null | undefined,
  nameOf: (memberId: string) => string | null | undefined,
): string[] {
  const self = selfId?.toLowerCase();
  const names: string[] = [];
  for (const id of roster.keys()) {
    if (id === self) continue;
    const name = nameOf(id)?.trim();
    if (name) names.push(name);
  }
  return names;
}

export function typingLabel(names: readonly string[]): string {
  if (!names.length) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}
