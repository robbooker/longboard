import type { ReplyThreads } from "@/lib/chatReplyCounts";
import type { ChatMember } from "@/lib/chatDirectMessages";
import type { ChatRoom, PublicChatMessage, PublicChatReaction, PublicChatRoomState } from "@/lib/publicChat";
/** Server-computed landing spot. `window` is set when messages are a page around the anchor. */
export type ChatBootstrapOpening = {
  messageId: string | null;
  unreadMessageId: string | null;
  parentId: string | null;
  readThrough: number;
  window: { range: string | null; hasMore: boolean; hasNewer: boolean } | null;
};
export type ChatBootstrap = {
  accountId: string;
  room: ChatRoom;
  member: ChatMember | null;
  roomState: PublicChatRoomState;
  messages: PublicChatMessage[];
  reactions: PublicChatReaction[];
  counts: Record<string, number>;
  /** Latest repliers and last reply time per thread (absent from older snapshots). */
  threads?: ReplyThreads;
  featureChannel: boolean;
  /** Absent when the server could not resolve it; the client then looks it up itself. */
  opening?: ChatBootstrapOpening;
};
