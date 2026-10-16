// EVENT-STREAM step 2 (docs/chat-event-stream.md): what one numbered room change means for the
// open thread, reply counts and pins. A "numbered" chat-room-event belongs to a room whose
// cursor is in step, so no "room" reload follows it: these readers decide from the row alone
// whether they need anything. Events without `numbered` (stream off, out of step, the Postgres
// channel) keep the old path: the "room" reload that comes with them.
import type { RoomEventDetail } from "./chatRealtimeChannels";

type Detail = Partial<RoomEventDetail> | null | undefined;
const parentOf = (row: Record<string, unknown> | undefined) =>
  typeof row?.reply_to_id === "string" ? row.reply_to_id : null;

/**
 * Which of these conversations' reply summary (count, last reply, repliers) a numbered change
 * can move: a reply (new, edited, deleted or removed) to one of `ids` names that conversation;
 * a hard delete whose conversation is unknown (written before the step 2 migration) is "all"
 * (re-read every one); anything else, including a known top-level delete, is null.
 */
export function numberedReplyConversation(
  detail: Detail,
  room: string,
  ids: ReadonlySet<string>,
): string | "all" | null {
  if (!detail?.numbered) return null;
  if (detail.eventType === "DELETE") {
    if (!detail.old || !("reply_to_id" in detail.old)) return "all";
    const parent = parentOf(detail.old);
    return parent && ids.has(parent) ? parent : null;
  }
  if (detail.new?.room_slug !== room) return null;
  const parent = parentOf(detail.new);
  return parent && ids.has(parent) ? parent : null;
}

/**
 * Merge a re-read of some conversations into the held summaries: their counts and threads are
 * replaced (a conversation the read no longer returns, or one with no replies left, loses its
 * entry); every other conversation keeps its own.
 */
export function mergeReplySummaries<C, T>(
  held: { counts: Record<string, C>; threads: Record<string, T> },
  ids: readonly string[],
  read: { counts: Record<string, C>; threads: Record<string, T> },
): { counts: Record<string, C>; threads: Record<string, T> } {
  const counts = { ...held.counts },
    threads = { ...held.threads };
  for (const id of ids) {
    if (id in read.counts) counts[id] = read.counts[id];
    else delete counts[id];
    if (id in read.threads) threads[id] = read.threads[id];
    else delete threads[id];
  }
  return { counts, threads };
}

export type ThreadChange =
  /** Merge this row (the conversation's first message or one of its replies). */
  | { kind: "row"; row: Record<string, unknown> }
  /** Drop this reply (hard deleted). */
  | { kind: "delete"; id: string }
  /** The conversation itself went away: re-read it (the read reports that it is gone). */
  | { kind: "reload" };

/** What a numbered change means for the open conversation `threadId`; null when nothing. */
export function numberedThreadChange(detail: Detail, room: string, threadId: string): ThreadChange | null {
  if (!detail?.numbered) return null;
  if (detail.eventType === "DELETE") {
    const id = detail.old?.id;
    if (typeof id !== "string") return null;
    return id === threadId ? { kind: "reload" } : { kind: "delete", id };
  }
  const row = detail.new;
  if (!row || row.room_slug !== room || typeof row.id !== "string") return null;
  if (row.id === threadId) return row.removed ? { kind: "reload" } : { kind: "row", row };
  return parentOf(row) === threadId ? { kind: "row", row } : null;
}

/**
 * Whether a numbered change alters a pinned message's preview (an edit; a deletion is already
 * dropped from the list and its unpin arrives as a numbered pin change).
 */
export function numberedPinnedEdit(detail: Detail, room: string, pinned: ReadonlySet<string>): boolean {
  if (!detail?.numbered || detail.eventType === "DELETE") return false;
  const row = detail.new;
  return (
    !!row &&
    row.room_slug === room &&
    typeof row.id === "string" &&
    pinned.has(row.id) &&
    !row.deleted_at &&
    !row.removed
  );
}
