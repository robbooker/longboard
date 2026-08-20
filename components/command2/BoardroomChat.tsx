"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Command2MenuUser } from "@/components/command2/Command2UserMenu";
import {
  tokenizeChatMessage,
  tradingViewSnapshotFromText,
  type TradingViewSnapshot,
} from "@/lib/boardroomChatLinks";
import {
  applyMention,
  findMentionQuery,
  tokenizeMentionText,
} from "@/lib/boardroomChatMentions";
import { hasPedroMention } from "@/lib/boardroomChatPedro";
import {
  mergeReaction,
  reactionSummary,
  restoreReaction,
  type BoardroomChatReaction,
} from "@/lib/boardroomChatReactions";
import { createClient } from "@/lib/supabase/client";
import styles from "./BoardroomChat.module.css";

type ChatMessage = {
  id: string;
  cohort: string;
  user_id: string;
  author_label: string;
  body: string;
  bot_slug: string | null;
  reply_to_id: string | null;
  created_at: string;
  pending?: boolean;
};

type ChatParticipant = {
  cohort: string;
  user_id: string;
  handle: string;
};

type ChatMention = {
  message_id: string;
  mentioned_user_id: string;
  cohort: string;
  created_at: string;
  read_at: string | null;
};

type MentionSuggestion = {
  userId: string | null;
  handle: string;
  label: string;
};

type SendState = "default" | "loading" | "error" | "success";
type ReactionActionState = "default" | "loading" | "error" | "success";
type ChatVariant = "rail" | "popout";
type PreviewVisualState = "default" | "hover" | "focus" | "active" | "disabled" | "loading" | "error" | "success";

const MAX_MESSAGE_LENGTH = 600;
const PREVIEW_VISUAL_STATES: PreviewVisualState[] = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
];

function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "NOW";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date) + " ET";
}

function emailLabel(email: string): string {
  return email.split("@")[0] || "MEMBER";
}

function mergeMessage(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (list.some((message) => message.id === incoming.id)) return list;
  return [...list, incoming].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ).slice(-80);
}

function mergeMention(list: ChatMention[], incoming: ChatMention): ChatMention[] {
  const withoutExisting = list.filter((mention) =>
    mention.message_id !== incoming.message_id
      || mention.mentioned_user_id !== incoming.mentioned_user_id
  );
  return [...withoutExisting, incoming].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ).slice(-120);
}

