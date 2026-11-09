// #363: how an open reply thread's window of replies grows while it is open.
//
// A thread opened at its first unread reply (or at a reply from a link) shows a bounded window,
// `range=first,last`. Before this, every read of that window stopped at its old last reply, so a
// reply posted while the thread was open fell outside it and showed as "Newer replies", and
// pressing that replaced the loaded replies with the newer page. Now a window that reaches the
// newest reply reads open-ended (new replies join it), and paging forward adds below.
import type { PublicChatMessage } from "./publicChat";
import { mergeConfirmedMessages } from "./chatPendingMessages";

/** The highest cursor the window reads accept: a range ending here reads every reply from its first on. */
export const THREAD_TAIL_SEQ = Number.MAX_SAFE_INTEGER;
/** The most replies one thread window holds (the thread read returns up to this many for a range). */
export const THREAD_WINDOW_MAX = 200;

/** The `range=first,last` bounds of a window query, or null for the latest page and other reads. */
export function threadRange(query: string): [number, number] | null {
  const match = /^range=(\d{1,16}),(\d{1,16})$/.exec(query);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/**
 * The read for the thread's current window. A window that already reaches the newest reply reads
 * open-ended, so replies posted since it loaded come with it; an older window reads exactly its range.
 */
export function threadWindowRead(query: string, atTail: boolean): string {
  const range = threadRange(query);
  return range && atTail ? `range=${range[0]},${THREAD_TAIL_SEQ}` : query;
}

/**
 * Whether a live reply the thread has not shown yet can be added straight away (true), or needs a
 * read to place it (false): the latest page and a window that reaches the newest reply take it;
 * an older window, with newer replies beyond it, does not (it would leave a gap).
 */
export function threadTakesLiveReply(query: string, atTail: boolean): boolean {
  return !query || (atTail && !!threadRange(query));
}

const order = (a: PublicChatMessage, b: PublicChatMessage) => a.created_at.localeCompare(b.created_at);

/**
 * "Newer replies": the next page goes below the replies already shown, which stay. Past `max`
 * replies the oldest are dropped (Earlier replies brings them back) and `trimmed` says so.
 * Returns the merged replies and the window query that now covers them.
 */
export function appendThreadPage(
  current: PublicChatMessage[],
  page: PublicChatMessage[],
  query: string,
  max = THREAD_WINDOW_MAX,
): { replies: PublicChatMessage[]; query: string; trimmed: boolean } {
  let replies = mergeConfirmedMessages(current, page).sort(order);
  const live = replies.filter((reply) => !reply.removed && reply.unread_seq);
  let trimmed = false;
  if (live.length > max) {
    const keepFrom = live[live.length - max];
    const cut = replies.indexOf(keepFrom);
    replies = replies.slice(cut);
    trimmed = true;
  }
  const seqs = replies.filter((reply) => !reply.removed && reply.unread_seq).map((reply) => reply.unread_seq!);
  const range = threadRange(query);
  const first = trimmed ? Math.min(...seqs) : Math.min(range?.[0] ?? Infinity, ...seqs),
    last = Math.max(range?.[1] ?? 0, ...seqs);
  return {
    replies,
    query: Number.isFinite(first) && last > 0 ? `range=${first},${last}` : query,
    trimmed,
  };
}

/** The newest reply number among `replies` (0 when none is numbered). */
export function threadNewestSeq(replies: PublicChatMessage[]): number {
  return replies.reduce((max, reply) => Math.max(max, reply.unread_seq ?? 0), 0);
}

/**
 * The thread's "new replies" pill, as the room's new-messages pill: when the reader has scrolled
 * up and replies from others arrive below what they last saw at the bottom. Null when hidden.
 */
export function threadNewRepliesPill(
  replies: PublicChatMessage[],
  seenSeq: number,
  following: boolean,
  memberId?: string | null,
): { unseen: number; label: string } | null {
  if (following || !seenSeq) return null;
  const unseen = replies.filter(
    (reply) =>
      (reply.unread_seq ?? 0) > seenSeq &&
      !reply.pending &&
      !reply.removed &&
      !reply.deleted_at &&
      (!memberId || reply.member_id !== memberId),
  ).length;
  return unseen ? { unseen, label: `${unseen} new repl${unseen === 1 ? "y" : "ies"}` } : null;
}
