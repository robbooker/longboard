"use client";

import Link from "next/link";
import ChatHeaderMenu from "./ChatHeaderMenu";
import MentionTextarea from "./MentionTextarea";
import { splitMemberMentions } from "@/lib/publicChatMentions";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  CHAT_ROOMS,
  type ChatRoom,
  countChatters,
  mergeMessage,
  mergeReaction,
  reactionSummary,
  tokenizeChatMessage,
  tradingViewSnapshotFromText,
  type PublicChatMessage,
  type PublicChatReaction,
  type PublicChatRoomState,
  type TradingViewSnapshot,
} from "@/lib/publicChat";
import styles from "./PublicChat.module.css";
import DirectInbox from "./DirectInbox";
import { ChatGif, GifComposer } from "./ChatGif";
import { chatGifFromText, chatGifFromUrl } from "@/lib/chatGifs";
import ChatReportReview from "./ChatReportReview";
import type { ChatMember } from "@/lib/chatDirectMessages";

const GUEST_TOKEN_KEY = "longboard-public-chat-guest-token-v1";
const GUEST_NAME_KEY = "longboard-public-chat-display-name-v1";
const CHAT_THEME_KEY = "longboard-public-chat-theme-v1";
const MAX_MESSAGE_LENGTH = 600;

type IdentityStatus = "checking" | "name" | "ready";
type ActionState = "default" | "loading" | "error" | "success";
type ChatTheme = "dark" | "light" | "blade-runner";
const CHAT_THEMES: Array<{ value: ChatTheme; label: string; icon: string }> = [
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "light", label: "Light", icon: "☀" },
  { value: "blade-runner", label: "Blade Runner", icon: "🤖" },
];

type GuestResponse = {
  guestId?: string;
  displayName?: string;
  message?: PublicChatMessage | string;
  reaction?: PublicChatReaction;
  room?: PublicChatRoomState;
  buddyError?: string;
  error?: string;
};

type AdminSummary = {
  id: string;
  summary_date: string;
  message_count: number;
  model: string;
  summary_text: string;
  updated_at: string;
};

type AdminResponse = {
  isOwner?: boolean;
  room?: PublicChatRoomState;
  summaries?: AdminSummary[];
  result?: { status?: string; summary?: AdminSummary };
  error?: string;
};

function chatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "NOW";
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)} ET`;
}

async function invokeGuest(body: Record<string, unknown>): Promise<GuestResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as GuestResponse;
  if (response.ok) return result;
  if (result.error === "chat_paused") throw new Error("Chat is temporarily paused. History remains available below.");
  throw new Error(typeof result.message === "string" ? result.message : "The chat service did not respond. Try again.");
}

async function fetchRoomStatus(room: ChatRoom) {
  const response = await fetch(`/api/chat?room=${room}`, { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as PublicChatRoomState & { error?: string };
  if (!response.ok || typeof result.isOpen !== "boolean") throw new Error("chat_status_unavailable");
  return result;
}

async function invokeAdmin(room: ChatRoom, body?: Record<string, unknown>): Promise<AdminResponse> {
  const response = await fetch(`/api/chat/admin?room=${room}`, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as AdminResponse;
  if (response.ok) return result;
  throw new Error(result.error || "The chat admin service did not respond.");
}

function TradingViewPreview({ snapshot }: { snapshot: TradingViewSnapshot }) {
  const [state, setState] = useState<"loading" | "error" | "success">("loading");
  return (
    <a
      className={styles.preview}
      href={snapshot.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open TradingView chart ${snapshot.chartId} in a new tab`}
    >
      <span className={styles.previewFrame}>
        {/* TradingView chart-share snapshots are public images. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.previewImage}
          src={snapshot.imageUrl}
          alt="TradingView chart shared in Longboard Chat"
          width="1200"
          height="675"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState("success")}
          onError={() => setState("error")}
        />
        {state !== "success" ? (
          <span className={styles.previewNotice}>
            {state === "loading" ? "LOADING CHART…" : "PREVIEW UNAVAILABLE · OPEN ↗"}
          </span>
        ) : null}
      </span>
      <span className={styles.previewMeta}>
        <span>TRADINGVIEW CHART</span>
        <span>OPEN ↗</span>
      </span>
    </a>
  );
}

function MessageBody({ body, names }: { body: string; names: string[] }) {
  const snapshot = tradingViewSnapshotFromText(body);
  const gif = chatGifFromText(body);
  return (
    <div className={styles.bodyBlock}>
      <p className={styles.body}>
        {tokenizeChatMessage(body).map((part, index) => part.kind === "link" ? (
          <a
            className={styles.bodyLink}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            key={`${part.href}-${index}`}
          >
            {gif && chatGifFromUrl(part.href)?.id === gif.id ? "GIF ↗" : part.value}
          </a>
        ) : <span key={`text-${index}`}>{splitMemberMentions(part.value, names).map((piece, i) => piece.mention ? <mark className={styles.mention} key={i}>{piece.text}</mark> : piece.text)}</span>)}
      </p>
      {snapshot ? <TradingViewPreview snapshot={snapshot} /> : null}
      {gif ? <ChatGif key={gif.id} gif={gif} /> : null}
    </div>
  );
}

export default function PublicChat({ room, popout, fontVariableClass }: { room: ChatRoom; popout: boolean; fontVariableClass: string }) {
  const roomLabel = room === "main" ? "Main" : "Social";
  const roomHref = (slug: ChatRoom) => `/chat?room=${slug}${popout ? "&popout=1" : ""}`;
  const loginHref = `/login?next=${encodeURIComponent(roomHref(room))}`;
  const supabase = useMemo(() => createClient(), []);
  const [theme, setTheme] = useState<ChatTheme>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [member, setMember] = useState<ChatMember | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [dmTarget, setDmTarget] = useState<{ id: string; name: string } | null>(null);
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>("checking");
  const [guestId, setGuestId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [chatterCount, setChatterCount] = useState(0);
  const [presenceReady, setPresenceReady] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [messages, setMessages] = useState<PublicChatMessage[]>([]);
  const [reactions, setReactions] = useState<PublicChatReaction[]>([]);
  const [body, setBody] = useState("");
  useEffect(() => { setBody(window.sessionStorage.getItem(`longboard-chat-draft-${room}`) ?? ""); }, [room]);
  const [loading, setLoading] = useState(false);
  const [nameState, setNameState] = useState<ActionState>("default");
  const [sendState, setSendState] = useState<ActionState>("default");
  const [popoutState, setPopoutState] = useState<ActionState>("default");
  const [reactionStates, setReactionStates] = useState<Record<string, ActionState>>({});
  const [roomStatus, setRoomStatus] = useState<PublicChatRoomState | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminState, setAdminState] = useState<ActionState>("default");
  const [adminAction, setAdminAction] = useState<"room" | "summary" | null>(null);
  const [adminFeedback, setAdminFeedback] = useState("");
  const [adminReason, setAdminReason] = useState("");
  const [summaries, setSummaries] = useState<AdminSummary[]>([]);
  const [error, setError] = useState("");
  const mentionNames = useMemo(() => [...new Set(["Buddy", ...(member ? [member.display_name] : []), ...messages.filter(message => message.member_id).map(message => message.author_label)])], [messages, member]);
  const pinnedToBottom = useRef(true);
  const initialScrollDone = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const saved = window.localStorage.getItem(CHAT_THEME_KEY);
    if (CHAT_THEMES.some((option) => option.value === saved)) {
      setTheme(saved as ChatTheme);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (themeReady) window.localStorage.setItem(CHAT_THEME_KEY, theme);
  }, [theme, themeReady]);

  useEffect(() => {
    let cancelled = false;
    async function refreshStatus() {
      try {
        const status = await fetchRoomStatus(room);
        if (!cancelled) setRoomStatus(status);
      } catch {
        // The write API independently enforces the room state. Keep the last
        // known UI state during a transient status read failure.
      }
    }
    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [room]);

  useEffect(() => {
    let cancelled = false;
    void invokeAdmin(room)
      .then((result) => {
        if (cancelled || !result.isOwner) return;
        setIsOwner(true);
        if (result.room) setRoomStatus(result.room);
        setSummaries(result.summaries ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [room]);

  useEffect(() => {
    let cancelled = false;
    async function identify() {
      try {
        const response = await fetch("/api/chat/member", { cache: "no-store" });
        if (!response.ok) throw new Error("Your chat identity could not load. Please refresh to try again.");
        const account = await response.json() as { signedIn: boolean; member: ChatMember | null };
        if (cancelled) return;
        setSignedIn(account.signedIn);
        const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
        const savedName = window.localStorage.getItem(GUEST_NAME_KEY) ?? "";
        if (account.member) {
          setMember(account.member);
          setGuestId(account.member.id);
          setDisplayName(account.member.display_name);
          setNameDraft(account.member.display_name);
          window.localStorage.removeItem(GUEST_TOKEN_KEY);
          setIdentityStatus("ready");
          return;
        }
        if (account.signedIn || !token) {
          setNameDraft(savedName); setIdentityStatus("name"); return;
        }
        try {
          const result = await invokeGuest({ room, action: "session", token });
          if (cancelled) return;
          if (!result.guestId || !result.displayName) throw new Error("invalid_session");
          setGuestId(result.guestId); setDisplayName(result.displayName);
          setNameDraft(result.displayName); setIdentityStatus("ready");
        } catch {
          if (!cancelled) { window.localStorage.removeItem(GUEST_TOKEN_KEY); setNameDraft(savedName); setIdentityStatus("name"); }
        }
      } catch (e) { if (!cancelled) setIdentityError(e instanceof Error ? e.message : "Your chat identity could not load."); }
    }
    void identify();
    return () => { cancelled = true; };
  }, [room]);

  useEffect(() => {
    let previous: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      if (previous !== undefined && previous !== id) {
        // Clear private state immediately before re-identifying this browser.
        setMember(null); setDmTarget(null); setSignedIn(false); setGuestId(""); setIdentityStatus("checking");
        window.location.reload();
      }
      previous = id;
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, room]);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    setLoading(true);

    async function connect() {
      const messageResult = await supabase
        .from("longboard_chat_messages")
        .select("id, room_slug, guest_id, member_id, author_label, body, bot_slug, reply_to_id, created_at")
        .eq("room_slug", room)
        .order("created_at", { ascending: false })
        .limit(60);

      if (cancelled) return;
      if (messageResult.error) {
        setError("Chat history did not load. Refresh the page to try again.");
        setLoading(false);
        return;
      }

      const loadedMessages = ((messageResult.data ?? []) as PublicChatMessage[]).reverse();
      const messageIds = loadedMessages.map((message) => message.id);
      const reactionResult = messageIds.length > 0
        ? await supabase
          .from("longboard_chat_reactions")
          .select("message_id, guest_id, active, created_at, updated_at")
          .in("message_id", messageIds)
        : { data: [] as PublicChatReaction[], error: null };

      if (cancelled) return;
      setMessages(loadedMessages);
      if (reactionResult.error) {
        setError("Messages loaded, but palm reactions are temporarily unavailable.");
      } else {
        setReactions((reactionResult.data ?? []) as PublicChatReaction[]);
      }
      setLoading(false);

      channel = supabase
        .channel(`longboard-public-chat-${crypto.randomUUID()}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "longboard_chat_messages",
          filter: `room_slug=eq.${room}`,
        }, (payload) => {
          setMessages((current) => mergeMessage(current, payload.new as PublicChatMessage));
        })
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "longboard_chat_reactions",
        }, (payload) => {
          const incoming = payload.new as PublicChatReaction;
          if (incoming?.message_id) setReactions((current) => mergeReaction(current, incoming));
        })
        .subscribe();
    }

    void connect();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, room]);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    const presenceKey = guestId || `observer-${crypto.randomUUID()}`;

    channel = supabase.channel(`longboard-public-chat-presence-${room}`, {
      config: { presence: { key: presenceKey } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setPresenceReady(true);
        setChatterCount(countChatters(channel?.presenceState() ?? {}));
      })
      .subscribe(async (status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setPresenceReady(false);
          return;
        }
        if (status !== "SUBSCRIBED" || identityStatus !== "ready" || !guestId) return;
        await channel?.track({ guestId, onlineAt: new Date().toISOString() });
      });

    return () => {
      setPresenceReady(false);
      setChatterCount(0);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [guestId, identityStatus, supabase, room]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node || loading || identityStatus === "checking" || (identityStatus === "name" && roomStatus?.isOpen !== false)) return;
    if (!initialScrollDone.current || pinnedToBottom.current) {
      node.scrollTop = node.scrollHeight;
      initialScrollDone.current = true;
      pinnedToBottom.current = true;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messages, loading, identityStatus, roomStatus?.isOpen]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
    reactionTimersRef.current.clear();
  }, []);

  const roomPaused = roomStatus?.isOpen === false;
  const pauseNotice = roomStatus?.notice || "Chat temporarily paused by Longboard.";

  const feedback = useMemo(() => {
    if (error) return error;
    if (sendState === "success") return "Message sent.";
    return `${body.length} / ${MAX_MESSAGE_LENGTH}`;
  }, [body.length, error, sendState]);

  async function setRoomOpen(isOpen: boolean) {
    if (adminAction) return;
    if (!isOpen && !window.confirm(`Pause ${roomLabel} now? History stays readable. The other room remains available.`)) {
      return;
    }
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    setAdminState("loading");
    setAdminAction("room");
    setAdminFeedback(isOpen ? "Reopening chat…" : "Pausing chat…");
    try {
      const result = await invokeAdmin(room, { action: "set_room_open", isOpen, reason: adminReason });
      if (!result.room) throw new Error("The room state did not update.");
      setRoomStatus(result.room);
      if (isOpen) setAdminReason("");
      setAdminState("success");
      setAdminFeedback(isOpen
        ? "Chat reopened. New participation is enabled."
        : "Chat paused. History remains readable.");
      setAdminAction(null);
      adminTimerRef.current = setTimeout(() => {
        setAdminState("default");
        setAdminFeedback("");
      }, 2400);
    } catch (caught) {
      setAdminFeedback(caught instanceof Error ? caught.message : "The room state did not update.");
      setAdminState("error");
      setAdminAction(null);
    }
  }

  async function summarizeNow() {
    if (adminAction) return;
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    setAdminState("loading");
    setAdminAction("summary");
    setAdminFeedback("Creating a private summary…");
    try {
      const result = await invokeAdmin(room, { action: "summarize_now" });
      const refreshed = await invokeAdmin(room);
      setSummaries(refreshed.summaries ?? (result.result?.summary ? [result.result.summary] : summaries));
      setAdminState("success");
      setAdminFeedback(result.result?.status === "no_messages"
        ? "There are no messages to summarize for today."
        : "Today’s private summary is ready.");
      setAdminAction(null);
      adminTimerRef.current = setTimeout(() => {
        setAdminState("default");
        setAdminFeedback("");
      }, 2400);
    } catch (caught) {
      setAdminFeedback(caught instanceof Error ? caught.message : "Buddy could not create the summary.");
      setAdminState("error");
      setAdminAction(null);
    }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nameState === "loading") return;
    if (roomPaused) {
      setError(pauseNotice);
      return;
    }

    const nextName = nameDraft.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (nextName.length < 2 || nextName.length > 28) {
      setError("Use a name between 2 and 28 characters.");
      setNameState("error");
      return;
    }

    const token = window.localStorage.getItem(GUEST_TOKEN_KEY) || crypto.randomUUID();
    setNameState("loading");
    setError("");
    try {
      if (signedIn) {
        const response = await fetch("/api/chat/member", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: nextName, token }) });
        const result = await response.json();
        if (!response.ok || !result.member) throw new Error(result.error || "Your name could not be linked.");
        const linked = result.member as ChatMember;
        setMember(linked); setGuestId(linked.id); setDisplayName(linked.display_name); setNameDraft(linked.display_name);
        window.localStorage.removeItem(GUEST_TOKEN_KEY);
        window.localStorage.setItem(GUEST_NAME_KEY, linked.display_name);
        setNameState("success"); setIdentityStatus("ready");
        return;
      }
      const result = await invokeGuest({ room, action: "register", token, displayName: nextName });
      if (!result.guestId || !result.displayName) throw new Error("Your chat name was not saved.");
      window.localStorage.setItem(GUEST_TOKEN_KEY, token);
      window.localStorage.setItem(GUEST_NAME_KEY, result.displayName);
      setGuestId(result.guestId);
      setDisplayName(result.displayName);
      setNameDraft(result.displayName);
      setNameState("success");
      setIdentityStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your chat name was not saved.");
      setNameState("error");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guestId || sendState === "loading") return;
    if (roomPaused) {
      setError(pauseNotice);
      return;
    }

    const nextBody = body.trim();
    if (!nextBody) {
      setError("Write a message before sending it.");
      setSendState("error");
      return;
    }

    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token && !member) {
      setIdentityStatus("name");
      return;
    }

    const optimisticId = `pending-${crypto.randomUUID()}`;
    const optimistic: PublicChatMessage = {
      id: optimisticId,
      guest_id: guestId,
      member_id: member?.id ?? null,
      author_label: displayName,
      body: nextBody,
      created_at: new Date().toISOString(),
      pending: true,
    };
    pinnedToBottom.current = true;
    setMessages((current) => [...current, optimistic]);
    setBody("");
    window.sessionStorage.removeItem(`longboard-chat-draft-${room}`);
    setError("");
    setSendState("loading");

    try {
      const result = await invokeGuest({ room, action: "send", token, body: nextBody });
      const sent = typeof result.message === "object" ? result.message : null;
      if (!sent?.id) throw new Error("That message was not sent.");
      setMessages((current) => mergeMessage(
        current.filter((message) => message.id !== optimisticId),
        sent,
      ));
      setSendState("success");
      timerRef.current = setTimeout(() => setSendState("default"), 1400);
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setBody(nextBody);
      setError(caught instanceof Error ? caught.message : "That message was not sent.");
      setSendState("error");
    }
  }

  async function toggleReaction(message: PublicChatMessage) {
    if (roomPaused || message.pending || reactionStates[message.id] === "loading") return;
    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token && !member) return;

    const previous = reactions.find((reaction) => reaction.message_id === message.id && reaction.guest_id === guestId);
    const active = !previous?.active;
    const now = new Date().toISOString();
    const optimistic: PublicChatReaction = {
      message_id: message.id,
      guest_id: guestId,
      active,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    };
    setReactions((current) => mergeReaction(current, optimistic));
    setReactionStates((current) => ({ ...current, [message.id]: "loading" }));
    setError("");

    try {
      const result = await invokeGuest({ room, action: "react", token, messageId: message.id, active });
      if (!result.reaction) throw new Error("Your palm was not saved.");
      setReactions((current) => mergeReaction(current, result.reaction as PublicChatReaction));
      setReactionStates((current) => ({ ...current, [message.id]: "success" }));
      const timer = setTimeout(() => {
        setReactionStates((current) => ({ ...current, [message.id]: "default" }));
        reactionTimersRef.current.delete(message.id);
      }, 1000);
      reactionTimersRef.current.set(message.id, timer);
    } catch (caught) {
      setReactions((current) => {
        const withoutOptimistic = current.filter((reaction) => reaction.message_id !== message.id || reaction.guest_id !== guestId);
        return previous ? [...withoutOptimistic, previous] : withoutOptimistic;
      });
      setReactionStates((current) => ({ ...current, [message.id]: "error" }));
      setError(caught instanceof Error ? caught.message : "Your palm was not saved.");
    }
  }

  function openPopout() {
    setPopoutState("loading");
    const width = Math.min(460, Math.max(340, window.screen.availWidth - 32));
    const height = Math.min(780, Math.max(560, window.screen.availHeight - 48));
    const left = Math.max(0, window.screenX + window.outerWidth - width - 24);
    const top = Math.max(0, window.screenY + 36);
    const url = new URL(`/chat?popout=1&room=${room}`, window.location.origin);
    const opened = window.open(
      url.toString(),
      "longboard-public-chat",
      `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`,
    );
    if (!opened) {
      setError("Your browser blocked the chat window. Allow popups and try again.");
      setPopoutState("error");
      return;
    }
    opened.opener = null;
    opened.focus();
    setPopoutState("success");
    timerRef.current = setTimeout(() => setPopoutState("default"), 1400);
  }

  return (
    <main className={`${styles.page} ${fontVariableClass}`} data-popout={popout} data-theme={theme}>
      <div className={styles.shell}>
        <section className={styles.chat} aria-label="Longboard Chat">
          <header className={styles.header}>
            <div className={styles.compactBrand}>
              <span className={styles.lbMark} aria-label="Longboard Chat" title="Longboard Chat">LB<span aria-hidden="true">🌴</span></span>
              <span className={styles.onlineCount} data-live={presenceReady && !roomPaused} data-paused={roomPaused || undefined} aria-live="polite">
                <i aria-hidden="true" />{roomPaused ? "Paused" : presenceReady ? `${chatterCount} online` : "Connecting…"}
              </span>
            </div>
            <div className={styles.headerActions}>
              {member ? <DirectInbox key={member.id} member={member} target={dmTarget} onTargetClosed={() => setDmTarget(null)} /> : null}
              <ChatHeaderMenu>{(close) => <>
                <div className={styles.menuIdentity}>
                  <span>{signedIn ? "Signed in" : "Guest chat"}</span>
                  <strong>{displayName || "Welcome to Longboard"}</strong>
                </div>
                {!signedIn ? <Link className={styles.menuItem} href={loginHref}>Sign in for private messages <span aria-hidden="true">↗</span></Link> : !member ? <button type="button" className={styles.menuItem} onClick={() => { setIdentityStatus("name"); close(); }}>Link your member name</button> : null}
                {identityStatus === "ready" && !member ? <button type="button" className={styles.menuItem} onClick={() => { setError(""); setNameState("default"); setIdentityStatus("name"); close(); }}>Change chat name</button> : null}
                <div className={styles.menuSectionLabel}>Appearance</div>
                <div role="group" aria-label="Chat theme">
                  {CHAT_THEMES.map((option) => <button key={option.value} type="button" className={styles.menuItem} aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}>
                    <span><span aria-hidden="true">{option.icon}</span> {option.label}</span><span aria-hidden="true">{theme === option.value ? "✓" : ""}</span>
                  </button>)}
                </div>
                <div className={styles.menuDivider} />
                {isOwner ? <button type="button" className={styles.menuItem} aria-expanded={adminOpen} aria-controls="longboard-chat-admin-panel" onClick={() => { setAdminOpen((open) => !open); close(); }}>Admin controls <span aria-hidden="true">{adminOpen ? "−" : "+"}</span></button> : null}
                {!popout ? <button type="button" className={styles.menuItem} disabled={popoutState === "loading"} onClick={() => { openPopout(); close(); }}>Pop out chat <span aria-hidden="true">↗</span></button> : <Link className={styles.menuItem} href={`/chat?room=${room}`}>Open full page <span aria-hidden="true">↗</span></Link>}
              </>}</ChatHeaderMenu>
            </div>
          </header>

          <nav className={styles.roomTabs} aria-label="Chat rooms">
            {CHAT_ROOMS.map((option) => <Link key={option.slug} href={roomHref(option.slug)} scroll={false} onClick={(event) => {
              if (sendState === "loading" || adminAction) { event.preventDefault(); return; }
              window.sessionStorage.setItem(`longboard-chat-draft-${room}`, body);
            }} aria-current={room === option.slug ? "page" : undefined}>{option.label}</Link>)}
            <span>{room === "social" ? "Movies, life & everything else" : "Trading & the markets"}</span>
          </nav>

          {isOwner && adminOpen ? (
            <aside id="longboard-chat-admin-panel" className={styles.adminPanel} aria-label="Longboard Chat owner controls" aria-busy={Boolean(adminAction)}>
              <div className={styles.adminHeading}>
                <div>
                  <span>{roomLabel.toUpperCase()} · OWNER CONTROL</span>
                  <strong>{roomPaused ? "ROOM PAUSED" : "ROOM OPEN"}</strong>
                </div>
                <button className={styles.adminClose} type="button" aria-label="Close owner controls" onClick={() => setAdminOpen(false)}>×</button>
              </div>
              <p className={styles.adminCopy}>
                Only your authenticated Longboard account can use these controls. Pausing this room keeps its history readable and stops messages and reactions here.
              </p>
              {!roomPaused ? (
                <label className={styles.adminReason}>
                  <span>Optional public notice</span>
                  <input
                    value={adminReason}
                    maxLength={240}
                    placeholder="Chat temporarily paused by Longboard."
                    onChange={(event) => setAdminReason(event.target.value)}
                  />
                </label>
              ) : null}
              <div className={styles.adminActions}>
                <button
                  className={roomPaused ? styles.reopenButton : styles.pauseButton}
                  type="button"
                  disabled={Boolean(adminAction)}
                  onClick={() => void setRoomOpen(roomPaused)}
                >
                  {adminAction === "room" ? "WORKING…" : roomPaused ? "REOPEN CHAT" : "PAUSE CHAT"}
                </button>
                <button className={styles.summaryButton} type="button" disabled={Boolean(adminAction)} onClick={() => void summarizeNow()}>
                  {adminAction === "summary" ? "SUMMARIZING…" : "SUMMARIZE NOW"}
                </button>
              </div>
              <p className={styles.adminFeedback} data-state={adminState} aria-live="polite">
                {adminFeedback}
              </p>
              <ChatReportReview />
              <div className={styles.summaryList}>
                <span>PRIVATE DAILY SUMMARIES</span>
                {summaries.length ? summaries.slice(0, 3).map((summary) => (
                  <details key={summary.id}>
                    <summary>{summary.summary_date} · {summary.message_count} messages</summary>
                    <p>{summary.summary_text}</p>
                  </details>
                )) : <p>No summaries yet.</p>}
              </div>
            </aside>
          ) : null}

          {identityStatus === "checking" ? (
            <div className={styles.loading}>{identityError || "Opening the room…"}{identityError ? <button type="button" className={styles.textButton} onClick={() => window.location.reload()}>Refresh</button> : null}</div>
          ) : identityStatus === "name" && !roomPaused ? (
            <div className={styles.gate}>
              <form className={styles.gateForm} onSubmit={saveName}>
                <h1 className={styles.gateTitle}>{signedIn ? "Your member name." : "Pick a name."} <span>Join the room.</span></h1>
                <p className={styles.gateCopy}>{signedIn ? "Link this name to your account to chat and receive private message requests across devices." : "No account or login required for public chat. Sign in to send and receive private messages."}</p>
                <label className={styles.nameLabel} htmlFor="longboard-chat-name">Your chat name</label>
                <input
                  id="longboard-chat-name"
                  className={styles.nameInput}
                  value={nameDraft}
                  maxLength={28}
                  autoComplete="nickname"
                  autoFocus
                  placeholder="Enter the name you want to use"
                  aria-invalid={nameState === "error"}
                  onChange={(event) => {
                    setNameDraft(event.target.value);
                    setError("");
                    setNameState("default");
                  }}
                />
                <button className={styles.primaryButton} type="submit" disabled={nameState === "loading"} data-state={nameState}>
                  {nameState === "loading" ? "JOINING…" : signedIn ? "LINK NAME & JOIN" : "JOIN CHAT"}
                </button>
                <p className={styles.feedback} data-error={Boolean(error)} aria-live="polite">{error}</p>
              </form>
            </div>
          ) : (
            <>
              <div ref={messagesRef} onScroll={(event) => { const node = event.currentTarget; pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64; }} className={styles.messages} aria-live="polite" aria-busy={loading}>
                {roomPaused ? (
                  <div className={styles.pauseBanner} role="status">
                    <strong>CHAT PAUSED · HISTORY IS READ ONLY</strong>
                    <span>{pauseNotice}</span>
                  </div>
                ) : null}
                {loading ? (
                  <div className={styles.loading}>Loading the room…</div>
                ) : messages.length === 0 ? (
                  <div className={styles.empty}>
                    <strong>No messages yet.</strong>
                    <span>{room === "social" ? "Seen a good movie lately? Start the conversation." : "Start the Longboard conversation below."}</span>
                  </div>
                ) : messages.map((message) => {
                  const summary = reactionSummary(reactions, message.id, guestId);
                  const reactionState = message.pending ? "loading" : reactionStates[message.id] ?? "default";
                  return (
                    <article
                      className={styles.message}
                      key={message.id}
                      data-pending={message.pending || undefined}
                      data-bot={message.bot_slug === "buddy" || undefined}
                    >
                      {message.member_id && message.member_id !== member?.id ? (
                        <button type="button" className={`${styles.author} ${styles.memberAuthor}`} title={`Message ${message.author_label} privately`} onClick={() => {
                          if (!member) { window.location.href = loginHref; return; }
                          setDmTarget({ id: message.member_id!, name: message.author_label });
                        }}>{message.author_label}<span className={styles.memberBadge}>MEMBER · MESSAGE ↗</span></button>
                      ) : <span className={styles.author}>{message.bot_slug === "buddy" ? "@BUDDY" : message.guest_id === guestId ? "YOU" : message.author_label}{message.member_id ? <span className={styles.memberBadge}>MEMBER</span> : null}</span>}
                      <div className={styles.messageMeta}>
                        <button
                          className={styles.reactionButton}
                          type="button"
                          aria-label={summary.reacted
                            ? `Remove your palm reaction. ${summary.count} ${summary.count === 1 ? "palm" : "palms"}.`
                            : `React with a palm. ${summary.count} ${summary.count === 1 ? "palm" : "palms"}.`}
                          aria-pressed={summary.reacted}
                          disabled={roomPaused || !guestId || reactionState === "loading"}
                          data-state={reactionState}
                          onClick={() => void toggleReaction(message)}
                        >
                          <span aria-hidden="true">🌴</span>
                          <span>{summary.count}</span>
                          <span aria-hidden="true">{reactionState === "loading" ? "…" : reactionState === "success" ? "✓" : reactionState === "error" ? "×" : ""}</span>
                        </button>
                        <time className={styles.time} dateTime={message.created_at}>
                          {message.pending ? "SENDING" : chatTime(message.created_at)}
                        </time>
                      </div>
                      <MessageBody body={message.body} names={mentionNames} />
                    </article>
                  );
                })}
              </div>
              {identityStatus === "ready" && !roomPaused ? (
                <form className={styles.composerWrap} onSubmit={sendMessage}>
                  <div className={styles.composerRow}>
                    <MentionTextarea
                      enabled={Boolean(member)}
                      buddyEnabled={room === "main"}
                      className={styles.composer}
                      value={body}
                      maxLength={MAX_MESSAGE_LENGTH}
                      rows={2}
                      aria-label={`Message ${roomLabel}`}
                      aria-describedby="longboard-chat-feedback"
                      aria-invalid={sendState === "error"}
                      disabled={sendState === "loading"}
                      placeholder={`Write as ${displayName}…${room === "main" ? " Try @Buddy for a reply." : " What’s on your mind?"}`}
                      onValue={(value) => {
                        setBody(value);
                        setError("");
                        if (sendState === "error") setSendState("default");
                      }}
                    />
                    <div className={styles.composerActions}>
                      <GifComposer disabled={sendState === "loading"} onAdd={(url) => {
                        const next = [body.trim(), url].filter(Boolean).join("\n");
                        if (next.length > MAX_MESSAGE_LENGTH) return false;
                        setBody(next);
                        setError("");
                        return true;
                      }} />
                        <button className={styles.primaryButton} type="submit" disabled={sendState === "loading"} data-state={sendState}>
                        {sendState === "loading" ? "SENDING…" : sendState === "success" ? "SENT ✓" : "SEND"}
                      </button>
                    </div>
                  </div>
                  <p id="longboard-chat-feedback" className={styles.feedback} data-error={Boolean(error)} aria-live="polite">
                    {feedback} · Enter to send · Shift+Enter for a new line. Messages are saved and may be privately summarized. {room === "main" ? "Buddy replies only to @Buddy." : ""}
                  </p>
                </form>
              ) : (
                <div className={styles.readOnlyFooter}>
                  <strong>READ-ONLY MODE</strong>
                  <span>{pauseNotice}</span>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
