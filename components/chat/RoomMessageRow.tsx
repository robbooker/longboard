"use client";
import UnreadStart from "./UnreadStart";
import { useChatDisplayName, useChatSelfName } from "./ChatUpdates";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { memo, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { roomRepliesOff } from "@/lib/publicChat";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import { AvatarTile } from "./ChatAvatar";
import { PictureName } from "./MemberPictureView";
import BuddyStatus from "./BuddyStatus";
import ChatMessageBody from "./ChatMessageBody";
import { CHAT_IMPROVEMENTS_BOT } from "@/lib/chatImprovements";
import { ChatAttachments } from "./ChatAttachments";
import MessageActions from "./MessageActions";
import ChatIcon from "./ChatIcon";
import { BotBadge } from "./MembershipBadges";
import { canPinMessage, MessagePinButton, type MessagePinControls } from "./RoomMessagePins";
import MessageReactions, { openRowReactionPicker } from "./MessageReactions";
import { ChatPollCard } from "./ChatPoll";
import { StockClubCard } from "./StockClubCard";
import { CLUB_BOT } from "@/lib/stockClub";
import { isPollBody } from "@/lib/chatPolls";
import ThreadLink from "./ThreadLink";
import type { ReplyThread } from "@/lib/chatReplyCounts";
import styles from "./PublicChat.module.css";
import SendingMark from "./SendingMark";

export type RoomMessageRowProps = {
  unreadStart?: boolean;
  /** Continues the previous message's group: same person, minutes apart (name line hidden). */
  continued?: boolean;
  /** #331: part of a run of two or more messages from one person. */
  inGroup?: boolean;
  /** #331: first message of its group; it carries the group's Reply and reaction buttons. */
  groupHead?: boolean;
  /** #331: the message the group's buttons act on (its most recent one that can take them). */
  groupTargetId?: string | null;
  groupTargetReplies?: number;
  groupTargetOpen?: boolean;
  /** Arrived after the room loaded; it slides in. */
  fresh?: boolean;
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
  /** Latest repliers and last reply time, when the server sends them. */
  replyThread?: ReplyThread;
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
// #419: a Gainers alert shows its date as well as its time, today's included.
const ALERT_STAMP = { withDate: true };
const RoomMessageRow = memo(function RoomMessageRow({
  unreadStart,
  continued = false,
  inGroup = false,
  groupHead = false,
  groupTargetId = null,
  groupTargetReplies = 0,
  groupTargetOpen = false,
  fresh = false,
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
  replyThread,
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
  // HOVER-ACTIONS: on touch screens, swipe a message right to reply (its buttons stay visible).
  const articleRef = useRef<HTMLElement>(null);
  const gesture = useRef<{ x: number; y: number; swiped: boolean } | null>(null);
  const message = author === original.author_label ? original : { ...original, author_label: author };
  const selfName = useChatSelfName(memberId, selfMember);
  // #419: every Gainers alert shows its own date and time. A group's first alert has them by the
  // name. A later alert has no name line, so its stamp sits at the end of the alert's first line
  // (inside the text, which wraps around it), and the hidden name line leaves the time out so a
  // screen reader says it once. Gainers is broadcast only: no sending, editing or deleting states.
  const alert = room === "gainers";
  const stampInBody = alert && continued && !original.deleted_at && !isPollBody(original.body);
  const bodyStamp = useMemo(() => {
    if (!stampInBody) return undefined;
    // "Nov 10, 07:51" in two halves, so a narrow screen can stack them.
    const text = themeReady
      ? chatTimestamp(original.created_at, undefined, ALERT_STAMP)
      : original.created_at;
    const cut = themeReady ? text.lastIndexOf(", ") : -1;
    return (
      <span className={styles.alertStamp}>
        <time
          className={styles.time}
          dateTime={original.created_at}
          title={themeReady ? chatTimestampTitle(original.created_at) : original.created_at}
        >
          {cut < 0 ? (
            text
          ) : (
            <>
              <span>{text.slice(0, cut)}</span>
              <span className={styles.alertStampJoin}>, </span>
              <span>{text.slice(cut + 2)}</span>
            </>
          )}
        </time>
      </span>
    );
  }, [stampInBody, original.created_at, themeReady]);
  if (message.removed) return null;
  const own = !!memberId && message.member_id === memberId;
  const canReply =
    !roomRepliesOff(room) &&
    !!memberId &&
    !message.pending &&
    // #301: one level of replies; a reply shown in the room (if any) has no Reply of its own.
    !message.reply_to_id &&
    (!readOnlyAnnouncement || !!replyCount);
  // #331: the group's one Reply button, by the name on its first message.
  const groupReply =
    inGroup &&
    groupHead &&
    !!groupTargetId &&
    !roomRepliesOff(room) &&
    !!memberId &&
    (!readOnlyAnnouncement || !!groupTargetReplies);
  const canReactToThis =
    inGroup && !!memberId && !roomPaused && reactionsActive && !message.pending && !message.deleted_at;
  // #414: the name and the picture open the larger view of this person. Tapping another member's
  // name used to open a private message; their view offers that as a button. #330: nobody can
  // message a bot privately, so a bot's view (like your own and a guest's) has no such button.
  const buddy = message.bot_slug === "buddy";
  const authorId = message.member_id;
  const otherMember = !!authorId && authorId !== memberId && !message.memberships?.includes("bot");
  const person = {
    memberId: message.bot_slug ? null : authorId,
    path: message.author_avatar,
    bot: !!message.bot_slug,
    buddy,
    name: buddy
      ? "Buddy"
      : !otherMember && !message.bot_slug && (own || (!!guestId && message.guest_id === guestId))
        ? (selfName ?? message.author_label)
        : message.author_label,
    colorKey: authorId ?? message.guest_id ?? message.author_label,
    onMessage: otherMember ? () => onPrivateMessage(authorId, message.author_label) : undefined,
  };
  const endGesture = () => {
    if (!gesture.current) return;
    gesture.current = null;
    if (articleRef.current) articleRef.current.style.transform = "";
  };
  const touchHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      if ((event.target as Element).closest("button,a,summary,input,textarea,audio,video,[role='button']"))
        return;
      endGesture();
      gesture.current = { x: event.clientX, y: event.clientY, swiped: false };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current) return;
      const dx = event.clientX - current.x,
        dy = event.clientY - current.y;
      if (Math.abs(dy) > 12 || dx < -12) return endGesture();
      if (canReply && dx > 0 && articleRef.current)
        articleRef.current.style.transform = `translateX(${Math.min(dx, 72)}px)`;
      if (canReply && dx > 64 && !current.swiped) {
        current.swiped = true;
        navigator.vibrate?.(8);
      }
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const swiped = gesture.current?.swiped;
      endGesture();
      const trigger =
        event.currentTarget.querySelector<HTMLButtonElement>("button[data-has-replies]") ??
        event.currentTarget.querySelector<HTMLButtonElement>("button");
      if (swiped && trigger) onReply(message.id, trigger);
    },
    onPointerCancel: endGesture,
  };
  const reply = replyCount ? (
    <ThreadLink
      className={styles.replyButton}
      count={replyCount}
      thread={replyThread}
      showAge={themeReady}
      expanded={replyOpen}
      onClick={(event) => onReply(message.id, event.currentTarget)}
    />
  ) : (
    <button
      type="button"
      className={styles.replyButton}
      data-has-replies={false}
      aria-expanded={replyOpen}
      onClick={(event) => onReply(message.id, event.currentTarget)}
    >
      ↳ Reply
    </button>
  );
  return (
    <article
      data-unread-start={unreadStart || undefined}
      className={styles.message}
      id={`chat-message-${message.id}`}
      data-own={own}
      data-continued={continued || undefined}
      data-fresh={fresh || undefined}
      ref={articleRef}
      {...touchHandlers}
      data-pending={message.pending || undefined}
      data-send-failed={message.send_error ? true : undefined}
      data-send-queued={(message.send_queued && !message.send_error) || undefined}
      data-send-client-id={message.send_client_id}
      data-bot={message.bot_slug === "buddy" || undefined}
    >
      {unreadStart && <UnreadStart />}
      <AvatarTile className={styles.avatar} {...person} view />
      <div className={styles.messageIdentity}>
        <PictureName className={`${styles.author} ${styles.memberAuthor}`} person={person} hidden={continued}>
          {buddy ? "@Buddy" : person.name}
        </PictureName>
        <BotBadge memberships={message.memberships} />
        {own && <span className={styles.youTag}>you</span>}
        {!stampInBody && (
          <time
            className={styles.time}
            dateTime={message.created_at}
            title={themeReady ? chatTimestampTitle(message.created_at) : message.created_at}
          >
            {message.send_error ? (
              "Not sent"
            ) : message.send_queued ? (
              "Waiting"
            ) : message.pending ? (
              <SendingMark />
            ) : themeReady ? (
              chatTimestamp(message.created_at, undefined, alert ? ALERT_STAMP : undefined)
            ) : (
              message.created_at
            )}
            {message.edited_at && !message.deleted_at ? " · edited" : ""}
          </time>
        )}
      </div>
      <div className={styles.messageMeta}>
        {/* Until a message has replies or reactions, its actions share the name line. */}
        {inGroup
          ? groupReply && (
              <button
                type="button"
                className={styles.replyButton}
                data-has-replies={false}
                data-group-reply
                aria-label={`Reply to ${message.author_label}'s latest message`}
                aria-expanded={groupTargetOpen}
                onClick={(event) => onReply(groupTargetId!, event.currentTarget)}
              >
                ↳ Reply
              </button>
            )
          : canReply && !replyCount && reply}
        <span data-dm-reaction-host>
          {inGroup && groupHead && groupTargetId && (
            <MessageReactions
              active={reactionsActive}
              target={{ kind: "room", room, messageId: groupTargetId }}
              disabled={roomPaused || !memberId}
              compact
              part="add"
            />
          )}
        </span>
        <MessageActions
          message={message}
          room={room}
          own={own}
          admin={isAdmin && room !== "gainers"}
          paused={roomPaused}
          onEdited={onEdited}
          onDeleted={onDeleted}
          extra={
            <>
              {/* On touch screens the empty "Reply" link is hidden; reply from here or swipe right. */}
              {/* #331: in a group this is how to answer this message rather than the newest one. */}
              {canReply && (inGroup ? !message.deleted_at : !replyCount) && (
                <button
                  type="button"
                  data-menu-reply
                  data-menu-always={inGroup || undefined}
                  onClick={(event) => {
                    const trigger =
                      articleRef.current?.querySelector<HTMLButtonElement>("button[data-has-replies]") ??
                      articleRef.current?.querySelector<HTMLElement>("summary");
                    onReply(message.id, (trigger ?? event.currentTarget) as HTMLButtonElement);
                  }}
                >
                  <ChatIcon name="reply" />
                  {inGroup ? "Reply to this message" : "Reply"}
                </button>
              )}
              {canReactToThis && (
                <button
                  type="button"
                  data-menu-react
                  onClick={(event) => openRowReactionPicker(event.currentTarget)}
                >
                  <ChatIcon name="reaction" />
                  React to this message
                </button>
              )}
              {!message.deleted_at && message.body.trim() && (
                <button type="button" onClick={() => void navigator.clipboard?.writeText(message.body)}>
                  <ChatIcon name="copy" />
                  Copy text
                </button>
              )}
              {canPinMessage(message, pinControls) && (
                <MessagePinButton message={message} controls={pinControls} />
              )}
            </>
          }
        />
      </div>
      {!roomRepliesOff(room) && message.reply_to_id && (
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
      ) : room === "club" && message.bot_slug === CLUB_BOT ? (
        <StockClubCard messageId={message.id} fallback={<MessageBody body={message.body} names={mentionNames} plain />} />
      ) : isPollBody(message.body) && !message.pending ? (
        <ChatPollCard
          room={room}
          messageId={message.id}
          body={message.body}
          disabled={roomPaused || !memberId}
          fallback={<MessageBody body={message.body} names={mentionNames} botSlug={message.bot_slug} />}
        />
      ) : (
        <MessageBody
          body={message.body}
          names={mentionNames}
          plain={message.bot_slug === CHAT_IMPROVEMENTS_BOT}
          botSlug={message.bot_slug}
          lead={bodyStamp}
        />
      )}
      {!message.deleted_at && (
        <>
          <ChatAttachments ids={message.attachment_ids} room={room} media={message.attachment_media} />
          <BuddyStatus status={message.buddy_status} />
        </>
      )}
      {message.send_queued && !message.send_error && (
        <div className={styles.sendFailed} data-send-waiting>
          <p className={styles.sendWaiting} role="status">
            Waiting for connection. It will send when you’re back online.
          </p>
          <button type="button" onClick={() => onDiscardSend?.(message.id)}>
            Delete
          </button>
        </div>
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
        {canReply && !!replyCount && reply}
        {!message.pending && !message.deleted_at && (
          <MessageReactions
            active={reactionsActive}
            target={{ kind: "room", room, messageId: message.id }}
            disabled={roomPaused || !memberId}
            compact
            part={inGroup ? "chips" : "all"}
          />
        )}
      </div>
    </article>
  );
});
export default RoomMessageRow;
