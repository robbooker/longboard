"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Command2MenuUser } from "@/components/command2/Command2UserMenu";
import { createClient } from "@/lib/supabase/client";
import styles from "./BoardroomChat.module.css";

type ChatMessage = {
  id: string;
  cohort: string;
  user_id: string;
  author_label: string;
  body: string;
  created_at: string;
  pending?: boolean;
};

type SendState = "default" | "loading" | "error" | "success";
type ChatVariant = "rail" | "popout";

const MAX_MESSAGE_LENGTH = 600;

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
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(Boolean(user && cohort));
  const [sendState, setSendState] = useState<SendState>("default");
  const [popoutState, setPopoutState] = useState<SendState>("default");
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user || !cohort) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    async function connect() {
      const { data, error: loadError } = await supabase
        .from("boardroom_chat_messages")
        .select("id, cohort, user_id, author_label, body, created_at")
        .eq("cohort", cohort)
        .order("created_at", { ascending: false })
        .limit(40);

      if (cancelled) return;
      if (loadError) {
        setError("Chat history did not load. Refresh the page to try again.");
        setLoading(false);
        return;
      }

      setMessages(((data ?? []) as ChatMessage[]).reverse());
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
        .subscribe();
    }

    void connect();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [cohort, supabase, user]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (popoutTimerRef.current) clearTimeout(popoutTimerRef.current);
  }, []);

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
    if (!user || !cohort || sendState === "loading") return;

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
      author_label: emailLabel(user.email),
      body: nextBody,
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
      .select("id, cohort, user_id, author_label, body, created_at")
      .single();

    if (sendError || !data) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setBody(nextBody);
      setError("That message was not sent. Check your connection and try again.");
      setSendState("error");
      return;
    }

    setMessages((current) => mergeMessage(
      current.filter((message) => message.id !== optimisticId),
      data as ChatMessage
    ));
    setSendState("success");
    successTimerRef.current = setTimeout(() => setSendState("default"), 1600);
  }

  const feedback = error || (sendState === "success" ? "Message sent." : `${body.length} / ${MAX_MESSAGE_LENGTH}`);

  return (
    <section className={styles.panel} data-variant={variant} aria-label="Boardroom Chat">
      <div className={styles.header}>
        <span>● BOARDROOM CHAT</span>
        <div className={styles.headerActions}>
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
              <article key={message.id} className={styles.message} data-pending={message.pending || undefined}>
                <span className={styles.author}>
                  {message.user_id === user.id ? "YOU" : message.author_label}
                </span>
                <time className={styles.time} dateTime={message.created_at}>
                  {message.pending ? "SENDING" : formatChatTime(message.created_at)}
                </time>
                <p className={styles.body}>{message.body}</p>
              </article>
            ))}
          </div>

          <form className={styles.composerWrap} onSubmit={sendMessage}>
            <div className={styles.composerRow}>
              <textarea
                className={styles.composer}
                value={body}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={2}
                aria-label="Message Boardroom Chat"
                aria-describedby="boardroom-chat-feedback"
                aria-invalid={sendState === "error"}
                disabled={sendState === "loading"}
                placeholder="Write to the Boardroom…"
                onChange={(event) => {
                  setBody(event.target.value);
                  if (sendState === "error") {
                    setError("");
                    setSendState("default");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                className={styles.send}
                type="submit"
                data-state={sendState}
                disabled={!body.trim() || sendState === "loading"}
              >
                {sendState === "loading" ? "SENDING" : sendState === "success" ? "SENT ✓" : "SEND"}
              </button>
            </div>
            <div
              id="boardroom-chat-feedback"
              className={styles.feedback}
              data-tone={error ? "error" : "neutral"}
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
