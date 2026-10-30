"use client";
import UnreadStart from "./UnreadStart";
import { BotBadge } from "./MembershipBadges";
import { flashChatMessage } from "@/lib/chatJumpHighlight";
import {
  revealPinnedMessage,
  watchPinnedMessageIntent,
  type PinnedMessageJump,
} from "@/lib/chatPinnedMessageJump";
import {
  chatPaneVisible,
  chatPaneFollowingScroll,
  chatPaneScrollIntent,
  chatScrollPointer,
  chatScrollKey,
  type ChatScrollIntent,
  watchChatPaneLayout,
} from "@/lib/chatScrollFollow";
import { useVisibleChatNotifications } from "./hooks/useVisibleChatNotifications";
import { useChatScrollIntent } from "./hooks/useChatScrollIntent";
import ComposerLinkPreview from "./ComposerLinkPreview";
import { GifComposer } from "./ChatGif";
import ComposerSend from "./ComposerSend";
import ChatIcon from "./ChatIcon";
import composerStyles from "./ChatComposer.module.css";
import { beginMobileSend } from "@/lib/chatMobileSend";
import { waitForAttachments } from "@/lib/chatAttachmentWaits";
import { useChatRefreshGuard } from "./hooks/useChatRefreshGuard";
import VoiceRecorder from "./VoiceRecorder";
import BuddyStatus from "./BuddyStatus";
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import { threadReplyGroups } from "@/lib/chatThreadGroups";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { mergeConfirmedMessages } from "@/lib/chatPendingMessages";
import { numberedThreadChange } from "@/lib/chatEventStreamRows";
import { realtimeRoomMessage } from "@/lib/chatRealtimeRoom";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { AttachmentPicker, ChatAttachments } from "./ChatAttachments";
import MentionTextarea from "./MentionTextarea";
import { MentionText } from "./MemberMention";
import { ChatPollCard, ChatPollComposer } from "./ChatPoll";
import { isPollBody } from "@/lib/chatPolls";
import MessageReactions, { openRowReactionPicker } from "./MessageReactions";
import MessageActions from "./MessageActions";
import { chatGroupActions, type GroupActions } from "@/lib/chatGroupActions";
import { useRevealGroupedActions } from "./hooks/useRevealGroupedActions";
import { canPinMessage, MessagePinButton, type MessagePinControls } from "./RoomMessagePins";
import { useChatUpdates, useChatNameLabel, useChatSelfName } from "./ChatUpdates";
import { useAttachments } from "./hooks/useAttachments";
import { answeredTarget } from "@/lib/chatAnswered";
import { chatAvatarColor, chatInitials } from "@/lib/chatAvatar";
import styles from "./PublicChat.module.css";
import SendingMark from "./SendingMark";
import panelStyles from "./ChatReplyPanel.module.css";
const BUDDY = ["Buddy"];
type PendingReply = {
  id: string;
  body: string;
  files: string[];
  names: string[];
  createdAt: string;
  state: "sending" | "failed";
  error?: string;
  /** D-305: the reply this one answers (sent as replyTo; the database files it under the original). */
  answering?: string;
};
/** D-305: centre a thread row in its pane and mark it briefly, as a jump from search does. */
function centreAndFlash(node: HTMLElement, target: HTMLElement) {
  const offset = target.getBoundingClientRect().top - node.getBoundingClientRect().top;
  node.scrollTop += offset - Math.max(0, (node.clientHeight - target.offsetHeight) / 2);
  return flashChatMessage(target);
}
/** `answering`: D-305, the reply the composer is answering (kept with the draft). */
export type ReplyDraft = {
  body: string;
  scroll: number;
  pending?: PendingReply[];
  answering?: { id: string; name: string };
};
export default function ChatReplyPanel({
  openingUnread,
  focusReply,
  onUnreadVisible,
  pinJump,
  pinControls,
  notificationActive = true,
  isolated = false,
  messageId,
  memberId,
  selfMember,
  room,
  paused,
  readOnly = false,
  depth,
  draft,
  onBack,
  onOpen,
  onClose,
  onSent,
}: {
  openingUnread?: { messageId: string; readThrough: number };
  /** A reply reached from search or a message link: open around it, show it, mark it briefly. */
  focusReply?: string;
  onUnreadVisible?: (through: number) => void;
  pinJump?: PinnedMessageJump;
  pinControls?: MessagePinControls;
  notificationActive?: boolean;
  isolated?: boolean;
  messageId: string;
  memberId?: string;
  selfMember?: ChatMember;
  room: ChatRoom;
  paused: boolean;
  readOnly?: boolean;
  depth: number;
  draft: ReplyDraft;
  onBack: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
  onSent: (message: PublicChatMessage) => void;
}) {
  const updates = useChatUpdates();
  const nameLabel = useChatNameLabel();
  const selfName = useChatSelfName(memberId, selfMember);
  const authorName = (message: Pick<PublicChatMessage, "bot_slug" | "member_id" | "author_label">) =>
    !message.bot_slug && !!memberId && message.member_id === memberId
      ? (selfName ?? message.author_label)
      : nameLabel(message.bot_slug ? null : message.member_id, message.author_label);
  const generatedId = useId();
  const inputId = isolated ? `reply-${generatedId}` : "thread-reply";
  const [parent, setParent] = useState<PublicChatMessage | null>(null),
    [replies, setReplies] = useState<PublicChatMessage[]>([]),
    [body, setBody] = useState(draft.body),
    [error, setError] = useState(""),
    [more, setMore] = useState(false),
    // D-305: Reply on a reply. The composer answers that reply; the new reply still lands in this
    // one list (the database keeps it under the original message, with answered_id = the reply).
    [answering, setAnsweringState] = useState<{ id: string; name: string } | null>(draft.answering ?? null);
  const setAnswering = (next: { id: string; name: string } | null) => {
    draft.answering = next ?? undefined;
    setAnsweringState(next);
  };
  // #301: one level of replies. A reply that answered another reply says whom it answered.
  const replyingTo = (reply: Pick<PublicChatMessage, "answered_id" | "answered">) => {
    const target = answeredTarget(reply, parent ? [parent, ...replies] : replies);
    if (!target) return null;
    return target.deleted
      ? "replying to a deleted message"
      : `replying to ${authorName(target.message)}`;
  };
  // The composer names the reply it answers by its current author name (it may have changed).
  const answeringShown = answering ? replies.find((reply) => reply.id === answering.id) : undefined;
  const answeringName = answering ? (answeringShown ? authorName(answeringShown) : answering.name) : null;
  // AVATARS-REST: the same initials tile as a room row, so the thread reads down one column.
  const avatar = (message: PublicChatMessage, name: string) => (
    <span
      className={panelStyles.avatar}
      aria-hidden="true"
      data-bot={message.bot_slug === "buddy" || undefined}
      style={{ background: chatAvatarColor(message.member_id ?? message.guest_id ?? message.author_label) }}
    >
      {chatInitials(message.bot_slug === "buddy" ? "Buddy" : name)}
    </span>
  );
  const shownParent = useRef(parent),
    shownReplies = useRef(replies);
  shownParent.current = parent;
  shownReplies.current = replies;
  const knownReplyIds = useRef("");
  knownReplyIds.current = replies
    .slice(-200)
    .map((reply) => reply.id)
    .join(",");
  const uploads = useAttachments(room);
  const revision = useRef(0),
    pageBusy = useRef(0);
  const acknowledged = useRef(new Map<string, { message: PublicChatMessage; expires: number }>());
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<PendingReply[]>(draft.pending ?? []);
  const pendingRef = useRef(pending);
  useChatRefreshGuard(
    memberId,
    `thread:${room}:${messageId}`,
    body,
    (value) => {
      draft.body = value;
      setBody(value);
    },
    uploads.blocked || uploads.files.length > 0 || pending.length > 0,
  );
  const savePending = useCallback(
    (change: (current: PendingReply[]) => PendingReply[]) => {
      const next = change(draft.pending ?? pendingRef.current);
      pendingRef.current = next;
      draft.pending = next;
      if (mounted.current) setPending(next);
    },
    [draft],
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const voiceStart = useRef<(() => void) | null>(null);
  const panel = useRef<HTMLElement>(null);
  const contents = useRef<HTMLDivElement>(null);
  const openedFromPin = useRef(!!pinJump),
    currentPin = useRef(pinJump);
  // Kept from the mount: the panel is remounted for each new jump (PublicChat's key).
  const focusTarget = useRef(focusReply),
    focusCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => focusCleanup.current?.(), []);
  currentPin.current = pinJump;
  const [unreadStart, setUnreadStart] = useState<string | null>(null),
    [hasNewer, setHasNewer] = useState(false),
    [paging, setPaging] = useState(false),
    [sentWindowRetry, setSentWindowRetry] = useState(false);
  const windowQuery = useRef(""),
    openingDone = useRef(false),
    openingTarget = useRef<string | null>(null),
    openingThrough = useRef(0),
    openingCancelled = useRef(false);
  const pageTarget = useRef<"first" | "last" | null>(null),
    readVisible = useRef(onUnreadVisible);
  readVisible.current = onUnreadVisible;
  const navigationIntent = useRef(0),
    following = useRef(false),
    scrollIntent = useRef<ChatScrollIntent | null>(null),
    resumeLive = useRef(false);
  useChatScrollIntent(scrollIntent);
  const cancelOpening = () => {
    navigationIntent.current++;
    openingCancelled.current = true;
    openingTarget.current = null;
  };
  useEffect(() => watchPinnedMessageIntent(cancelOpening), []);
  useLayoutEffect(() => {
    if (!notificationActive) cancelOpening();
    if (pinJump) {
      cancelOpening();
      following.current = false;
      scrollIntent.current = null;
      resumeLive.current = false;
      setUnreadStart(null);
    }
  }, [notificationActive, pinJump]);

  useVisibleChatNotifications({
    container: contents,
    enabled: notificationActive && !!memberId && !!parent && !error,
    scope: { kind: "room", room },
    canonicalIds: [...(parent ? [parent] : []), ...replies]
      .filter((message) => !message.pending && !message.deleted_at && !message.removed)
      .map((message) => message.id),
    selector: "[data-thread-message-id]",
    attribute: "data-thread-message-id",
  });
  const sending = useRef(false);
  const [pollOpen, setPollOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const load = async () => {
      if (running || sending.current) return;
      running = true;
      const version = revision.current;
      try {
        if (!openingDone.current) {
          if (!currentPin.current) {
            let snapshot =
              openingUnread ??
              (focusTarget.current ? { messageId: focusTarget.current, readThrough: 0 } : undefined);
            if (!snapshot) {
              const response = await fetch(`/api/chat/opening?room=${room}&thread=${messageId}`, {
                cache: "no-store",
              });
              if (!response.ok)
                throw Error("Could not find unread replies. Reopen this conversation to retry.");
              snapshot = await response.json();
            }
            if (cancelled || version !== revision.current) return;
            if (!openingCancelled.current && !currentPin.current) {
              openingTarget.current = snapshot?.messageId ?? "latest";
              openingThrough.current = Number(snapshot?.readThrough) || 0;
              windowQuery.current = snapshot?.messageId ? `around=${snapshot.messageId}` : "";
            }
          }
          openingDone.current = true;
        }
        const query = windowQuery.current;
        const path = `/api/chat/thread?room=${room}&messageId=${messageId}&ids=${knownReplyIds.current}${query ? `&${query}` : ""}`;
        const response = await (updates ? updates.read(path) : fetch(path, { cache: "no-store" }));
        const data = await response.json();
        if (cancelled || sending.current || version !== revision.current || query !== windowQuery.current)
          return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) {
            setParent(null);
            setReplies([]);
            acknowledged.current.clear();
          }
          throw Error(data.error || "Could not load replies.");
        }
        if (data.range) windowQuery.current = `range=${data.range}`;
        if (query && resumeLive.current && following.current && !data.hasNewer) {
          windowQuery.current = "";
          resumeLive.current = false;
          updates?.invalidate("room");
        }
        setHasNewer(!!data.hasNewer);
        if (
          openingTarget.current &&
          openingTarget.current !== "latest" &&
          !openingCancelled.current &&
          !currentPin.current &&
          !focusTarget.current
        )
          setUnreadStart(openingTarget.current);
        setParent(data.parent);
        const fetched = data.replies as PublicChatMessage[];
        for (const [id, entry] of acknowledged.current)
          if (entry.expires <= Date.now() || fetched.some((message) => message.id === id))
            acknowledged.current.delete(id);
        setReplies((current) =>
          mergeConfirmedMessages(
            current.filter((message) => message.removed || acknowledged.current.has(message.id)),
            [...fetched, ...Array.from(acknowledged.current.values(), (entry) => entry.message)],
          ).sort((a, b) => a.created_at.localeCompare(b.created_at)),
        );
        setMore(data.hasMore);
        setError("");
        const confirmed = new Set(
          (data.replies as PublicChatMessage[])
            .filter((m) => m.member_id === memberId)
            .map((m) => m.client_id),
        );
        savePending((current) => current.filter((item) => !confirmed.has(item.id)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load replies.");
      } finally {
        running = false;
      }
    };
    // EVENT-STREAM step 2: while the room is in step, its numbered rows for this conversation
    // are merged as they come (no reload per room event) and the timer relaxes to five minutes.
    const stop = updates?.watch(load, ["room"], true, 10000, 60000, "rooms", room);
    if (!updates) void load();
    const reload = () => updates?.refresh(load, "row");
    const live = (event: Event) => {
      const change = numberedThreadChange((event as CustomEvent).detail, room, messageId);
      if (!change || cancelled) return;
      if (change.kind === "reload") return reload();
      if (change.kind === "delete") {
        acknowledged.current.delete(change.id);
        setReplies((current) =>
          current.some((message) => message.id === change.id)
            ? current.filter((message) => message.id !== change.id)
            : current,
        );
        return;
      }
      const shown = [...(shownParent.current ? [shownParent.current] : []), ...shownReplies.current];
      // Not loaded yet: the first read brings it.
      if (!shownParent.current) return;
      const known = shown.some((message) => message.id === change.row.id);
      // An older page shows only its own range: let the read place a new reply.
      if (!known && windowQuery.current) return reload();
      // Our own reply still sending: its answer adds it (and clears the sending copy).
      if (
        !known &&
        change.row.member_id === memberId &&
        pendingRef.current.some((item) => item.state === "sending")
      )
        return;
      const projected = realtimeRoomMessage(shown, change.row);
      if (projected.needsProjection) reload();
      // Keep what the read added (image sizes) unless the row brings its own.
      const message = {
        ...shown.find((row) => row.id === change.row.id),
        ...projected.message,
        ...(change.row.attachment_media
          ? { attachment_media: change.row.attachment_media as PublicChatMessage["attachment_media"] }
          : {}),
      };
      if (message.id === messageId) {
        setParent((current) =>
          current && (current.revision ?? 0) > (message.revision ?? 0) ? current : message,
        );
        return;
      }
      // Kept across a read that started before it, like a confirmed send.
      acknowledged.current.set(message.id, { message, expires: Date.now() + 15000 });
      setReplies((current) =>
        mergeConfirmedMessages(current, [message]).sort((a, b) => a.created_at.localeCompare(b.created_at)),
      );
    };
    window.addEventListener("chat-room-event", live);
    return () => {
      cancelled = true;
      stop?.();
      window.removeEventListener("chat-room-event", live);
    };
  }, [messageId, room, updates, memberId, savePending, openingUnread]);
  useEffect(() => {
    // Not for a jump to a reply: the reader came to read it (and a phone keyboard would cover it).
    if (!parent?.id || openedFromPin.current || openingUnread || focusTarget.current) return;
    if (
      !isolated ||
      (panel.current?.getClientRects().length &&
        panel.current.parentElement?.contains(document.activeElement))
    )
      input.current?.focus({ preventScroll: true });
  }, [parent?.id, draft, isolated, openingUnread]);
  useLayoutEffect(() => {
    const node = contents.current;
    if (
      !node ||
      !parent ||
      currentPin.current ||
      document.hidden ||
      document.querySelector('dialog[open],[aria-modal="true"]')
    )
      return;
    return watchChatPaneLayout(node, () => {
      if (answeredJump.current) {
        const target = node.querySelector<HTMLElement>(
          `[data-thread-message-id="${CSS.escape(answeredJump.current)}"]`,
        );
        answeredJump.current = null;
        if (target) {
          focusCleanup.current?.();
          focusCleanup.current = centreAndFlash(node, target);
          draft.scroll = node.scrollTop;
          pageTarget.current = null;
          scrollIntent.current = null;
          return;
        }
      }
      if (notificationActive && pageTarget.current) {
        const rows = node.querySelectorAll<HTMLElement>("[data-thread-message-id]");
        const target = pageTarget.current === "first" ? (rows[1] ?? rows[0]) : rows[rows.length - 1];
        if (target) {
          node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top;
          pageTarget.current = null;
          scrollIntent.current = null;
        }
        return;
      }
      if (notificationActive && openingTarget.current && !openingCancelled.current) {
        if (openingTarget.current === "latest") {
          following.current = true;
          openingTarget.current = null;
        } else {
          const target = node.querySelector<HTMLElement>(
            `[data-thread-message-id="${openingTarget.current}"]`,
          );
          if (target) {
            const offset = target.getBoundingClientRect().top - node.getBoundingClientRect().top;
            // A reply reached by a jump is centred (as the room centres one), with earlier replies above.
            const focused = focusTarget.current === openingTarget.current;
            node.scrollTop += focused
              ? offset - Math.max(0, (node.clientHeight - target.offsetHeight) / 2)
              : offset;
            if (focused) {
              focusCleanup.current?.();
              focusCleanup.current = flashChatMessage(target);
            }
            openingTarget.current = null;
            scrollIntent.current = null;
            draft.scroll = node.scrollTop;
            if (openingThrough.current) readVisible.current?.(openingThrough.current);
          }
          return;
        }
      }
      if (following.current && !hasNewer) {
        node.scrollTop = node.scrollHeight;
        scrollIntent.current = null;
        draft.scroll = node.scrollTop;
      }
    });
  }, [parent, replies, pending.length, notificationActive, draft, hasNewer]);
  async function pageReplies(direction: "before" | "after") {
    if (paging) return;
    cancelOpening();
    following.current = false;
    scrollIntent.current = null;
    resumeLive.current = false;
    setUnreadStart(null);
    const rows = replies
        .filter((row) => !row.removed && row.unread_seq)
        .sort((a, b) => (a.unread_seq ?? 0) - (b.unread_seq ?? 0)),
      cursor =
        direction === "before"
          ? (rows[0]?.unread_seq ?? Number(windowQuery.current.replace("range=", "").split(",")[0]))
          : (rows.at(-1)?.unread_seq ?? Number(windowQuery.current.replace("range=", "").split(",")[1]));
    if (!cursor) return;
    const version = ++revision.current,
      busy = ++pageBusy.current;
    setPaging(true);
    try {
      const response = await fetch(
        `/api/chat/thread?room=${room}&messageId=${messageId}&ids=${knownReplyIds.current}&${direction}=${cursor}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!mounted.current || version !== revision.current) return;
      if (!response.ok) throw Error("Could not load these replies. Try again.");
      if (!data.replies?.some((row: PublicChatMessage) => !row.removed)) {
        setError("This page changed. Use latest room message to refresh.");
        return;
      }
      windowQuery.current = data.range ? `range=${data.range}` : "";
      setParent(data.parent);
      setReplies((current) =>
        mergeConfirmedMessages(
          current.filter((m) => m.removed || acknowledged.current.has(m.id)),
          data.replies,
        ),
      );
      setMore(!!data.hasMore);
      setHasNewer(!!data.hasNewer);
      pageTarget.current = direction === "before" ? "last" : "first";
      setError("");
    } catch (e) {
      if (mounted.current && version === revision.current)
        setError(e instanceof Error ? e.message : "Could not load replies.");
    } finally {
      if (mounted.current && busy === pageBusy.current) setPaging(false);
    }
  }
  // D-305: "replying to <name>" jumps to the reply it answered and marks it briefly. A reply older
  // than the loaded ones loads with the replies around it first (as Earlier replies would).
  const answeredJump = useRef<string | null>(null);
  const revealAnswered = (node: HTMLElement, target: HTMLElement) => {
    focusCleanup.current?.();
    focusCleanup.current = centreAndFlash(node, target);
    draft.scroll = node.scrollTop;
  };
  async function jumpToAnswered(id: string) {
    cancelOpening();
    following.current = false;
    scrollIntent.current = null;
    resumeLive.current = false;
    const node = contents.current;
    const shown = node?.querySelector<HTMLElement>(`[data-thread-message-id="${CSS.escape(id)}"]`);
    if (node && shown) {
      revealAnswered(node, shown);
      return;
    }
    if (paging) return;
    const version = ++revision.current,
      busy = ++pageBusy.current;
    setPaging(true);
    try {
      const response = await fetch(
        `/api/chat/thread?room=${room}&messageId=${messageId}&ids=${knownReplyIds.current}&around=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!mounted.current || version !== revision.current) return;
      if (!response.ok) throw Error("Could not load that reply. Try again.");
      if (!(data.replies as PublicChatMessage[] | undefined)?.some((row) => row.id === id && !row.removed)) {
        setError("That reply is no longer available.");
        return;
      }
      windowQuery.current = data.range ? `range=${data.range}` : "";
      setUnreadStart(null);
      setParent(data.parent);
      setReplies((current) =>
        mergeConfirmedMessages(
          current.filter((m) => m.removed || acknowledged.current.has(m.id)),
          data.replies,
        ),
      );
      setMore(!!data.hasMore);
      setHasNewer(!!data.hasNewer);
      answeredJump.current = id;
      setError("");
    } catch (e) {
      if (mounted.current && version === revision.current)
        setError(e instanceof Error ? e.message : "Could not load that reply.");
    } finally {
      if (mounted.current && busy === pageBusy.current) setPaging(false);
    }
  }
  useLayoutEffect(() => {
    const node = contents.current;
    if (
      !node ||
      !pinJump ||
      parent?.id !== pinJump.messageId ||
      parent.deleted_at ||
      parent.removed ||
      !notificationActive
    )
      return;
    let clear: (() => void) | undefined;
    const stop = watchChatPaneLayout(node, () => {
      if (clear) return;
      const target = node.querySelector<HTMLElement>('[aria-label="Original comment"]');
      if (target) {
        clear = revealPinnedMessage(node, target, pinJump.trigger);
        draft.scroll = node.scrollTop;
      }
    });
    return () => {
      stop();
      clear?.();
    };
  }, [pinJump, parent?.id, parent?.deleted_at, parent?.removed, notificationActive, draft]);
  // D-305: the reply being answered was deleted (or removed): back to replying to the original.
  const answeringGone =
    !!answeringShown && (!!answeringShown.removed || !!answeringShown.deleted_at);
  useEffect(() => {
    if (answeringGone) setAnswering(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeringGone]);
  useEffect(() => {
    if (isolated) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, isolated]);
  useRevealGroupedActions();
  function edited(message: PublicChatMessage) {
    revision.current++;
    pageBusy.current++;
    setPaging(false);
    if (acknowledged.current.has(message.id))
      acknowledged.current.set(message.id, { message, expires: Date.now() + 15000 });
    setParent((current) => (current?.id === message.id ? message : current));
    setReplies((current) =>
      mergeConfirmedMessages(current, [message]).filter((reply) => reply.id !== messageId),
    );
    if (message.removed && message.id === messageId) onBack();
    onSent(message);
    updates?.invalidate("room");
  }
  function actions(message: PublicChatMessage) {
    const own = message.member_id === memberId && !!memberId && !readOnly;
    const pin = canPinMessage(message, pinControls);
    return own || pin ? (
      <MessageActions
        message={message}
        room={room}
        own={own}
        admin={false}
        paused={paused}
        onEdited={edited}
        onDeleted={(_id, changed) => {
          if (changed) edited(changed);
        }}
        extra={pin && <MessagePinButton message={message} controls={pinControls} />}
      />
    ) : null;
  }
  // #318: a reply's actions match a room message's: Reply, the reaction button and ••• sit at the
  // top right and show on hover (computers). On touch screens the ••• menu also holds Reply.
  // #331: in a group of replies, the first has one Reply and one reaction button, for the group's
  // most recent reply. Every reply's ••• menu can still answer or react to that reply itself.
  function replyMeta(reply: PublicChatMessage, group: GroupActions, target?: PublicChatMessage) {
    const own = reply.member_id === memberId && !!memberId && !readOnly;
    const canAnswer = canReplyToReplies && !reply.deleted_at;
    const groupButtons = group.inGroup && group.head && !!target;
    const canReact = group.inGroup && !reply.deleted_at && !paused && !!memberId;
    const answer = () => {
      setAnswering({ id: reply.id, name: authorName(reply) });
      input.current?.focus({ preventScroll: true });
    };
    const copy = !reply.deleted_at && !!reply.body.trim();
    const pin = canPinMessage(reply, pinControls);
    return (
      <div className={`${styles.messageMeta} ${panelStyles.replyMeta}`}>
        {group.inGroup
          ? groupButtons &&
            canReplyToReplies && (
              <button
                type="button"
                className={`${styles.replyButton} ${panelStyles.replyOnReply}`}
                data-reply-on-reply
                data-group-reply
                aria-label={`Reply to ${authorName(target)}'s latest message`}
                aria-pressed={answering?.id === target.id}
                onClick={() => {
                  setAnswering({ id: target.id, name: authorName(target) });
                  input.current?.focus({ preventScroll: true });
                }}
              >
                ↳ Reply
              </button>
            )
          : canAnswer && (
              // D-305: every reply has Reply again; the answer joins this same list.
              <button
                type="button"
                className={`${styles.replyButton} ${panelStyles.replyOnReply}`}
                data-reply-on-reply
                aria-label={`Reply to ${authorName(reply)}`}
                aria-pressed={answering?.id === reply.id}
                onClick={answer}
              >
                ↳ Reply
              </button>
            )}
        <span data-dm-reaction-host>
          {groupButtons && (
            <MessageReactions
              target={{ kind: "room", room, messageId: target.id }}
              disabled={paused || !memberId}
              compact
              part="add"
            />
          )}
        </span>
        <MessageActions
          message={reply}
          room={room}
          own={own}
          admin={false}
          paused={paused}
          onEdited={edited}
          onDeleted={(_id, changed) => {
            if (changed) edited(changed);
          }}
          extra={
            canAnswer || copy || pin ? (
              <>
                {canAnswer && (
                  <button
                    type="button"
                    data-menu-reply
                    data-menu-always={group.inGroup || undefined}
                    onClick={answer}
                  >
                    <ChatIcon name="reply" />
                    {group.inGroup ? "Reply to this message" : "Reply"}
                  </button>
                )}
                {canReact && (
                  <button
                    type="button"
                    data-menu-react
                    onClick={(event) => openRowReactionPicker(event.currentTarget)}
                  >
                    <ChatIcon name="reaction" />
                    React to this message
                  </button>
                )}
                {copy && (
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(reply.body)}>
                    <ChatIcon name="copy" />
                    Copy text
                  </button>
                )}
                {pin && <MessagePinButton message={reply} controls={pinControls} />}
              </>
            ) : undefined
          }
        />
      </div>
    );
  }
  async function refreshSentWindow(intent: number) {
    const version = revision.current;
    try {
      const response = await fetch(
        `/api/chat/thread?room=${room}&messageId=${messageId}&ids=${knownReplyIds.current}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!mounted.current || intent !== navigationIntent.current) return;
      if (!response.ok || version !== revision.current)
        throw Error("Reply sent. The latest replies could not load. Use Show sent reply to retry.");
      windowQuery.current = "";
      following.current = true;
      scrollIntent.current = null;
      resumeLive.current = false;
      setUnreadStart(null);
      setHasNewer(false);
      setMore(!!data.hasMore);
      setParent(data.parent);
      setReplies((current) =>
        mergeConfirmedMessages(
          current.filter((row) => row.removed),
          data.replies,
        ),
      );
      pageTarget.current = "last";
      setSentWindowRetry(false);
      setError("");
    } catch (error) {
      if (mounted.current && intent === navigationIntent.current) {
        setSentWindowRetry(true);
        setError(error instanceof Error ? error.message : "Reply sent. Use Show sent reply to retry.");
      }
    }
  }
  async function transmit(item: PendingReply) {
    if (inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    const mobileSend = beginMobileSend(input.current, contents.current);
    const intent = navigationIntent.current;
    savePending((current) =>
      current.map((row) => (row.id === item.id ? { ...row, state: "sending", error: undefined } : row)),
    );
    try {
      await waitForAttachments(item.files);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          room,
          body: item.body,
          // D-305: a reply to a reply names that reply; the database keeps one level.
          replyTo: item.answering ?? messageId,
          attachmentIds: item.files,
          clientId: item.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.message || result.error || "Could not send reply.");
      if (!result.message?.id) throw Error("Could not confirm reply. Retry safely.");
      if (mounted.current) {
        revision.current++;
        pageBusy.current++;
        setPaging(false);
        setReplies((current) => {
          const existing = current.find((m) => m.id === result.message.id);
          const canonical =
            existing && (existing.revision ?? 0) > (result.message.revision ?? 0) ? existing : result.message;
          acknowledged.current.set(canonical.id, { message: canonical, expires: Date.now() + 15000 });
          return [...current.filter((m) => m.id !== canonical.id), canonical].sort((a, b) =>
            a.created_at.localeCompare(b.created_at),
          );
        });
        onSent(result.message);
        updates?.invalidate("room", "activity");
        if (windowQuery.current && intent === navigationIntent.current) void refreshSentWindow(intent);
        mobileSend.confirmed();
      }
      if (!mounted.current) mobileSend.cancel();
      savePending((current) => current.filter((row) => row.id !== item.id));
    } catch (e) {
      mobileSend.cancel();
      savePending((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, state: "failed", error: e instanceof Error ? e.message : "Could not send reply." }
            : row,
        ),
      );
    } finally {
      inFlight.current.delete(item.id);
    }
  }
  const canReplyToReplies = !!parent && !parent.reply_to_id && !readOnly && !!memberId;
  function send(event: FormEvent) {
    event.preventDefault();
    if (
      (!body.trim() && !uploads.ids.length) ||
      uploads.blocked ||
      sending.current ||
      paused ||
      readOnly ||
      !parent
    )
      return;
    if (pendingRef.current.length >= 20) {
      setError("Please retry your unsent replies before sending more.");
      return;
    }
    sending.current = true;
    const item: PendingReply = {
      id: crypto.randomUUID(),
      body: body.trim(),
      files: [...uploads.ids],
      names: uploads.files.map((file) => file.name),
      createdAt: new Date().toISOString(),
      state: "sending",
      ...(answering ? { answering: answering.id } : {}),
    };
    savePending((current) => [...current, item]);
    setAnswering(null);
    draft.body = "";
    setBody("");
    uploads.clear();
    setError("");
    // Release immediately after React accepts the captured draft. Network work
    // never disables the composer or restores an older draft over new typing.
    queueMicrotask(() => {
      sending.current = false;
    });
    if (
      !isolated ||
      (panel.current?.getClientRects().length &&
        panel.current.parentElement?.contains(document.activeElement))
    )
      input.current?.focus({ preventScroll: true });
    void transmit(item);
  }
  return (
    <aside
      ref={panel}
      className={styles.replyPanel}
      aria-label="Comment replies"
      onKeyDown={(event) => {
        if (document.querySelector("dialog[open]")) return;
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== "Tab" || !window.matchMedia("(max-width:1099px)").matches) return;
        const controls = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),textarea:not(:disabled),a[href],summary",
          ) ?? [],
        ).filter((control) => control.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header>
        <button
          type="button"
          onClick={onBack}
          aria-label={depth > 1 ? "Back to previous comment" : "Back to chat"}
          // On desktop the room stays beside the panel, so "← Chat" only repeats ×.
          className={depth > 1 ? undefined : panelStyles.phoneOnly}
        >
          ← {depth > 1 ? "Back" : "Chat"}
        </button>
        <h2>Replies</h2>
        <button type="button" onClick={onClose} aria-label="Close replies">
          ×
        </button>
      </header>
      <div
        ref={contents}
        onWheel={(event) => {
          cancelOpening();
          scrollIntent.current = chatPaneScrollIntent(event.currentTarget);
        }}
        onTouchStart={(event) => {
          if (chatScrollPointer(event.target, true)) {
            cancelOpening();
            scrollIntent.current = chatPaneScrollIntent(event.currentTarget, "touch");
          }
        }}
        onPointerDown={(event) => {
          if (chatScrollPointer(event.target))
            scrollIntent.current = chatPaneScrollIntent(event.currentTarget, "pointer");
        }}
        onKeyDown={(event) => {
          if (chatScrollKey(event.key, event.target)) {
            cancelOpening();
            scrollIntent.current = chatPaneScrollIntent(event.currentTarget);
          }
        }}
        className={styles.replyContents}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (!chatPaneVisible(node)) return;
          draft.scroll = node.scrollTop;
          const next = chatPaneFollowingScroll(node, following.current, scrollIntent.current);
          following.current = next.following;
          scrollIntent.current = next.intent;
          if (next.direction) {
            resumeLive.current = next.direction === "down" && next.following;
            if (resumeLive.current && windowQuery.current) updates?.invalidate("room");
          }
        }}
      >
        {!parent && !error && <p role="status">Loading conversation…</p>}
        {parent && (
          <article
            className={`${styles.replyOriginal} ${panelStyles.row}`}
            data-thread-message-id={parent.id}
            aria-label="Original comment"
          >
            {avatar(parent, authorName(parent))}
            <div className={styles.messageIdentity}>
              <strong>{authorName(parent)}</strong>
              <BotBadge memberships={parent.memberships} />
              <time dateTime={parent.created_at} title={chatTimestampTitle(parent.created_at)}>
                {chatTimestamp(parent.created_at)}
                {parent.edited_at && !parent.deleted_at ? " · edited" : ""}
              </time>
              {actions(parent)}
            </div>
            {!parent.deleted_at && isPollBody(parent.body) ? (
              <ChatPollCard
                room={room}
                messageId={parent.id}
                body={parent.body}
                disabled={paused || !memberId}
                fallback={
                  <p>
                    <MentionText text={parent.body} highlight={BUDDY} />
                  </p>
                }
              />
            ) : (
              <p className={parent.deleted_at ? styles.deletedMessage : undefined}>
                {parent.deleted_at ? "Message deleted" : <MentionText text={parent.body} highlight={BUDDY} />}
              </p>
            )}
            {!parent.deleted_at && (
              <>
                <ChatAttachments room={room} ids={parent.attachment_ids} media={parent.attachment_media} />
                <BuddyStatus status={parent.buddy_status} />
                <MessageReactions
                  target={{ kind: "room", room, messageId: parent.id }}
                  disabled={paused || !memberId}
                />
              </>
            )}
          </article>
        )}
        {error && <p role="alert">{error}</p>}
        {sentWindowRetry && (
          <button type="button" onClick={() => void refreshSentWindow(navigationIntent.current)}>
            Show sent reply
          </button>
        )}
        <div aria-live="polite" aria-label="Replies to this comment">
          {more && (
            <button type="button" disabled={paging} onClick={() => void pageReplies("before")}>
              Earlier replies
            </button>
          )}
          {parent && !parent.reply_to_id && !replies.some((reply) => !reply.removed) && !pending.length && (
            <p className={styles.threadEmpty}>
              <strong>No replies yet.</strong> Be the first to reply below.
            </p>
          )}
          {(() => {
            const shown = replies.filter((reply) => !reply.removed);
            // GROUP-REST (#318): the same person again within 5 minutes, with nothing between (no
            // unread marker), shares one name line; a "replying to" line starts a group.
            const continued = threadReplyGroups(shown, {
              unreadStart,
              startsGroup: (reply) => !!replyingTo(reply),
            });
            const groups = chatGroupActions(shown, continued, (reply) => !reply.deleted_at);
            return shown.map((reply, index) => {
              const replyLabel = replyingTo(reply),
                answeredGone = replyLabel === "replying to a deleted message";
              return (
              <article
                data-unread-start={unreadStart === reply.id || undefined}
                key={reply.id}
                data-thread-message-id={reply.id}
                data-continued={continued[index] || undefined}
                className={`${styles.threadReply} ${panelStyles.row} ${panelStyles.reply}`}
              >
                {unreadStart === reply.id && <UnreadStart />}
                {avatar(reply, authorName(reply))}
                <div className={styles.messageIdentity}>
                  <strong>{authorName(reply)}</strong>
                  <BotBadge memberships={reply.memberships} />
                  <time dateTime={reply.created_at} title={chatTimestampTitle(reply.created_at)}>
                    {chatTimestamp(reply.created_at)}
                    {reply.edited_at && !reply.deleted_at ? " · edited" : ""}
                  </time>
                </div>
                {replyMeta(reply, groups[index], shown.find((row) => row.id === groups[index].targetId))}
                {replyLabel && (
                  <button
                    type="button"
                    className={panelStyles.replyingTo}
                    data-replying-to
                    // D-305: jump to the reply this one answered (nothing to show once it is deleted).
                    disabled={answeredGone}
                    title={answeredGone ? undefined : "Show the reply this answers"}
                    onClick={() => {
                      const id = reply.answered_id ?? reply.answered?.id;
                      if (id) void jumpToAnswered(id);
                    }}
                  >
                    ↳ {replyLabel}
                  </button>
                )}
                {!reply.deleted_at && isPollBody(reply.body) ? (
                  <ChatPollCard
                    room={room}
                    messageId={reply.id}
                    body={reply.body}
                    disabled={paused || !memberId}
                    fallback={
                      <p>
                        <MentionText text={reply.body} highlight={BUDDY} />
                      </p>
                    }
                  />
                ) : (
                  <p className={reply.deleted_at ? styles.deletedMessage : undefined}>
                    {reply.deleted_at ? "Message deleted" : <MentionText text={reply.body} highlight={BUDDY} />}
                  </p>
                )}
                {!reply.deleted_at && (
                  <>
                    <ChatAttachments room={room} ids={reply.attachment_ids} media={reply.attachment_media} />
                    <BuddyStatus status={reply.buddy_status} />
                    {/* The add button sits in the top-right actions; only chips show here. */}
                    <MessageReactions
                      target={{ kind: "room", room, messageId: reply.id }}
                      disabled={paused || !memberId}
                      compact
                      part={groups[index].inGroup ? "chips" : "all"}
                    />
                  </>
                )}
              </article>
              );
            });
          })()}
          {hasNewer && (
            <button type="button" disabled={paging} onClick={() => void pageReplies("after")}>
              Newer replies
            </button>
          )}
          {pending.map((item) => (
            <article
              key={item.id}
              className={`${styles.threadReply} ${panelStyles.row} ${panelStyles.reply}`}
              data-send-state={item.state}
            >
              <span
                className={panelStyles.avatar}
                aria-hidden="true"
                style={{ background: chatAvatarColor(memberId ?? selfName ?? "Member") }}
              >
                {chatInitials(selfName ?? "Member")}
              </span>
              <div className={styles.messageIdentity}>
                <strong>{selfName ?? "Member"}</strong>
                <small role="status">{item.state === "sending" ? <SendingMark /> : "Not sent"}</small>
              </div>
              {item.answering && replyingTo({ answered_id: item.answering }) && (
                <div className={panelStyles.replyingTo} data-replying-to>
                  ↳ {replyingTo({ answered_id: item.answering })}
                </div>
              )}
              <p>
                <MentionText text={item.body} highlight={BUDDY} />
              </p>
              {item.names.length > 0 && <p>{item.names.join(", ")}</p>}
              {item.state === "failed" && (
                <>
                  <p role="alert">{item.error}</p>
                  <button
                    type="button"
                    disabled={paused || readOnly || !parent}
                    onClick={() => void transmit(item)}
                  >
                    Retry reply
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
        {readOnly && <p>Only admins can reply in this announcement channel.</p>}
        {/* #301: replies have no replies of their own; an old link to one leads to its conversation. */}
        {parent?.reply_to_id && (
          <button
            type="button"
            className={styles.replyButton}
            data-whole-conversation
            onClick={() => onOpen(parent.reply_to_id!)}
          >
            ↳ View the whole conversation
          </button>
        )}
        {parent && !readOnly && !parent.reply_to_id && (
          <form className={`${styles.composerWrap} ${styles.replyComposer}`} onSubmit={send}>
            {answering && answeringName && (
              <div className={panelStyles.composerAnswering} data-composer-replying-to>
                <span>
                  ↳ Replying to <strong>{answeringName}</strong>
                </span>
                <button
                  type="button"
                  aria-label={`Stop replying to ${answeringName}`}
                  onClick={() => {
                    setAnswering(null);
                    input.current?.focus({ preventScroll: true });
                  }}
                >
                  ×
                </button>
              </div>
            )}
            <AttachmentPicker uploads={uploads} disabled={paused || readOnly} />
            <div className={composerStyles.bar}>
              <GifComposer
                buttonClassName={composerStyles.add}
                disabled={paused || readOnly}
                extras={[
                  ...(body.trim() || uploads.files.length
                    ? [
                        {
                          key: "voice",
                          label: (
                            <>
                              <ChatIcon name="mic" /> Voice message
                            </>
                          ),
                          onSelect: () => voiceStart.current?.(),
                        },
                      ]
                    : []),
                  // #328: a poll in this thread.
                  ...(memberId ? [{ key: "poll", label: "📊 Poll", onSelect: () => setPollOpen(true) }] : []),
                ]}
                onAttach={() => uploads.input.current?.click()}
                onAdd={(url) => {
                  const next = [body.trim(), url].filter(Boolean).join("\n");
                  if (next.length > 600) return false;
                  draft.body = next;
                  setBody(next);
                  return true;
                }}
              />
              <div className={composerStyles.field}>
                <MentionTextarea
                  data-chat-composer
                  enabled={!!memberId && !paused && !readOnly}
                  buddyEnabled={room === "main"}
                  room={room}
                  className={composerStyles.input}
                  listClassName={styles.replyMentionList}
                  aria-label={`Reply to ${answeringName ?? authorName(parent)}`}
                  aria-describedby={`${inputId}-help`}
                  placeholder={`Reply to ${answeringName ?? authorName(parent)}…`}
                  onKeyDown={(event) => {
                    // D-305: Escape in an empty composer stops answering a reply before closing.
                    if (event.key === "Escape" && answering && !body) {
                      event.preventDefault();
                      event.stopPropagation();
                      setAnswering(null);
                      return;
                    }
                    if (
                      event.key !== "Enter" ||
                      event.shiftKey ||
                      event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229
                    )
                      return;
                    event.preventDefault();
                    if (!event.repeat && !sending.current) event.currentTarget.form?.requestSubmit();
                  }}
                  onPaste={uploads.paste}
                  id={inputId}
                  inputRef={input}
                  value={body}
                  onValue={(value) => {
                    draft.body = value;
                    setBody(value);
                  }}
                  maxLength={600}
                  rows={1}
                  disabled={paused || readOnly}
                />
                <ComposerSend
                  label="Send"
                  name="Send reply"
                  hidden={!body.trim() && !uploads.files.length}
                  disabled={paused || readOnly || uploads.blocked || (!body.trim() && !uploads.ids.length)}
                />
                <VoiceRecorder
                  key={parent.id}
                  uploads={uploads}
                  disabled={paused || readOnly}
                  micClassName={composerStyles.mic}
                  hideMic={Boolean(body.trim()) || uploads.files.length > 0}
                  startRef={voiceStart}
                />
              </div>
            </div>
            <ComposerLinkPreview body={body} />
            <small id={`${inputId}-help`} className={styles.enterHint}>
              Enter to send · Shift+Enter for a new line.
            </small>
            {paused && <p>Room paused. Replies are read-only.</p>}
          </form>
        )}
        {/* Mounted only while open, so its buttons stay out of the panel's focus loop. */}
        {parent && !readOnly && !parent.reply_to_id && memberId && pollOpen && (
          <ChatPollComposer
            room={room}
            replyTo={parent.id}
            open
            onClose={() => setPollOpen(false)}
            // Shown at once like a sent reply (see transmit), then the latest replies are read.
            onCreated={(message) => {
              revision.current++;
              acknowledged.current.set(message.id, { message, expires: Date.now() + 15000 });
              setReplies((current) =>
                mergeConfirmedMessages(current, [message]).sort((a, b) =>
                  a.created_at.localeCompare(b.created_at),
                ),
              );
              onSent(message);
              updates?.invalidate("room", "activity");
              if (windowQuery.current) void refreshSentWindow(navigationIntent.current);
            }}
          />
        )}
      </div>
    </aside>
  );
}
