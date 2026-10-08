"use client";
import UnreadStart from "./UnreadStart";
import { useChatDisplayName, useChatSelfName } from "./ChatUpdates";
import type { ChatMember } from "@/lib/chatDirectMessages";
import MembershipBadges from "./MembershipBadges";
import { memo } from "react";
import { isRecordingRoom } from "@/lib/publicChat";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import BuddyStatus from "./BuddyStatus";
import ChatMessageBody from "./ChatMessageBody";
import { ChatAttachments } from "./ChatAttachments";
import MessageActions from "./MessageActions";
import { MessagePinButton, type MessagePinControls } from "./RoomMessagePins";
import MessageReactions from "./MessageReactions";
import styles from "./PublicChat.module.css";

export type RoomMessageRowProps = {
  unreadStart?: boolean;
  message: PublicChatMessage;
  room: ChatRoom;
  memberId?: string;
  selfMember?: ChatMember;
  guestId: string;
  themeReady: boolean;
  isAdmin: boolean;
  roomPaused: boolean;
  readOnlyAnnouncement: boolean;
  replyCount: number;
  replyOpen: boolean;
  reactionsActive: boolean;
  mentionNames: string[];
  pinControls?: MessagePinControls;
  onPrivateMessage: (memberId: string, label: string) => void;
  onReply: (messageId: string, trigger: HTMLButtonElement) => void;
  onEdited: (message: PublicChatMessage) => void;
  onDeleted: (messageId: string, message?: PublicChatMessage | null) => void;
  onRetrySend?: (message: PublicChatMessage) => void;
  onDiscardSend?: (messageId: string) => void;
};
// Counts/permissions can change independently of message text and media tokenization.
const MessageBody = memo(ChatMessageBody);
const RoomMessageRow = memo(function RoomMessageRow({
  unreadStart,
  message: original,
  room,
  memberId,
  selfMember,
  guestId,
  themeReady,
  isAdmin,
  roomPaused,
  readOnlyAnnouncement,
  replyCount,
  replyOpen,
  reactionsActive,
  mentionNames,
  pinControls,
  onPrivateMessage,
  onReply,
  onEdited,
  onDeleted,
  onRetrySend,
  onDiscardSend,
}: RoomMessageRowProps) {
  const author = useChatDisplayName(original.bot_slug ? null : original.member_id, original.author_label);
  const message = author === original.author_label ? original : { ...original, author_label: author };
  const selfName = useChatSelfName(memberId, selfMember);
  if (message.removed) return null;
  const own = !!memberId && message.member_id === memberId;
  return (
    <article
      data-unread-start={unreadStart || undefined}
      className={styles.message}
      id={`chat-message-${message.id}`}
      data-own={own}
      data-pending={message.pending || undefined}
      data-send-failed={message.send_error ? true : undefined}
      data-bot={message.bot_slug === "buddy" || undefined}
    >
      {unreadStart && <UnreadStart />}
      <div className={styles.messageIdentity}>
        {message.member_id && message.member_id !== memberId ? (
          <button
            type="button"
            className={`${styles.author} ${styles.memberAuthor}`}
            title={`Message ${message.author_label} privately`}
            onClick={() => onPrivateMessage(message.member_id!, message.author_label)}
          >
            {message.author_label}
            <MembershipBadges memberships={message.bot_slug ? [] : message.memberships} />
            <span className={styles.memberBadge}>MESSAGE ↗</span>
          </button>
        ) : (
          <span className={styles.author}>
            {message.bot_slug === "buddy"
              ? "@BUDDY"
              : !message.bot_slug && (own || (!!guestId && message.guest_id === guestId))
                ? (selfName ?? message.author_label)
                : message.author_label}
            <MembershipBadges memberships={message.bot_slug ? [] : message.memberships} />
          </span>
        )}
        <time
          className={styles.time}
          dateTime={message.created_at}
          title={themeReady ? chatTimestampTitle(message.created_at) : message.created_at}
        >
          {message.send_error
            ? "NOT SENT"
            : message.pending
              ? "SENDING"
              : themeReady
                ? chatTimestamp(message.created_at)
                : message.created_at}
          {message.edited_at && !message.deleted_at ? " · edited" : ""}
        </time>
      </div>
      <div className={styles.messageMeta}>
        <MessageActions
          message={message}
          room={room}
          own={own}
          admin={isAdmin && room !== "gainers"}
          paused={roomPaused}
          onEdited={onEdited}
          onDeleted={onDeleted}
        />
        <MessagePinButton message={message} controls={pinControls} />
      </div>
      {!isRecordingRoom(room) && message.reply_to_id && (
        <button
          type="button"
          className={styles.replyButton}
          onClick={(event) => onReply(message.reply_to_id!, event.currentTarget)}
        >
          ↳ View parent conversation
        </button>
      )}
      {message.deleted_at ? (
        <p className={styles.deletedMessage}>Message deleted</p>
      ) : (
        <MessageBody body={message.body} names={mentionNames} />
      )}
      {!message.deleted_at && (
        <>
          <ChatAttachments ids={message.attachment_ids} room={room} />
          <BuddyStatus status={message.buddy_status} />
        </>
      )}
      {message.send_error && (
        <div className={styles.sendFailed}>
          <p role="alert">{message.send_error}</p>
          <button type="button" disabled={roomPaused} onClick={() => onRetrySend?.(original)}>
            Retry
          </button>
          <button type="button" onClick={() => onDiscardSend?.(message.id)}>
            Delete
          </button>
        </div>
      )}
      <div className={styles.messageFooter}>
        {!isRecordingRoom(room) &&
          room !== "gainers" &&
          memberId &&
          !message.pending &&
          (!readOnlyAnnouncement || !!replyCount) && (
            <button
              type="button"
              className={styles.replyButton}
              data-has-replies={replyCount > 0}
              aria-expanded={replyOpen}
              onClick={(event) => onReply(message.id, event.currentTarget)}
            >
              ↳ {replyCount ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Reply"}
            </button>
          )}
        {!message.pending && !message.deleted_at && (
          <MessageReactions
            active={reactionsActive}
            target={{ kind: "room", room, messageId: message.id }}
            disabled={roomPaused || !memberId}
          />
        )}
      </div>
    </article>
  );
});
export default RoomMessageRow;
