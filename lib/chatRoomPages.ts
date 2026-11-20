// #473: "Earlier messages" and "Newer messages" in a room add a page above or below the messages
// on screen, which stay (before, a page replaced them, so the message being read disappeared and
// the reader landed somewhere else). The room keeps one contiguous window of about
// ROOM_WINDOW_MAX messages, never more than ROOM_WINDOW_LIMIT.
import { reconcileRoomMessages } from "./chatMessageIdentity";
import type { PublicChatMessage } from "./publicChat";

/** The room messages a paged window keeps (two history pages) when paging drops its far end. */
export const ROOM_WINDOW_MAX = 160;
/**
 * The most a window ever holds: past ROOM_WINDOW_MAX it keeps the messages on screen too, up to
 * this many (a `range` read returns up to this many).
 */
export const ROOM_WINDOW_LIMIT = 240;

const numbered = (row: PublicChatMessage) => !row.pending && !!row.unread_seq;

/**
 * Adds a history page above ("before") or below ("after") the room's messages; the whole page
 * always joins. Past `max` messages the end farthest from the new page is dropped, but not the
 * rows numbered within `keep` (the ones on screen) unless the window would pass `limit`. Returns
 * the merged messages, the `range` (first,last) they cover, and which ends were dropped (paging
 * that way brings them back).
 */
export function mergeRoomPage(
  current: PublicChatMessage[],
  page: PublicChatMessage[],
  direction: "before" | "after",
  {
    max = ROOM_WINDOW_MAX,
    limit = ROOM_WINDOW_LIMIT,
    keep,
  }: { max?: number; limit?: number; keep?: [number, number] | null } = {},
): { messages: PublicChatMessage[]; range: string | null; droppedOlder: boolean; droppedNewer: boolean } {
  const byId = new Map<string, PublicChatMessage>();
  for (const row of current) if (numbered(row) && !row.removed) byId.set(row.id, row);
  // The page's copy wins (reconcileRoomMessages below keeps an unchanged or newer row's object).
  for (const row of page) byId.set(row.id, row);
  let rows = [...byId.values()].sort((a, b) => (a.unread_seq ?? 0) - (b.unread_seq ?? 0));
  const live = rows.filter((row) => !row.removed && row.unread_seq);
  let droppedOlder = false,
    droppedNewer = false;
  if (live.length > max) {
    let first = 0,
      last = live.length - 1;
    if (direction === "before") {
      // The newest row kept: the window's natural end, or the last row on screen if that is later.
      const lastKept = keep ? live.findLastIndex((row) => row.unread_seq! <= keep[1]) : -1;
      last = Math.min(Math.max(max - 1, lastKept), limit - 1, last);
    } else {
      const firstKept = keep ? live.findIndex((row) => row.unread_seq! >= keep[0]) : -1;
      first = Math.max(Math.min(live.length - max, firstKept < 0 ? live.length : firstKept), live.length - limit, 0);
    }
    droppedOlder = first > 0;
    droppedNewer = last < live.length - 1;
    rows = rows.slice(rows.indexOf(live[first]), rows.indexOf(live[last]) + 1);
  }
  const kept = new Set(rows.map((row) => row.id));
  const seqs = rows.filter((row) => !row.removed && row.unread_seq).map((row) => row.unread_seq!);
  return {
    // Pending sends stay (after the rows, as before); rows dropped from the window go.
    messages: reconcileRoomMessages(
      current.filter((row) => kept.has(row.id) || row.pending),
      rows,
    ),
    range: seqs.length ? `${Math.min(...seqs)},${Math.max(...seqs)}` : null,
    droppedOlder,
    droppedNewer,
  };
}
