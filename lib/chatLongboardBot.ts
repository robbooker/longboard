// #413 Longboard Bot: announcements from admins (POST /api/chat/admin/announce) and the ops session
// (scripts/announce.ts), posted as "Longboard Bot" (bot_slug 'longboard') into chat rooms through
// public.post_chat_longboard_announcement. Each room's post has its own id, derived from the
// announcement's clientId, so sending the same announcement again posts nothing new.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_ROOMS, type ChatRoom } from "./publicChat";

export const LONGBOARD_BOT = "longboard";
export const LONGBOARD_BOT_AUTHOR = "Longboard Bot";
export const ANNOUNCEMENT_MAX_LENGTH = 4000;

/**
 * What "all" covers: every chat room except Gainers. Every post in Gainers is read as a stock alert
 * (the nightly gainers page and the gainers table), and its own database guard refuses anything else.
 */
export const ANNOUNCE_EXCLUDED_ROOMS: readonly ChatRoom[] = ["gainers"];
export const ANNOUNCE_ROOMS: readonly ChatRoom[] = CHAT_ROOMS.map((room) => room.slug).filter(
  (slug) => !ANNOUNCE_EXCLUDED_ROOMS.includes(slug),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AnnouncementRequest = { rooms: ChatRoom[]; body: string; clientId: string };
export type AnnouncementParse = { ok: true; value: AnnouncementRequest } | { ok: false; error: string };

/** A stable UUID (v4 layout) from text. */
function uuidFrom(text: string): string {
  const hex = createHash("sha256").update(text).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Without a clientId the announcement's own words identify it, so the same text never posts twice. */
export function announcementClientId(body: string): string {
  return uuidFrom(`longboard-announcement:${body.trim()}`);
}

/** The message id of one announcement in one room. */
export function announcementMessageId(clientId: string, room: ChatRoom): string {
  return uuidFrom(`longboard-announcement:${clientId.toLowerCase()}:${room}`);
}

/** { rooms: "all" | slug[], body, clientId? } → the rooms (in CHAT_ROOMS order, no repeats), trimmed body and clientId. */
export function parseAnnouncementRequest(input: unknown): AnnouncementParse {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "invalid_request" };
  const { rooms, body, clientId } = input as Record<string, unknown>;
  if (typeof body !== "string" || !body.trim()) return { ok: false, error: "body_required" };
  const text = body.trim();
  if (text.length > ANNOUNCEMENT_MAX_LENGTH) return { ok: false, error: "body_too_long" };
  let picked: ChatRoom[];
  if (rooms === "all") picked = [...ANNOUNCE_ROOMS];
  else if (Array.isArray(rooms) && rooms.length > 0 && rooms.length <= CHAT_ROOMS.length * 2) {
    const wanted = new Set<string>();
    for (const room of rooms) {
      if (typeof room !== "string") return { ok: false, error: "invalid_room" };
      if (!CHAT_ROOMS.some((known) => known.slug === room)) return { ok: false, error: "invalid_room" };
      if (ANNOUNCE_EXCLUDED_ROOMS.includes(room as ChatRoom)) return { ok: false, error: "room_not_allowed" };
      wanted.add(room);
    }
    picked = ANNOUNCE_ROOMS.filter((slug) => wanted.has(slug));
  } else return { ok: false, error: "invalid_rooms" };
  if (clientId !== undefined && (typeof clientId !== "string" || !UUID.test(clientId)))
    return { ok: false, error: "invalid_client_id" };
  return {
    ok: true,
    value: {
      rooms: picked,
      body: text,
      clientId: (clientId as string | undefined)?.toLowerCase() ?? announcementClientId(text),
    },
  };
}

export type AnnouncementRoomResult = {
  room: ChatRoom;
  status: "posted" | "duplicate" | "failed";
  messageId: string;
  error?: string;
};

function postError(message: string): string {
  if (message.includes("longboard_chat_paused")) return "room_paused";
  if (message.includes("announcement_id_taken")) return "id_taken";
  if (message.includes("invalid_announcement")) return "invalid_announcement";
  if (message.includes("_read_only") || message.includes("_forbidden") || message.includes("actor_check"))
    return "room_refused";
  return "post_failed";
}

/** Posts one announcement into each room, one room at a time; a room that fails doesn't stop the rest. */
export async function postAnnouncement(
  db: SupabaseClient,
  request: AnnouncementRequest,
): Promise<AnnouncementRoomResult[]> {
  const results: AnnouncementRoomResult[] = [];
  for (const room of request.rooms) {
    const messageId = announcementMessageId(request.clientId, room);
    try {
      const { data, error } = await db.rpc("post_chat_longboard_announcement", {
        p_id: messageId,
        p_room: room,
        p_body: request.body,
      });
      if (error) results.push({ room, status: "failed", messageId, error: postError(error.message ?? "") });
      else
        results.push({
          room,
          status: (data as { posted?: boolean } | null)?.posted ? "posted" : "duplicate",
          messageId,
        });
    } catch {
      results.push({ room, status: "failed", messageId, error: "post_failed" });
    }
  }
  return results;
}
