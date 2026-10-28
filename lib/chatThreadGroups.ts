import { chatMessagePlacement, type Groupable } from "./chatTimestamp";

/**
 * GROUP-REST (#318): which replies in a conversation continue the reply above them, using the
 * room's grouping rule (same person, same day, within 5 minutes). A continued reply tucks under
 * the one above it without repeating the name and picture, like back-to-back room messages.
 * A reply starts a new group when the unread marker sits on it, or when `startsGroup` says so
 * (a "replying to <name>" line belongs with the name line).
 */
export function threadReplyGroups<T extends Groupable & { id: string }>(
  replies: readonly T[],
  options: { unreadStart?: string | null; startsGroup?: (reply: T) => boolean } = {},
): boolean[] {
  return replies.map(
    (reply, index) =>
      chatMessagePlacement(replies[index - 1], reply, {
        breakGroup: options.unreadStart === reply.id || !!options.startsGroup?.(reply),
      }).continued,
  );
}
