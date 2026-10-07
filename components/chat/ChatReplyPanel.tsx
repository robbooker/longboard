"use client";
import UnreadStart from "./UnreadStart";
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
import MembershipBadges from "./MembershipBadges";
import { beginMobileSend } from "@/lib/chatMobileSend";
import { useChatRefreshGuard } from "./hooks/useChatRefreshGuard";
import VoiceRecorder from "./VoiceRecorder";
import BuddyStatus from "./BuddyStatus";
import { chatTimestamp, chatTimestampTitle } from "@/lib/chatTimestamp";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { mergeConfirmedMessages } from "@/lib/chatPendingMessages";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { AttachmentPicker, ChatAttachments } from "./ChatAttachments";
import MentionTextarea from "./MentionTextarea";
import MessageReactions from "./MessageReactions";
import MessageActions from "./MessageActions";
import { MessagePinButton, type MessagePinControls } from "./RoomMessagePins";
import { useChatUpdates, useChatNameLabel, useChatSelfName } from "./ChatUpdates";
import { useAttachments } from "./hooks/useAttachments";
import { useReplyCounts } from "./hooks/useReplyCounts";
import styles from "./PublicChat.module.css";
type PendingReply = {
  id: string;
  body: string;
  files: string[];
  names: string[];
  createdAt: string;
  state: "sending" | "failed";
  error?: string;
};
export type ReplyDraft = { body: string; scroll: number; pending?: PendingReply[] };
export default function ChatReplyPanel({
  openingUnread,
  onUnreadVisible,
  onSkipLatest,
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
  onUnreadVisible?: (through: number) => void;
  onSkipLatest?: () => void;
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
  const authorName = (message: PublicChatMessage) =>
    !message.bot_slug && !!memberId && message.member_id === memberId
      ? (selfName ?? message.author_label)
      : nameLabel(message.bot_slug ? null : message.member_id, message.author_label);
  const generatedId = useId();
  const inputId = isolated ? `reply-${generatedId}` : "thread-reply";
  const [parent, setParent] = useState<PublicChatMessage | null>(null),
    [replies, setReplies] = useState<PublicChatMessage[]>([]),
    [body, setBody] = useState(draft.body),
    [error, setError] = useState(""),
    [more, setMore] = useState(false);
  const replyCounts = useReplyCounts(
    room,
    replies
      .filter((reply) => !reply.pending && !reply.removed)
      .map((reply) => reply.id)
      .join(","),
    undefined,
    { memberId, threadId: messageId },
  );
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
  const panel = useRef<HTMLElement>(null);
  const contents = useRef<HTMLDivElement>(null);
  const openedFromPin = useRef(!!pinJump),
    currentPin = useRef(pinJump);
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
            let snapshot = openingUnread;
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
          !currentPin.current
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
    const stop = updates?.watch(load, ["room"], true);
    if (!updates) void load();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [messageId, room, updates, memberId, savePending, openingUnread]);
  useEffect(() => {
    if (!parent?.id || openedFromPin.current || openingUnread) return;
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
            node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top;
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
  useEffect(() => {
    if (isolated) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, isolated]);
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
    return (
      <>
        {message.member_id === memberId && !!memberId && !readOnly ? (
          <MessageActions
            message={message}
            room={room}
            own
            admin={false}
            paused={paused}
            onEdited={edited}
            onDeleted={(_id, changed) => {
              if (changed) edited(changed);
            }}
          />
        ) : null}
        <MessagePinButton message={message} controls={pinControls} />
      </>
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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          room,
          body: item.body,
          replyTo: messageId,
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
    };
    savePending((current) => [...current, item]);
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
        >
          ← {depth > 1 ? "Back" : "Chat"}
        </button>
        <h2>Replies</h2>
        {onSkipLatest && (
          <button
            type="button"
            aria-label="Skip to latest room message"
            title="Skip to latest room message"
            onClick={onSkipLatest}
          >
            ↓
          </button>
        )}
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
            className={styles.replyOriginal}
            data-thread-message-id={parent.id}
            aria-label="Original comment"
          >
            <div className={styles.messageIdentity}>
              <strong>{authorName(parent)}</strong>
              <MembershipBadges memberships={parent.bot_slug ? [] : parent.memberships} />
              <time dateTime={parent.created_at} title={chatTimestampTitle(parent.created_at)}>
                {chatTimestamp(parent.created_at)}
                {parent.edited_at && !parent.deleted_at ? " · edited" : ""}
              </time>
              {actions(parent)}
            </div>
            <p className={parent.deleted_at ? styles.deletedMessage : undefined}>
              {parent.deleted_at ? "Message deleted" : parent.body}
            </p>
            {!parent.deleted_at && (
              <>
                <ChatAttachments room={room} ids={parent.attachment_ids} />
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
          {parent && !replies.some((reply) => !reply.removed) && !pending.length && <p>No replies yet.</p>}
          {replies
            .filter((reply) => !reply.removed)
            .map((reply) => (
              <article
                data-unread-start={unreadStart === reply.id || undefined}
                key={reply.id}
                data-thread-message-id={reply.id}
                className={styles.threadReply}
              >
                {unreadStart === reply.id && <UnreadStart />}
                <div className={styles.messageIdentity}>
                  <strong>{authorName(reply)}</strong>
                  <MembershipBadges memberships={reply.bot_slug ? [] : reply.memberships} />
                  <time dateTime={reply.created_at} title={chatTimestampTitle(reply.created_at)}>
                    {chatTimestamp(reply.created_at)}
                    {reply.edited_at && !reply.deleted_at ? " · edited" : ""}
                  </time>
                  {actions(reply)}
                </div>
                <p className={reply.deleted_at ? styles.deletedMessage : undefined}>
                  {reply.deleted_at ? "Message deleted" : reply.body}
                </p>
                {!reply.deleted_at && (
                  <>
                    <ChatAttachments room={room} ids={reply.attachment_ids} />
                    <BuddyStatus status={reply.buddy_status} />
                    <MessageReactions
                      target={{ kind: "room", room, messageId: reply.id }}
                      disabled={paused || !memberId}
                    />
                  </>
                )}
                <button
                  type="button"
                  className={styles.replyButton}
                  data-has-replies={(replyCounts[reply.id] ?? 0) > 0}
                  onClick={() => onOpen(reply.id)}
                >
                  ↳{" "}
                  {replyCounts[reply.id]
                    ? `${replyCounts[reply.id]} ${replyCounts[reply.id] === 1 ? "reply" : "replies"}`
                    : "Reply"}
                </button>
              </article>
            ))}
          {hasNewer && (
            <button type="button" disabled={paging} onClick={() => void pageReplies("after")}>
              Newer replies
            </button>
          )}
          {pending.map((item) => (
            <article key={item.id} className={styles.threadReply} data-send-state={item.state}>
              <div className={styles.messageIdentity}>
                <strong>{selfName ?? "Member"}</strong>
                <small role="status">{item.state === "sending" ? "Sending…" : "Not sent"}</small>
              </div>
              <p>{item.body}</p>
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
        {parent && !readOnly && (
          <form onSubmit={send}>
            <label htmlFor={inputId}>Reply to {authorName(parent)}</label>
            <AttachmentPicker uploads={uploads} disabled={paused || readOnly} />
            <MentionTextarea
              data-chat-composer
              enabled={!!memberId && !paused && !readOnly}
              buddyEnabled={room === "main"}
              listClassName={styles.replyMentionList}
              aria-describedby={`${inputId}-help`}
              onKeyDown={(event) => {
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
              rows={3}
              disabled={paused || readOnly}
            />
            <ComposerLinkPreview body={body} />
            <VoiceRecorder key={parent.id} uploads={uploads} disabled={paused || readOnly} />
            <button
              type="button"
              disabled={paused || readOnly}
              onClick={() => uploads.input.current?.click()}
            >
              📎 Attach file
            </button>
            <button
              className={styles.primaryButton}
              disabled={paused || readOnly || uploads.blocked || (!body.trim() && !uploads.ids.length)}
            >
              Send reply
            </button>
            <small id={`${inputId}-help`}>Enter to send · Shift+Enter for a new line.</small>
            {paused && <p>Room paused. Replies are read-only.</p>}
          </form>
        )}
      </div>
    </aside>
  );
}