export function TradingViewSnapshotPreview({
  snapshot,
  previewState,
}: {
  snapshot: TradingViewSnapshot;
  previewState?: PreviewVisualState;
}) {
  const [imageState, setImageState] = useState<"loading" | "error" | "success">("loading");
  const state = previewState ?? imageState;
  const disabled = state === "disabled";

  return (
    <a
      className={styles.linkPreview}
      data-state={state}
      href={snapshot.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open TradingView chart ${snapshot.chartId} in a new tab`}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (event) => event.preventDefault() : undefined}
    >
      <span className={styles.previewFrame}>
        {/* TradingView chart-share snapshots are public images. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.previewImage}
          src={snapshot.imageUrl}
          alt="TradingView chart shared in Boardroom Chat"
          width="1200"
          height="675"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            if (!previewState) setImageState("success");
          }}
          onError={() => {
            if (!previewState) setImageState("error");
          }}
        />
        {state === "loading" ? (
          <span className={styles.previewNotice}>LOADING CHART…</span>
        ) : state === "error" ? (
          <span className={styles.previewNotice}>PREVIEW UNAVAILABLE · OPEN ↗</span>
        ) : null}
      </span>
      <span className={styles.previewMeta}>
        <span>TRADINGVIEW CHART</span>
        <span>OPEN ↗</span>
      </span>
    </a>
  );
}

export function TradingViewPreviewStateDemo({ snapshot }: { snapshot: TradingViewSnapshot }) {
  return (
    <div className={styles.previewTheme}>
      <section className={styles.panel} data-variant="preview" aria-label="TradingView link preview states">
        <div className={styles.previewStateGrid}>
          {PREVIEW_VISUAL_STATES.map((state) => (
            <div className={styles.previewStateRow} key={state}>
              <span className={styles.previewStateLabel}>{state}</span>
              <TradingViewSnapshotPreview snapshot={snapshot} previewState={state} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function PalmReactionButton({
  count,
  reacted,
  state = "default",
  onToggle,
}: {
  count: number;
  reacted: boolean;
  state?: PreviewVisualState;
  onToggle?: () => void;
}) {
  const disabled = state === "disabled" || state === "loading";
  const countLabel = `${count} palm tree ${count === 1 ? "like" : "likes"}`;
  const actionLabel = reacted
    ? `Remove your palm tree like. ${countLabel}.`
    : `Like this message with a palm tree. ${countLabel}.`;

  return (
    <button
      className={styles.reactionButton}
      type="button"
      data-state={state}
      aria-label={state === "loading" ? `Saving palm tree like. ${countLabel}.` : actionLabel}
      aria-pressed={reacted}
      aria-busy={state === "loading" || undefined}
      aria-invalid={state === "error" || undefined}
      disabled={disabled}
      title={reacted ? "Remove your palm tree" : "Add a palm tree"}
      onClick={onToggle}
    >
      <span className={styles.reactionPalm} aria-hidden="true">🌴</span>
      <span className={styles.reactionCount}>{count}</span>
      <span className={styles.reactionStateMark} aria-hidden="true">
        {state === "loading" ? "…" : state === "error" ? "×" : state === "success" ? "✓" : ""}
      </span>
    </button>
  );
}

export function PalmReactionStateDemo() {
  return (
    <div className={styles.previewTheme}>
      <section className={styles.panel} data-variant="preview" aria-label="Palm tree reaction states">
        <div className={styles.reactionPreview}>
          {PREVIEW_VISUAL_STATES.map((state, index) => (
            <div className={styles.reactionPreviewRow} key={state}>
              <span className={styles.previewStateLabel}>{state}</span>
              <PalmReactionButton
                count={index === 0 ? 0 : index}
                reacted={state === "active" || state === "success"}
                state={state}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MessageReaction({
  reactions,
  message,
  userId,
  state,
  onToggle,
}: {
  reactions: BoardroomChatReaction[];
  message: ChatMessage;
  userId: string;
  state: ReactionActionState;
  onToggle: () => void;
}) {
  const summary = reactionSummary(reactions, message.id, userId);
  const visualState: PreviewVisualState = message.pending ? "disabled" : state;

  return (
    <div className={styles.reactionBar}>
      <PalmReactionButton
        count={summary.count}
        reacted={summary.reacted}
        state={visualState}
        onToggle={onToggle}
      />
    </div>
  );
}

function MessageText({ value, handles }: { value: string; handles: Set<string> }) {
  return tokenizeMentionText(value).map((part, index) => {
    if (part.kind !== "mention" || !handles.has(part.handle)) {
      return <span key={`mention-text-${index}`}>{part.value}</span>;
    }

    return (
      <strong className={styles.mention} key={`mention-${part.handle}-${index}`}>
        {part.value}
      </strong>
    );
  });
}

function MessageBody({ body, handles }: { body: string; handles: Set<string> }) {
  const snapshot = tradingViewSnapshotFromText(body);
  const parts = tokenizeChatMessage(body);

  return (
    <div className={styles.bodyBlock}>
      <p className={styles.body}>
        {parts.map((part, index) => part.kind === "link" ? (
          <a
            className={styles.bodyLink}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            key={`${part.href}-${index}`}
          >
            {part.value}
          </a>
        ) : <MessageText value={part.value} handles={handles} key={`text-${index}`} />)}
      </p>
      {snapshot ? <TradingViewSnapshotPreview snapshot={snapshot} /> : null}
    </div>
  );
}

export default function BoardroomChat({
  user,
  variant = "rail",
}: {
  user: Command2MenuUser | null;
  variant?: ChatVariant;
}) {
  const cohort = user?.boardroomCohorts[0] ?? null;
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [reactions, setReactions] = useState<BoardroomChatReaction[]>([]);
  const [reactionStates, setReactionStates] = useState<Record<string, ReactionActionState>>({});
  const [body, setBody] = useState("");
  const [composerCursor, setComposerCursor] = useState(0);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [mentionMenuDismissed, setMentionMenuDismissed] = useState(false);
  const [loading, setLoading] = useState(Boolean(user && cohort));
  const [sendState, setSendState] = useState<SendState>("default");
  const [pedroState, setPedroState] = useState<SendState>("default");
  const [popoutState, setPopoutState] = useState<SendState>("default");
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pedroTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!user || !cohort) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    const userId = user.id;

    async function connect() {
      const messageRequest = supabase
        .from("boardroom_chat_messages")
        .select("id, cohort, user_id, author_label, body, bot_slug, reply_to_id, created_at")
        .eq("cohort", cohort)
        .order("created_at", { ascending: false })
        .limit(40);
      const participantRequest = supabase
        .from("boardroom_chat_participants")
        .select("cohort, user_id, handle")
        .eq("cohort", cohort)
        .order("handle", { ascending: true });
      const mentionRequest = supabase
        .from("boardroom_chat_mentions")
        .select("message_id, mentioned_user_id, cohort, created_at, read_at")
        .eq("mentioned_user_id", userId)
        .eq("cohort", cohort)
        .order("created_at", { ascending: false })
        .limit(120);

      const [messageResult, participantResult, mentionResult] = await Promise.all([
        messageRequest,
        participantRequest,
        mentionRequest,
      ]);

      if (cancelled) return;
      if (messageResult.error) {
        setError("Chat history did not load. Refresh the page to try again.");
        setLoading(false);
        return;
      }

      const loadedMessages = ((messageResult.data ?? []) as ChatMessage[]).reverse();
      const messageIds = loadedMessages.map((message) => message.id);
      const reactionRequest = messageIds.length > 0
        ? supabase
          .from("boardroom_chat_reactions")
          .select("message_id, user_id, cohort, active, created_at, updated_at")
          .eq("cohort", cohort)
          .in("message_id", messageIds)
        : Promise.resolve({ data: [], error: null });

      const reactionResult = await reactionRequest;

      if (cancelled) return;
      setMessages(loadedMessages);
      if (participantResult.error || mentionResult.error || reactionResult.error) {
        setError("Chat loaded, but mentions or palm likes are temporarily unavailable.");
      } else {
        setParticipants((participantResult.data ?? []) as ChatParticipant[]);
        setMentions(((mentionResult.data ?? []) as ChatMention[]).reverse());
        setReactions((reactionResult.data ?? []) as BoardroomChatReaction[]);
      }
      setLoading(false);

      channel = supabase
        .channel(`boardroom-chat-${cohort}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "boardroom_chat_messages",
            filter: `cohort=eq.${cohort}`,
          },
          (payload) => {
            setMessages((current) => mergeMessage(current, payload.new as ChatMessage));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "boardroom_chat_mentions",
            filter: `mentioned_user_id=eq.${userId}`,
          },
          (payload) => {
            const incoming = payload.new as ChatMention;
            if (incoming?.cohort === cohort) {
              setMentions((current) => mergeMention(current, incoming));
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "boardroom_chat_reactions",
            filter: `cohort=eq.${cohort}`,
          },
          (payload) => {
            const incoming = payload.new as BoardroomChatReaction;
            if (incoming?.cohort === cohort) {
              setReactions((current) => mergeReaction(current, incoming));
            }
          }
        )
        .subscribe();
    }

    void connect();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [cohort, supabase, user]);

  const currentHandle = participants.find((participant) => participant.user_id === user?.id)?.handle
    ?? (user ? emailLabel(user.email).toLowerCase() : "member");
  const mentionHandles = useMemo(
    () => new Set(["pedrobot", ...participants.map((participant) => participant.handle)]),
    [participants],
  );
  const mentionedMessageIds = useMemo(
    () => new Set(mentions.map((mention) => mention.message_id)),
    [mentions],
  );
  const unreadMentions = useMemo(
    () => mentions.filter((mention) => !mention.read_at),
    [mentions],
  );
  const mentionQuery = useMemo(
    () => findMentionQuery(body, composerCursor),
    [body, composerCursor],
  );
  const mentionSuggestions = useMemo<MentionSuggestion[]>(() => {
    if (!mentionQuery) return [];
    const query = mentionQuery.query;
    return [
      { userId: null, handle: "pedrobot", label: "CALL PEDRO" },
      ...participants
        .filter((participant) => participant.user_id !== user?.id)
        .map((participant) => ({
          userId: participant.user_id,
          handle: participant.handle,
          label: "BOARDROOM MEMBER",
        })),
    ]
      .filter((suggestion) => suggestion.handle.startsWith(query))
      .slice(0, 6);
  }, [mentionQuery, participants, user?.id]);
  const mentionMenuOpen = Boolean(
    mentionQuery && mentionSuggestions.length > 0 && !mentionMenuDismissed
  );

  useEffect(() => {
    setActiveSuggestion(0);
  }, [mentionQuery?.query]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (pedroTimerRef.current) clearTimeout(pedroTimerRef.current);
    if (popoutTimerRef.current) clearTimeout(popoutTimerRef.current);
    reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
    reactionTimersRef.current.clear();
  }, []);

  function setTemporaryReactionState(
    messageId: string,
    state: ReactionActionState,
    resetAfter?: number,
  ) {
    const existingTimer = reactionTimersRef.current.get(messageId);
    if (existingTimer) clearTimeout(existingTimer);

    setReactionStates((current) => ({ ...current, [messageId]: state }));
    if (!resetAfter) return;

    const timer = setTimeout(() => {
      setReactionStates((current) => ({ ...current, [messageId]: "default" }));
      reactionTimersRef.current.delete(messageId);
    }, resetAfter);
    reactionTimersRef.current.set(messageId, timer);
  }

  async function togglePalmReaction(message: ChatMessage) {
    if (!user || !cohort || message.pending || reactionStates[message.id] === "loading") return;

    const previous = reactions.find((reaction) =>
      reaction.message_id === message.id && reaction.user_id === user.id
    );
    const nextActive = !previous?.active;
    const now = new Date().toISOString();
    const optimistic: BoardroomChatReaction = {
      message_id: message.id,
      user_id: user.id,
      cohort,
      active: nextActive,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    };

    setReactions((current) => mergeReaction(current, optimistic));
    setTemporaryReactionState(message.id, "loading");
    setError("");

    const request = previous
      ? supabase
        .from("boardroom_chat_reactions")
        .update({ active: nextActive })
        .eq("message_id", message.id)
        .eq("user_id", user.id)
      : supabase
        .from("boardroom_chat_reactions")
        .insert({ message_id: message.id, user_id: user.id, cohort, active: nextActive });

    const { data, error: reactionError } = await request
      .select("message_id, user_id, cohort, active, created_at, updated_at")
      .single();

    if (reactionError || !data) {
      setReactions((current) => restoreReaction(current, message.id, user.id, previous));
      setTemporaryReactionState(message.id, "error", 3200);
      setError("Your palm tree was not saved. Check your connection and try again.");
      return;
    }

    setReactions((current) => mergeReaction(current, data as BoardroomChatReaction));
    setTemporaryReactionState(message.id, "success", 1200);
  }

  function selectMention(suggestion: MentionSuggestion) {
    if (!mentionQuery) return;

    const next = applyMention(body, mentionQuery, suggestion.handle);
    setBody(next.value);
    setComposerCursor(next.cursor);
    setMentionMenuDismissed(true);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function reviewUnreadMentions() {
    if (!user || !cohort || unreadMentions.length === 0) return;

    const firstUnread = unreadMentions[0];
    const messageNode = messagesRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${firstUnread.message_id}"]`,
    );
    messageNode?.scrollIntoView({ block: "center", behavior: "smooth" });

    const readAt = new Date().toISOString();
    const previous = mentions;
    setMentions((current) => current.map((mention) =>
      mention.read_at ? mention : { ...mention, read_at: readAt }
    ));

    const { error: updateError } = await supabase
      .from("boardroom_chat_mentions")
      .update({ read_at: readAt })
      .eq("mentioned_user_id", user.id)
      .eq("cohort", cohort)
      .is("read_at", null);

    if (updateError) {
      setMentions(previous);
      setError("Your mentions could not be marked read. Try again in a moment.");
    }
  }

  function openPopout() {
    if (popoutState === "loading") return;

    setPopoutState("loading");
    const popupWidth = Math.min(440, Math.max(320, window.screen.availWidth - 32));
    const popupHeight = Math.min(760, Math.max(540, window.screen.availHeight - 48));
    const popupLeft = Math.max(0, window.screenX + window.outerWidth - popupWidth - 24);
    const popupTop = Math.max(0, window.screenY + 40);
    const url = new URL("/command2/chat", window.location.origin);
    const opened = window.open(
      url.toString(),
      "longboard-boardroom-chat",
      [
        "popup=yes",
        `width=${popupWidth}`,
        `height=${popupHeight}`,
        `left=${popupLeft}`,
        `top=${popupTop}`,
        "menubar=no",
        "toolbar=no",
        "location=no",
        "status=no",
        "resizable=yes",
        "scrollbars=yes",
      ].join(","),
    );

    if (!opened) {
      setPopoutState("error");
      popoutTimerRef.current = setTimeout(() => setPopoutState("default"), 3200);
      return;
    }

    opened.opener = null;
    opened.focus();
    setPopoutState("success");
    popoutTimerRef.current = setTimeout(() => setPopoutState("default"), 1800);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !cohort || sendState === "loading" || pedroState === "loading") return;

    const nextBody = body.trim();
    if (!nextBody) {
      setError("Write a message before sending it.");
      setSendState("error");
      return;
    }
    if (nextBody.length > MAX_MESSAGE_LENGTH) {
      setError(`Keep the message under ${MAX_MESSAGE_LENGTH} characters.`);
      setSendState("error");
      return;
    }

    const optimisticId = `pending-${crypto.randomUUID()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      cohort,
      user_id: user.id,
      author_label: currentHandle,
      body: nextBody,
      bot_slug: null,
      reply_to_id: null,
      created_at: new Date().toISOString(),
      pending: true,
    };

    setMessages((current) => [...current, optimistic]);
    setBody("");
    setError("");
    setSendState("loading");

    const { data, error: sendError } = await supabase
      .from("boardroom_chat_messages")
      .insert({ cohort, user_id: user.id, author_label: "", body: nextBody })
      .select("id, cohort, user_id, author_label, body, bot_slug, reply_to_id, created_at")
      .single();

    if (sendError || !data) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setBody(nextBody);
      setError("That message was not sent. Check your connection and try again.");
      setSendState("error");
      return;
    }

    const sentMessage = data as ChatMessage;
    setMessages((current) => mergeMessage(
      current.filter((message) => message.id !== optimisticId),
      sentMessage
    ));
    setSendState("success");
    successTimerRef.current = setTimeout(() => setSendState("default"), 1600);

    if (!hasPedroMention(nextBody)) return;

    setPedroState("loading");
    try {
      const response = await fetch("/api/command2/chat/pedro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: sentMessage.id }),
      });
      const reply = await response.json().catch(() => null) as ChatMessage | null;
      if (!response.ok || !reply?.id) throw new Error("pedro_failed");

      setMessages((current) => mergeMessage(current, reply));
      setPedroState("success");
      pedroTimerRef.current = setTimeout(() => setPedroState("default"), 1800);
    } catch {
      setError("Your message was sent, but Pedro could not answer. Mention @pedrobot again to retry.");
      setPedroState("error");
    }
  }

  const feedback = error
    || (pedroState === "loading"
      ? "Pedro is thinking…"
      : pedroState === "success"
        ? "Pedro answered the room."
        : sendState === "success"
          ? "Message sent."
          : `${body.length} / ${MAX_MESSAGE_LENGTH} · TYPE @ TO MENTION`);

  return (
    <section className={styles.panel} data-variant={variant} aria-label="Boardroom Chat">
      <div className={styles.header}>
        <span>● BOARDROOM CHAT</span>
        <div className={styles.headerActions}>
          {unreadMentions.length > 0 ? (
            <button
              className={styles.mentionBadge}
              type="button"
              aria-label={`${unreadMentions.length} unread ${unreadMentions.length === 1 ? "mention" : "mentions"}. Review and mark read.`}
              onClick={() => void reviewUnreadMentions()}
            >
              @{unreadMentions.length}
            </button>
          ) : null}
          <span className={styles.status} data-connected={Boolean(user && cohort)}>
            {user && cohort ? "REAL-TIME" : "MEMBERS ONLY"}
          </span>
          {variant === "rail" ? (
            <button
              className={styles.popout}
              type="button"
              data-state={popoutState}
              disabled={popoutState === "loading"}
              aria-live="polite"
              aria-label={popoutState === "error"
                ? "Popout blocked. Allow popups and try again."
                : "Pop out Boardroom Chat into a compact browser window"}
              title={popoutState === "error"
                ? "Your browser blocked the chat window. Allow popups and try again."
                : "Open chat in a compact window"}
              onClick={openPopout}
            >
              {popoutState === "loading"
                ? "OPENING"
                : popoutState === "error"
                  ? "BLOCKED"
                  : popoutState === "success"
                    ? "OPENED ✓"
                    : "POP OUT ↗"}
            </button>
          ) : null}
        </div>
      </div>

      {!user ? (
        <div className={styles.gate}>
          <strong>The room is for Boardroom members.</strong>
          <span>Sign in with your Longboard account to join.</span>
          <Link className={styles.signIn} href="/login">SIGN IN</Link>
        </div>
      ) : !cohort ? (
        <div className={styles.gate}>
          <strong>Boardroom membership required.</strong>
          <span>Your account does not have a Boardroom cohort yet.</span>
        </div>
      ) : (
        <>
          <div ref={messagesRef} className={styles.messages} aria-live="polite" aria-busy={loading}>
            {loading ? (
              <div className={styles.loading}>Loading the room…</div>
            ) : messages.length === 0 ? (
              <div className={styles.empty}>
                <strong>No messages yet.</strong>
                <span>Start the Boardroom conversation below.</span>
              </div>
            ) : messages.map((message) => (
              <article
                key={message.id}
                className={styles.message}
                data-bot={message.bot_slug || undefined}
                data-message-id={message.id}
                data-mentioned={mentionedMessageIds.has(message.id) || undefined}
                data-pending={message.pending || undefined}
              >
                <span className={styles.author}>
                  {message.bot_slug === "pedrobot"
                    ? "@PEDROBOT"
                    : message.user_id === user.id
                      ? "YOU"
                      : message.author_label}
                </span>
                <time className={styles.time} dateTime={message.created_at}>
                  {message.pending ? "SENDING" : formatChatTime(message.created_at)}
                </time>
                <MessageBody body={message.body} handles={mentionHandles} />
                <MessageReaction
                  reactions={reactions}
                  message={message}
                  userId={user.id}
                  state={reactionStates[message.id] ?? "default"}
                  onToggle={() => void togglePalmReaction(message)}
                />
              </article>
            ))}
          </div>

          <form className={styles.composerWrap} onSubmit={sendMessage}>
            {mentionMenuOpen ? (
              <div
                id="boardroom-chat-mention-list"
                className={styles.mentionMenu}
                role="listbox"
                aria-label="Boardroom members"
              >
                {mentionSuggestions.map((suggestion, index) => (
                  <button
                    id={`boardroom-chat-mention-${index}`}
                    className={styles.mentionOption}
                    type="button"
                    role="option"
                    aria-selected={index === activeSuggestion}
                    data-active={index === activeSuggestion || undefined}
                    key={`${suggestion.userId ?? "bot"}-${suggestion.handle}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    onClick={() => selectMention(suggestion)}
                  >
                    <span>@{suggestion.handle}</span>
                    <small>{suggestion.label}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.composerRow}>
              <textarea
                ref={composerRef}
                className={styles.composer}
                value={body}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={2}
                aria-label="Message Boardroom Chat"
                aria-describedby="boardroom-chat-feedback"
                aria-invalid={sendState === "error"}
                aria-autocomplete="list"
                aria-controls={mentionMenuOpen ? "boardroom-chat-mention-list" : undefined}
                aria-activedescendant={mentionMenuOpen
                  ? `boardroom-chat-mention-${activeSuggestion}`
                  : undefined}
                disabled={sendState === "loading"}
                placeholder="Write to the Boardroom…"
                onChange={(event) => {
                  setBody(event.target.value);
                  setComposerCursor(event.target.selectionStart);
                  setMentionMenuDismissed(false);
                  if (sendState === "error" || pedroState === "error") {
                    setError("");
                    setSendState("default");
                    setPedroState("default");
                  }
                }}
                onKeyDown={(event) => {
                  if (mentionMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                    event.preventDefault();
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    setActiveSuggestion((current) =>
                      (current + direction + mentionSuggestions.length) % mentionSuggestions.length
                    );
                    return;
                  }
                  if (mentionMenuOpen && (event.key === "Enter" || event.key === "Tab")) {
                    event.preventDefault();
                    selectMention(mentionSuggestions[activeSuggestion]);
                    return;
                  }
                  if (mentionMenuOpen && event.key === "Escape") {
                    event.preventDefault();
                    setMentionMenuDismissed(true);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                onClick={(event) => setComposerCursor(event.currentTarget.selectionStart)}
                onSelect={(event) => setComposerCursor(event.currentTarget.selectionStart)}
              />
              <button
                className={styles.send}
                type="submit"
                data-state={pedroState === "loading" ? "loading" : sendState}
                disabled={!body.trim() || sendState === "loading" || pedroState === "loading"}
              >
                {pedroState === "loading"
                  ? "PEDRO…"
                  : sendState === "loading"
                    ? "SENDING"
                    : sendState === "success"
                      ? "SENT ✓"
                      : "SEND"}
              </button>
            </div>
            <div
              id="boardroom-chat-feedback"
              className={styles.feedback}
              data-tone={error || pedroState === "error" ? "error" : "neutral"}
              aria-live="polite"
            >
              {feedback}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
