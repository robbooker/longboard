"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addToOutbox,
  browserOutboxStore,
  flushOutbox,
  isNetworkError,
  outboxKey,
  readOutbox,
  removeFromOutbox,
  withOutboxLock,
  type OutboxItem,
} from "@/lib/chatOutbox";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";

/** Rendered rows for queued room messages use this id prefix; it never collides with server ids. */
export const OUTBOX_ROW_PREFIX = "outbox-";
const LATER = "Waiting for the message above to send.";
/** Rooms accept one message per member every 1.5s. */
const SPACING = 1600;

/**
 * Room messages typed offline. They wait on this device ("Waiting for connection") and are sent in
 * order when the browser comes back online. Nothing runs while the outbox is empty.
 */
export function useRoomOutbox({
  memberId,
  room,
  author,
  send,
  onSent,
}: {
  memberId: string | null;
  room: ChatRoom;
  author: { guestId: string | null; label: string };
  /** Posts one queued message (same clientId every time). Throws on failure. */
  send: (item: OutboxItem) => Promise<PublicChatMessage>;
  onSent: (item: OutboxItem, message: PublicChatMessage) => void;
}) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const latest = useRef({ memberId, send, onSent });
  latest.current = { memberId, send, onSent };
  const running = useRef(false);
  const lastSent = useRef(0);
  const again = useRef(false);

  const reload = useCallback(() => {
    const store = browserOutboxStore();
    const id = latest.current.memberId;
    setItems(store && id ? readOutbox(store, id).filter((item) => item.kind === "room") : []);
  }, []);

  const flush = useCallback(async () => {
    const store = browserOutboxStore();
    const id = latest.current.memberId;
    if (!store || !id || !navigator.onLine) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        await withOutboxLock(`longboard-chat-outbox:${id}:room`, async () => {
          const result = await flushOutbox({
            store,
            memberId: id,
            kind: "room",
            send: async (item) => {
              setSending(item.clientId);
              setErrors((current) => {
                if (!(item.clientId in current)) return current;
                const next = { ...current };
                delete next[item.clientId];
                return next;
              });
              // Space queued sends out so the server's one-per-1.5s limit doesn't refuse them.
              const wait = lastSent.current + SPACING - Date.now();
              if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
              const message = await latest.current.send(item);
              lastSent.current = Date.now();
              // Swap the queued row for the real message in one render, so it never shows twice.
              setItems((current) => current.filter((row) => row.clientId !== item.clientId));
              latest.current.onSent(item, message);
            },
          });
          setSending(null);
          const stopped = result.stopped;
          if (stopped && !isNetworkError(stopped.error)) {
            // A real refusal: that message shows "Not sent" with Retry; later ones wait behind it.
            const reason =
              stopped.error instanceof Error ? stopped.error.message : "That message was not sent.";
            const later = readOutbox(store, id).filter(
              (item) => item.kind === "room" && item.clientId !== stopped.item.clientId,
            );
            setErrors((current) => ({
              ...current,
              [stopped.item.clientId]: reason,
              ...Object.fromEntries(later.map((item) => [item.clientId, LATER])),
            }));
          }
        });
        if (latest.current.memberId === id) reload();
      } while (again.current && navigator.onLine);
    } finally {
      running.current = false;
      setSending(null);
    }
  }, [reload]);

  // Load this member's queue, and send it if we're online. Other tabs' changes arrive as storage events.
  useEffect(() => {
    if (!memberId) {
      setItems([]);
      return;
    }
    reload();
    const store = browserOutboxStore();
    if (store && readOutbox(store, memberId).some((item) => item.kind === "room") && navigator.onLine)
      void flush();
    const key = outboxKey(memberId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) reload();
    };
    const onOnline = () => {
      const current = browserOutboxStore();
      if (current && readOutbox(current, memberId).some((item) => item.kind === "room")) void flush();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) onOnline();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [memberId, reload, flush]);

  /** Queues a text message for later. Returns false when it couldn't be stored on this device. */
  const queue = useCallback(
    (body: string, clientId: string, createdAt = new Date().toISOString()) => {
      const store = browserOutboxStore();
      const id = latest.current.memberId;
      if (!store || !id) return false;
      const stored = addToOutbox(store, {
        kind: "room",
        target: room,
        body,
        clientId,
        createdAt,
        memberId: id,
      });
      if (!stored) return false;
      reload();
      if (navigator.onLine) void flush();
      return true;
    },
    [room, reload, flush],
  );

  const retry = useCallback(() => {
    setErrors({});
    void flush();
  }, [flush]);

  const discard = useCallback(
    (clientId: string) => {
      const store = browserOutboxStore();
      const id = latest.current.memberId;
      if (store && id) removeFromOutbox(store, id, clientId);
      setErrors((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
      reload();
    },
    [reload],
  );

  const rows = useMemo<PublicChatMessage[]>(
    () =>
      items
        .filter((item) => item.target === room)
        .map((item) => ({
          id: `${OUTBOX_ROW_PREFIX}${item.clientId}`,
          guest_id: author.guestId,
          member_id: item.memberId,
          author_label: author.label,
          body: item.body,
          created_at: item.createdAt,
          pending: true,
          send_client_id: item.clientId,
          ...(errors[item.clientId]
            ? { send_error: errors[item.clientId] }
            : sending === item.clientId
              ? {}
              : { send_queued: true }),
        })),
    [items, room, author.guestId, author.label, errors, sending],
  );

  return {
    rows,
    /** New sends wait behind queued ones (to keep order), unless one is stuck on an error. */
    queueFirst: items.length > 0 && !Object.keys(errors).length,
    queue,
    retry,
    discard,
  };
}

export function isOutboxRow(id: string) {
  return id.startsWith(OUTBOX_ROW_PREFIX);
}

export { isNetworkError };
