"use client";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { chatMessagePlacement } from "@/lib/chatTimestamp";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import { Fragment, memo } from "react";
import ChatIcon from "../ChatIcon";
import type { MessagePinControls } from "../RoomMessagePins";
import RoomMessageRow, { type RoomMessageRowProps } from "../RoomMessageRow";
import styles from "../PublicChat.module.css";

export type RoomMessageListProps = {
  loading: boolean;
  messages: PublicChatMessage[];
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
            : announcement
              ? "New announcements will appear here."
              : room === "social"
                ? "Seen a good movie lately? Start the conversation."
                : `Start the ${roomLabel} conversation below.`}
      </span>
    </div>
  ) : (
    <>
      {messages.map((message, index) => {
        // Day dividers and grouping use the viewer's clock, so they wait for hydration
        // like the timestamps do.
        const placement = themeReady
          ? chatMessagePlacement(messages[index - 1], message, {
              breakGroup: unreadStart === message.id,
            })
          : { day: null, continued: false };
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
