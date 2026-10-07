import type { PublicChatMessage } from "./publicChat";

export type JumpToLatestInput = {
  messages: PublicChatMessage[];
  /** Newest sequence seen when the reader stopped following; Infinity while following. */
  awaySeq: number;
  memberId?: string | null;
  following: boolean;
  atBottom: boolean;
  farFromBottom: boolean;
  /** The loaded page is an older window with newer messages beyond it. */
  hasNewer: boolean;
};

/** What the floating return-to-latest control shows, or null when it should be hidden. */
export function jumpToLatestState({
  messages,
  awaySeq,
  memberId,
  following,
  atBottom,
  farFromBottom,
  hasNewer,
}: JumpToLatestInput): { unseen: number; label: string } | null {
  if (!messages.length || (!hasNewer && (following || atBottom))) return null;
  const unseen = messages.filter(
    (message) =>
      (message.unread_seq ?? 0) > awaySeq &&
      !message.pending &&
      !message.removed &&
      !message.deleted_at &&
      (!memberId || message.member_id !== memberId),
  ).length;
  if (!unseen && !farFromBottom && !hasNewer) return null;
  return { unseen, label: unseen ? `${unseen} new message${unseen === 1 ? "" : "s"}` : "Jump to latest" };
}
