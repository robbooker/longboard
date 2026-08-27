"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  countChatters,
  mergeMessage,
  mergeReaction,
  reactionSummary,
  tokenizeChatMessage,
  tradingViewSnapshotFromText,
  type PublicChatMessage,
  type PublicChatReaction,
  type TradingViewSnapshot,
} from "@/lib/publicChat";
import styles from "./PublicChat.module.css";

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
  throw new Error(typeof result.message === "string" ? result.message : "The chat service did not respond. Try again.");
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

function MessageBody({ body }: { body: string }) {
  const snapshot = tradingViewSnapshotFromText(body);
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
            {part.value}
          </a>
        ) : <span key={`text-${index}`}>{part.value}</span>)}
      </p>
      {snapshot ? <TradingViewPreview snapshot={snapshot} /> : null}
    </div>
  );
}

export default function PublicChat({ popout, fontVariableClass }: { popout: boolean; fontVariableClass: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [theme, setTheme] = useState<ChatTheme>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const themeIndex = CHAT_THEMES.findIndex((option) => option.value === theme);
  const currentTheme = CHAT_THEMES[themeIndex];
  const nextTheme = CHAT_THEMES[(themeIndex + 1) % CHAT_THEMES.length];
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>("checking");
  const [guestId, setGuestId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [chatterCount, setChatterCount] = useState(0);
  const [presenceReady, setPresenceReady] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [messages, setMessages] = useState<PublicChatMessage[]>([]);
  const [reactions, setReactions] = useState<PublicChatReaction[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [nameState, setNameState] = useState<ActionState>("default");
  const [sendState, setSendState] = useState<ActionState>("default");
  const [popoutState, setPopoutState] = useState<ActionState>("default");
  const [reactionStates, setReactionStates] = useState<Record<string, ActionState>>({});
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    const savedName = window.localStorage.getItem(GUEST_NAME_KEY) ?? "";
    if (!token) {
      setNameDraft(savedName);
      setIdentityStatus("name");
      return;
    }

    let cancelled = false;
    void invokeGuest({ action: "session", token })
      .then((result) => {
        if (cancelled || !result.guestId || !result.displayName) return;
        setGuestId(result.guestId);
        setDisplayName(result.displayName);
        setNameDraft(result.displayName);
        window.localStorage.setItem(GUEST_NAME_KEY, result.displayName);
        setIdentityStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        window.localStorage.removeItem(GUEST_TOKEN_KEY);
        setNameDraft(savedName);
        setIdentityStatus("name");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (identityStatus !== "ready" || !guestId) return;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    setLoading(true);

    async function connect() {
      const messageResult = await supabase
        .from("longboard_chat_messages")
        .select("id, guest_id, author_label, body, created_at")
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
  }, [guestId, identityStatus, supabase]);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    const presenceKey = guestId || `observer-${crypto.randomUUID()}`;

    channel = supabase.channel("longboard-public-chat-presence", {
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
  }, [guestId, identityStatus, supabase]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
    reactionTimersRef.current.clear();
  }, []);

  const feedback = useMemo(() => {
    if (error) return error;
    if (sendState === "success") return "Message sent.";
    return `${body.length} / ${MAX_MESSAGE_LENGTH}`;
  }, [body.length, error, sendState]);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nameState === "loading") return;

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
      const result = await invokeGuest({ action: "register", token, displayName: nextName });
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

    const nextBody = body.trim();
    if (!nextBody) {
      setError("Write a message before sending it.");
      setSendState("error");
      return;
    }

    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token) {
      setIdentityStatus("name");
      return;
    }

    const optimisticId = `pending-${crypto.randomUUID()}`;
    const optimistic: PublicChatMessage = {
      id: optimisticId,
      guest_id: guestId,
      author_label: displayName,
      body: nextBody,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages((current) => [...current, optimistic]);
    setBody("");
    setError("");
    setSendState("loading");

    try {
      const result = await invokeGuest({ action: "send", token, body: nextBody });
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
    if (message.pending || reactionStates[message.id] === "loading") return;
    const token = window.localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token) return;

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
      const result = await invokeGuest({ action: "react", token, messageId: message.id, active });
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
    const url = new URL("/chat?popout=1", window.location.origin);
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
            <div className={styles.brand}>
              <span className={styles.palmMark} aria-hidden="true">🌴</span>
              <div className={styles.brandCopy}>
                <strong>Longboard Chat</strong>
                <span
                  aria-label={`${chatterCount} ${chatterCount === 1 ? "chatter" : "chatters"} online`}
                  data-live={presenceReady}
                  title="Chatters online"
                >
                  {chatterCount}
                </span>
              </div>
            </div>
            <div className={styles.headerActions}>
              <span className={styles.status} data-connected={identityStatus === "ready"}>
                {identityStatus === "ready" ? "REAL-TIME" : "WELCOME"}
              </span>
              <button
                className={styles.themeButton}
                type="button"
                aria-label={`${currentTheme.label} theme. Switch to ${nextTheme.label} theme`}
                title={`${currentTheme.label} theme · next: ${nextTheme.label}`}
                onClick={() => setTheme(nextTheme.value)}
              >
                <span aria-hidden="true">{currentTheme.icon}</span>
              </button>
              {identityStatus === "ready" ? (
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={() => {
                    setError("");
                    setNameState("default");
                    setIdentityStatus("name");
                  }}
                >
                  {displayName.toUpperCase()}
                </button>
              ) : null}
              {!popout ? (
                <button
                  className={styles.textButton}
                  type="button"
                  disabled={popoutState === "loading"}
                  onClick={openPopout}
                >
                  {popoutState === "loading" ? "OPENING" : popoutState === "success" ? "OPENED ✓" : "POP OUT ↗"}
                </button>
              ) : (
                <Link className={styles.textButton} href="/chat">FULL PAGE ↗</Link>
              )}
            </div>
          </header>

          {identityStatus === "checking" ? (
            <div className={styles.loading}>Opening the room…</div>
          ) : identityStatus === "name" ? (
            <div className={styles.gate}>
              <form className={styles.gateForm} onSubmit={saveName}>
                <h1 className={styles.gateTitle}>Pick a name. <span>Join the room.</span></h1>
                <p className={styles.gateCopy}>No account or login required. This name appears beside your messages.</p>
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
                  {nameState === "loading" ? "JOINING…" : "JOIN CHAT"}
                </button>
                <p className={styles.feedback} data-error={Boolean(error)} aria-live="polite">{error}</p>
              </form>
            </div>
          ) : (
            <>
              <div ref={messagesRef} className={styles.messages} aria-live="polite" aria-busy={loading}>
                {loading ? (
                  <div className={styles.loading}>Loading the room…</div>
                ) : messages.length === 0 ? (
                  <div className={styles.empty}>
                    <strong>No messages yet.</strong>
                    <span>Start the Longboard conversation below.</span>
                  </div>
                ) : messages.map((message) => {
                  const summary = reactionSummary(reactions, message.id, guestId);
                  const reactionState = message.pending ? "loading" : reactionStates[message.id] ?? "default";
                  return (
                    <article className={styles.message} key={message.id} data-pending={message.pending || undefined}>
                      <span className={styles.author}>{message.guest_id === guestId ? "YOU" : message.author_label}</span>
                      <time className={styles.time} dateTime={message.created_at}>
                        {message.pending ? "SENDING" : chatTime(message.created_at)}
                      </time>
                      <MessageBody body={message.body} />
                      <div className={styles.reactionBar}>
                        <button
                          className={styles.reactionButton}
                          type="button"
                          aria-label={summary.reacted
                            ? `Remove your palm reaction. ${summary.count} ${summary.count === 1 ? "palm" : "palms"}.`
                            : `React with a palm. ${summary.count} ${summary.count === 1 ? "palm" : "palms"}.`}
                          aria-pressed={summary.reacted}
                          disabled={reactionState === "loading"}
                          data-state={reactionState}
                          onClick={() => void toggleReaction(message)}
                        >
                          <span aria-hidden="true">🌴</span>
                          <span>{summary.count}</span>
                          <span aria-hidden="true">{reactionState === "loading" ? "…" : reactionState === "success" ? "✓" : reactionState === "error" ? "×" : ""}</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <form className={styles.composerWrap} onSubmit={sendMessage}>
                <div className={styles.composerRow}>
                  <textarea
                    className={styles.composer}
                    value={body}
                    maxLength={MAX_MESSAGE_LENGTH}
                    rows={2}
                    aria-label="Message Longboard Chat"
                    aria-describedby="longboard-chat-feedback"
                    aria-invalid={sendState === "error"}
                    disabled={sendState === "loading"}
                    placeholder={`Write as ${displayName}…`}
                    onChange={(event) => {
                      setBody(event.target.value);
                      setError("");
                      if (sendState === "error") setSendState("default");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <button className={styles.primaryButton} type="submit" disabled={sendState === "loading"} data-state={sendState}>
                    {sendState === "loading" ? "SENDING…" : sendState === "success" ? "SENT ✓" : "SEND"}
                  </button>
                </div>
                <p id="longboard-chat-feedback" className={styles.feedback} data-error={Boolean(error)} aria-live="polite">
                  {feedback}
                </p>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
