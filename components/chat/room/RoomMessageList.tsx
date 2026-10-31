"use client";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { chatMessagePlacement } from "@/lib/chatTimestamp";
import { chatGroupActions } from "@/lib/chatGroupActions";
import { useRevealGroupedActions } from "../hooks/useRevealGroupedActions";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import { Fragment, memo } from "react";
import ChatIcon from "../ChatIcon";
import type { MessagePinControls } from "../RoomMessagePins";
import RoomMessageRow, { type RoomMessageRowProps } from "../RoomMessageRow";
import type { ReplyThreads } from "@/lib/chatReplyCounts";
import styles from "../PublicChat.module.css";

export type RoomMessageListProps = {
  loading: boolean;
  messages: PublicChatMessage[];
  /**
   * Render only this many of the newest rows (DEVICE-STORE: a room drawn at once shows one screen
   * first and the rest right after the first paint). Default: every row.
   */
  limit?: number;
  /** A fixed history window is showing (after an unread, pin or page jump). */
  windowed: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  room: ChatRoom;
  roomLabel: string;
  gainers: boolean;
  recordings: boolean;
  announcement: boolean;
  themeReady: boolean;
  unreadStart: string | null;
  /** When the room finished loading; newer messages slide in. 0 while loading. */
  loadedAt: number;
  pinControls: MessagePinControls;
  member: ChatMember | null;
  guestId: string;
  isAdmin: boolean;
  roomPaused: boolean;
  readOnlyAnnouncement: boolean;
  replyCounts: Record<string, number>;
  replyThreads: ReplyThreads;
  replyTarget: string | null;
  reactionsActive: boolean;
  mentionNames: string[];
  onPrivateMessage: RoomMessageRowProps["onPrivateMessage"];
  onReply: RoomMessageRowProps["onReply"];
  onEdited: RoomMessageRowProps["onEdited"];
  onDeleted: RoomMessageRowProps["onDeleted"];
  onRetrySend: NonNullable<RoomMessageRowProps["onRetrySend"]>;
  onDiscardSend: NonNullable<RoomMessageRowProps["onDiscardSend"]>;
};

/** The room's rows inside the scrolling log: skeleton, empty state, or messages with day dividers. */
function RoomMessageList({
  loading,
  messages,
  limit = Infinity,
  windowed,
  searchOpen,
  onToggleSearch,
  room,
  roomLabel,
  gainers,
  recordings,
  announcement,
  themeReady,
  unreadStart,
  loadedAt,
  pinControls,
  member,
  guestId,
  isAdmin,
  roomPaused,
  readOnlyAnnouncement,
  replyCounts,
  replyThreads,
  replyTarget,
  reactionsActive,
  mentionNames,
  onPrivateMessage,
  onReply,
  onEdited,
  onDeleted,
  onRetrySend,
  onDiscardSend,
}: RoomMessageListProps) {
  useRevealGroupedActions();
  // Day dividers and grouping use the viewer's clock, so they wait for hydration like the
  // timestamps do.
  const placements = messages.map((message, index) =>
    themeReady
      ? chatMessagePlacement(messages[index - 1], message, {
          // A thread link under the message before sits between them: start a new group.
          breakGroup: unreadStart === message.id || !!replyCounts[messages[index - 1]?.id],
        })
      : { day: null, continued: false },
  );
  // #331: the group's buttons act on its newest message that can take a reply and a reaction.
  const groups = chatGroupActions(
    messages,
    placements.map((placement) => placement.continued),
    (message) =>
      !message.deleted_at &&
      !message.removed &&
      !message.pending &&
      !message.send_error &&
      !message.send_queued &&
      !message.reply_to_id,
  );
  return loading ? (
    <div className={styles.loading} data-skeleton>
      <span className={styles.srOnly}>Loading the room…</span>
      {[64, 42, 78, 55, 70].map((width, index) => (
        <div key={index} className={styles.skeletonRow} aria-hidden="true">
          <span />
          <span style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  ) : messages.length === 0 ? (
    <div className={styles.empty}>
      <strong>{windowed ? "No messages remain on this page." : "No messages yet."}</strong>
      <button type="button" className={styles.searchTab} aria-pressed={searchOpen} onClick={onToggleSearch}>
        <ChatIcon name="search" /> Search
      </button>
      <span>
        {gainers
          ? "New Gainers alerts will appear here."
          : recordings
            ? "New recordings will appear here."
            : room === "whats-new"
              ? "Longboard updates will appear here as they go live."
            : announcement
              ? "New announcements will appear here."
              : room === "social"
                ? "Seen a good movie lately? Start the conversation."
                : room === "developers"
                  ? "Building something with an API, a web page, a dashboard or an app? Share it here."
                  : room === "lb-review"
                    ? "Each trading day's gainers page is posted here in the evening."
                  : room === "runner-watch"
                    ? "Runner Risk Watch updates from Jake's watchlist appear here. AI-generated research, not trade advice."
                  : room === "admins"
                    ? "Only admins can see this room. FAQ topic suggestions arrive here."
                  : `Start the ${roomLabel} conversation below.`}
      </span>
    </div>
  ) : (
    <>
      {(limit < messages.length ? messages.slice(-limit) : messages).map((message, shown) => {
        const index = shown + Math.max(0, messages.length - limit);
        const placement = placements[index],
          group = groups[index],
          target = group.targetId;
        return (
          <Fragment key={message.id}>
            {placement.day && (
              <div className={styles.dayDivider} role="separator" aria-label={placement.day}>
                <span>{placement.day}</span>
              </div>
            )}
            <RoomMessageRow
              pinControls={pinControls}
              continued={placement.continued}
              inGroup={group.inGroup}
              groupHead={group.head}
              groupTargetId={group.inGroup ? target : null}
              groupTargetReplies={group.inGroup && target ? (replyCounts[target] ?? 0) : 0}
              groupTargetOpen={group.inGroup && !!target && replyTarget === target}
              fresh={loadedAt > 0 && Date.parse(message.created_at) > loadedAt}
              message={message}
              room={room}
              memberId={member?.id}
              selfMember={member ?? undefined}
              guestId={guestId}
              themeReady={themeReady}
              isAdmin={isAdmin}
              roomPaused={roomPaused}
              readOnlyAnnouncement={readOnlyAnnouncement}
              unreadStart={unreadStart === message.id}
              replyCount={replyCounts[message.id] ?? 0}
              replyThread={replyThreads[message.id]}
              replyOpen={replyTarget === message.id}
              reactionsActive={reactionsActive}
              mentionNames={mentionNames}
              onPrivateMessage={onPrivateMessage}
              onReply={onReply}
              onEdited={onEdited}
              onDeleted={onDeleted}
              onRetrySend={onRetrySend}
              onDiscardSend={onDiscardSend}
            />
          </Fragment>
        );
      })}
    </>
  );
}

export default memo(RoomMessageList);
