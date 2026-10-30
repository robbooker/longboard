import type { ChatMembership } from './chatMemberships';
import type { ChatAttachmentMediaMap } from './chatAttachmentMedia';
import type { ChatAnswered } from './chatAnswered';
// Room names in Title Case (D-216); LB and SS stay abbreviations.
export const CHAT_ROOMS = [{ slug: "main", label: "LB" }, { slug: "social", label: "Social" }, { slug: "shortscout", label: "SS" }, { slug: "lb-announcements", label: "LB Announcements" }, { slug: "ss-announcements", label: "SS Announcements" }, { slug: "gainers", label: "Gainers" }, { slug: "lb-recordings", label: "LB Recordings" }, { slug: "ss-recordings", label: "SS Recordings" }, { slug: "whats-new", label: "What's New?" }, { slug: "developers", label: "Developers" }, { slug: "admins", label: "Admins" }] as const;
export type ChatRoom = typeof CHAT_ROOMS[number]["slug"];
export function parseChatRoom(value: unknown): ChatRoom | null {
  if (value === undefined || value === null) return "main";
  return value === "main" || value === "social" || value === "shortscout" || value === "lb-announcements" || value === "ss-announcements" || value === "gainers" || value === "lb-recordings" || value === "ss-recordings" || value === "whats-new" || value === "developers" || value === "admins" ? value : null;
}

export type PublicChatMessage = {
  unread_seq?: number;
  memberships?: ChatMembership[];
  client_id?: string | null;
  buddy_status?: "pending" | "processing" | "failed" | "completed" | "cancelled" | null;
  deleted_at?: string | null;
  removed?: boolean;
  revision?: number;
  edited_at?: string | null;
  attachment_ids?: string[];
  /** MEDIA-SIZE: kinds and image sizes for attachment_ids (server reads only). */
  attachment_media?: ChatAttachmentMediaMap;
  id: string;
  room_slug?: ChatRoom;
  guest_id: string | null;
  member_id?: string | null;
  author_label: string;
  body: string;
  bot_slug?: string | null;
  reply_to_id?: string | null;
  /** #301: the reply this reply answered (reply_to_id is always the original message). */
  answered_id?: string | null;
  /** #301: who wrote answered_id, added by the thread read. */
  answered?: ChatAnswered;
  created_at: string;
  pending?: boolean;
  // Client-only: the retry-safe id of a pending send, and why it failed.
  send_client_id?: string;
  send_error?: string;
  /** Client-only: typed offline; waiting on this device to send when the connection returns. */
  send_queued?: boolean;
};

export type PublicChatRoomState = {
  isOpen: boolean;
  pausedAt: string | null;
  notice: string | null;
  updatedAt: string;
};

const RESERVED_CHAT_NAMES = new Set(["buddy", "longboard", "longboard admin", "booker chat updates"]);

export function isReservedChatName(name: string) {
  return RESERVED_CHAT_NAMES.has(name.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US"));
}

export type PublicChatReaction = {
  message_id: string;
  guest_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatMessagePart =
  | { kind: "text"; value: string }
  | { kind: "link"; href: string; value: string };

export type TradingViewSnapshot = {
  chartId: string;
  href: string;
  imageUrl: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}]+/gi;
const TRADING_VIEW_HOSTS = new Set(["tradingview.com", "www.tradingview.com"]);

export function mergeMessage(list: PublicChatMessage[], incoming: PublicChatMessage) {
  const previous=list.find(message=>message.id===incoming.id);
  if(previous&&(previous.revision??0)>(incoming.revision??0))return list;
  const withoutExisting = list.filter((message) => message.id !== incoming.id);
  return [...withoutExisting, incoming]
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .slice(-80);
}

export function mergeReaction(list: PublicChatReaction[], incoming: PublicChatReaction) {
  return [
    ...list.filter((reaction) => reaction.message_id !== incoming.message_id || reaction.guest_id !== incoming.guest_id),
    incoming,
  ].slice(-500);
}

export function reactionSummary(reactions: PublicChatReaction[], messageId: string, guestId: string) {
  const active = reactions.filter((reaction) => reaction.message_id === messageId && reaction.active);
  return {
    count: active.length,
    reacted: active.some((reaction) => reaction.guest_id === guestId),
  };
}

export function countChatters(presenceState: Record<string, unknown[]>) {
  return Object.keys(presenceState).length;
}

export function tokenizeChatMessage(body: string): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  let cursor = 0;

  for (const match of body.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", value: body.slice(cursor, index) });

    const href = match[0].replace(/[.,!?;:]+$/g, "");
    if (href) parts.push({ kind: "link", href, value: href });

    const trailing = match[0].slice(href.length);
    if (trailing) parts.push({ kind: "text", value: trailing });
    cursor = index + match[0].length;
  }

  if (cursor < body.length) parts.push({ kind: "text", value: body.slice(cursor) });
  return parts.length ? parts : [{ kind: "text", value: body }];
}

export function tradingViewSnapshotFromText(body: string): TradingViewSnapshot | null {
  for (const part of tokenizeChatMessage(body)) {
    if (part.kind !== "link") continue;

    let url: URL;
    try {
      url = new URL(part.href);
    } catch {
      continue;
    }

    if (url.protocol !== "https:" || !TRADING_VIEW_HOSTS.has(url.hostname.toLowerCase())) continue;
    const match = url.pathname.match(/^\/x\/([A-Za-z0-9]{8})\/?$/);
    if (!match || url.search || url.hash) continue;

    const chartId = match[1];
    return {
      chartId,
      href: `https://www.tradingview.com/x/${chartId}/`,
      imageUrl: `https://s3.tradingview.com/snapshots/${chartId[0].toLowerCase()}/${chartId}.png`,
    };
  }
  return null;
}

// Replies belong only in their conversation, including bot and realtime replies.
export function mergeRoomMessage(list:PublicChatMessage[],incoming:PublicChatMessage){
 if(incoming.reply_to_id)return list.filter(message=>message.id!==incoming.id);
 return mergeMessage(list.filter(message=>!message.reply_to_id),incoming);
}

// What's New (#302) reuses the announcement rules: admins post, everyone reacts.
export function isAnnouncementRoom(room:ChatRoom){return room === "lb-announcements" || room === "ss-announcements" || isRecordingRoom(room) || isWhatsNewRoom(room);}

export function isRecordingRoom(room: ChatRoom) { return room === "lb-recordings" || room === "ss-recordings"; }

/** #302: Longboard update notes. Admin posts and automatic notes only; no replies, no alerts. */
export function isWhatsNewRoom(room: ChatRoom) { return room === "whats-new"; }

/** Rooms where nobody replies or starts a conversation under a message. */
export function roomRepliesOff(room: ChatRoom) { return isRecordingRoom(room) || isWhatsNewRoom(room) || room === "gainers"; }

/** D-304: What's New?'s description, shown under the room title in place of "Admin posts only"
 * (exact wording from the ticket). */
export const WHATS_NEW_DESCRIPTION = "Chat Improvements… Real time updates as they go live.";
export const WHATS_NEW_AUTHOR = "Booker Chat Updates";
