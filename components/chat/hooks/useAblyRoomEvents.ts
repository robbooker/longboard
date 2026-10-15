"use client";
import { useEffect, useState, type RefObject } from "react";
import type { Realtime, TokenRequest } from "ably";
import type { ChatUpdateCoordinator } from "@/lib/chatUpdateCoordinator";
import {
  ablyRoomEventActions,
  CHAT_REACTION_EVENT,
  chatRoomChannel,
  chatRoomFromChannel,
} from "@/lib/chatRealtimeChannels";
import {
  ChatEventStream,
  chatEventStreamKilled,
  liveEventNumbers,
  type ChatStreamEvent,
} from "@/lib/chatEventStream";
import type { ChatRoom } from "@/lib/publicChat";
import { noteChatTypingToken, releaseChatTypingClient, setChatTypingClient } from "./chatTypingTransport";

async function chatToken(): Promise<TokenRequest | null> {
  const response = await fetch("/api/chat/realtime-token", { cache: "no-store" });
  return response.ok ? ((await response.json()) as TokenRequest) : null;
}

/** A missed message is "new" for the page (timings, typing) only if it is recent and untouched. */
const caughtUpType = (row: Record<string, unknown>) =>
  !row.revision &&
  !row.edited_at &&
  !row.deleted_at &&
  !row.removed &&
  Date.now() - Date.parse(String(row.created_at)) < 120_000
    ? "INSERT"
    : "UPDATE";

/**
 * Subscribe to every room this account may read over Ably, when the server grants a
 * token. Returns whether the connection is live; callers keep polling while it is not.
 *
 * EVENT-STREAM (docs/chat-event-stream.md): for the rooms whose history is on screen it also
 * keeps a numbered cursor; a gap or a re-attach asks for "everything after N", and while the
 * cursor is in step the room's history reader relaxes to every five minutes.
 */
export function useAblyRoomEvents(
  updates: ChatUpdateCoordinator,
  visibleRooms: RefObject<ChatRoom[]>,
): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let disposed = false;
    let client: Realtime | null = null;
    const dispatch = (room: ChatRoom, name: string, data: unknown) => {
      const { detail, topics, reaction } = ablyRoomEventActions(room, visibleRooms.current ?? [], name, data);
      if (detail) window.dispatchEvent(new CustomEvent("chat-room-event", { detail }));
      if (reaction) window.dispatchEvent(new CustomEvent(CHAT_REACTION_EVENT, { detail: reaction }));
      return topics;
    };
    const invalidate = (topics: string[]) => {
      const immediate = topics.filter((topic) => topic !== "activity") as Parameters<
        typeof updates.invalidate
      >;
      if (immediate.length) updates.invalidate(...immediate);
      // Unread badges tolerate a short delay; this keeps the bell query off every message.
      if (topics.includes("activity")) updates.invalidateAtMost("activity", 5000);
    };
    // Caught-up changes take exactly the live path, so every listener treats them alike.
    const apply = (room: ChatRoom, events: ChatStreamEvent[]) => {
      const topics = new Set<string>();
      for (const event of events) {
        if ("deletedId" in event) {
          window.dispatchEvent(
            new CustomEvent("chat-room-event", {
              detail: { eventType: "DELETE", new: {}, old: { id: event.deletedId } },
            }),
          );
          topics.add("room");
          topics.add("activity");
        } else
          dispatch(room, "message", {
            kind: "message",
            eventType: caughtUpType(event.row),
            row: event.row,
          }).forEach((t) => topics.add(t));
      }
      invalidate([...topics]);
    };
    let killed = false;
    try {
      killed = chatEventStreamKilled(window.sessionStorage, window.location.search);
    } catch {}
    const stream = killed
      ? null
      : new ChatEventStream({
          read: (path) => updates.read(path),
          apply,
          reconcile: () => updates.invalidate("history"),
          ready: (room, inStep) => updates.setStreamRoom(room, inStep),
          now: () => Date.now(),
        });
    const stopRooms = stream
      ? updates.onStreamRooms((rooms) => stream.setRooms(rooms as ChatRoom[]))
      : undefined;
    stream?.setRooms(updates.streamRoomsWatched() as ChatRoom[]);
    void (async () => {
      // A refused token (rollout off, signed out) leaves this window on its existing transport.
      let first = await chatToken();
      if (!first || disposed) return;
      const rooms = Object.keys(JSON.parse(first.capability || "{}"))
        .map(chatRoomFromChannel)
        .filter((room): room is ChatRoom => !!room);
      const { Realtime } = await import("ably");
      if (disposed) return;
      client = new Realtime({
        authCallback: (_params, callback) => {
          const pending = first;
          first = null;
          void (pending ? Promise.resolve(pending) : chatToken())
            .then((token) => {
              if (!token) return callback("realtime_unavailable", null);
              noteChatTypingToken(token.capability);
              callback(null, token);
            })
            .catch(() => callback("realtime_unavailable", null));
        },
        closeOnUnload: true,
      });
      setChatTypingClient(client);
      const realtime = client;
      const channels = rooms.map((room) => [room, realtime.channels.get(chatRoomChannel(room))] as const);
      realtime.connection.on((change) => {
        if (disposed) return;
        const connected = change.current === "connected";
        setLive(connected);
        stream?.setLive(connected);
        // After a reconnect, catch up each room once its channel is attached again.
        if (connected && stream)
          for (const [room, channel] of channels)
            void channel
              .whenState("attached")
              .then(() => !disposed && stream.attached(room))
              .catch(() => undefined);
      });
      for (const [room, channel] of channels) {
        if (stream)
          // Re-attached without Ably's continuity (e.g. after a long disconnect): catch up.
          channel.on(["attached", "update"], (change) => {
            if (!disposed && !change.resumed) stream.attached(room);
          });
        void channel.subscribe((message) => {
          if (disposed || document.hidden || !navigator.onLine) return;
          // A numbered "reload the history" signal for a room in step is a catch-up instead:
          // the cursor asks for just the changed rows.
          const numbered = !!stream?.inStep(room) && liveEventNumbers(message.data).head !== undefined;
          stream?.event(room, message.data);
          const topics = dispatch(room, message.name ?? "", message.data);
          invalidate(numbered ? topics.filter((topic) => topic !== "history") : topics);
        });
      }
    })().catch(() => undefined);
    return () => {
      disposed = true;
      stopRooms?.();
      stream?.stop();
      releaseChatTypingClient(client);
      client?.close();
      setLive(false);
    };
  }, [updates, visibleRooms]);
  return live;
}
