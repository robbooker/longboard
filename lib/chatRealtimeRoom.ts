import type { PublicChatMessage } from "./publicChat";

// The same columns history readers select; realtime rows carry every column.
const ROOM_MESSAGE_FIELDS = [
  "id",
  "room_slug",
  "guest_id",
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
  "client_id",
  "buddy_status",
  "unread_seq",
] as const;

/**
 * Turn a realtime room row into a list message without a history reload.
 * Realtime rows lack the server's membership badges and current-name projection, so
 * reuse them from the same message or another message by the same author already on
 * screen. `needsProjection` is true only when nothing on screen can supply them.
 */
export function realtimeRoomMessage(
  current: PublicChatMessage[],
  row: Record<string, unknown>,
): { message: PublicChatMessage; needsProjection: boolean } {
  const picked = Object.fromEntries(
    ROOM_MESSAGE_FIELDS.filter((field) => field in row).map((field) => [field, row[field]]),
  ) as PublicChatMessage;
  const existing = current.find((message) => message.id === picked.id && !message.pending);
  if (existing)
    return {
      message: {
        ...picked,
        author_label: existing.member_id === picked.member_id ? existing.author_label : picked.author_label,
        memberships: existing.memberships ?? [],
      },
      needsProjection: existing.memberships === undefined,
    };
  if (picked.bot_slug || !picked.member_id)
    return { message: { ...picked, memberships: [] }, needsProjection: false };
  const sameAuthor = current.findLast(
    (message) =>
      message.member_id === picked.member_id && !message.pending && message.memberships !== undefined,
  );
  return sameAuthor
    ? { message: { ...picked, memberships: sameAuthor.memberships }, needsProjection: false }
    : { message: { ...picked, memberships: [] }, needsProjection: true };
}

/** Only replies and edits/deletes change reply counts, pins or the open thread. */
export function realtimeRoomEventChangesThreads(event: {
  eventType: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}): boolean {
  return event.eventType !== "INSERT" || !!event.new?.reply_to_id;
}
