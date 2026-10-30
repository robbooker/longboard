"use client";
import { useEffect, useState, type RefObject } from "react";
import type { Realtime, TokenRequest } from "ably";
import type { ChatUpdateCoordinator } from "@/lib/chatUpdateCoordinator";
import {
  ablyRoomEventActions,
  CHAT_POLL_EVENT,
  CHAT_REACTION_EVENT,
  chatRoomChannel,
  chatRoomFromChannel,
  type RoomStreamState,
} from "@/lib/chatRealtimeChannels";
import {
  ChatEventStream,
  chatEventStreamKilled,
  liveEventNumbers,
  type ChatStreamEvent,
} from "@/lib/chatEventStream";
import type { ChatRoom } from "@/lib/publicChat";
import { noteChatTypingToken, releaseChatTypingClient, setChatTypingClient } from "./chatTypingTransport";
import { setChatTimingStreamProbe } from "../room/useChatTimings";

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
 *
 * Step 2: while in step, room events carry `numbered` and no "room" reload: the open thread,
 * reply counts and pins apply the rows (and relax to five minutes as well). A reconnect or the
 * tab coming back catches up from the cursor instead of re-reading every reader.
 *
 * Step 3: a numbered reaction change re-reads just that message's reactions (live or caught up),
 * a caught-up pause/reopen re-reads the room's status, and both readers relax to five minutes.
 */
export function useAblyRoomEvents(
  updates: ChatUpdateCoordinator,
  visibleRooms: RefObject<ChatRoom[]>,
): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let disposed = false;
    let client: Realtime | null = null;
    const dispatch = (
      room: ChatRoom,
      name: string,
      data: unknown,
      shown = visibleRooms.current ?? [],
      streamState?: RoomStreamState,
    ) => {
      const { detail, topics, reaction, poll } = ablyRoomEventActions(room, shown, name, data, streamState);
      if (detail) window.dispatchEvent(new CustomEvent("chat-room-event", { detail }));
      if (reaction) window.dispatchEvent(new CustomEvent(CHAT_REACTION_EVENT, { detail: reaction }));
      if (poll) window.dispatchEvent(new CustomEvent(CHAT_POLL_EVENT, { detail: poll }));
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
    // Caught-up changes take exactly the live path, so every listener treats them alike. They
    // are numbered: the thread, counts and pins apply them instead of reloading.
    const apply = (room: ChatRoom, events: ChatStreamEvent[], changed: { pins: boolean; state: boolean }) => {
      const topics = new Set<string>();
      for (const event of events) {
        if ("reactionsId" in event)
          // Just that message's reactions (MessageReactions re-reads it if it is on screen).
          window.dispatchEvent(
            new CustomEvent(CHAT_REACTION_EVENT, { detail: { room, messageId: event.reactionsId } }),
          );
        else if ("deletedId" in event) {
          window.dispatchEvent(
            new CustomEvent("chat-room-event", {
              detail: {
                eventType: "DELETE",
                new: {},
                old: {
                  id: event.deletedId,
                  ...(event.parentId !== undefined ? { reply_to_id: event.parentId } : {}),
                },
                numbered: true,
              },
            }),
          );
          topics.add("activity");
        } else
          // The stream follows mounted readers of shown rooms, so its rows are always for a shown room.
          dispatch(
            room,
            "message",
            { kind: "message", eventType: caughtUpType(event.row), row: event.row },
            [room],
            streamState(room, true),
          ).forEach((t) => topics.add(t));
      }
      if (changed.pins) topics.add("pins");
      if (changed.state) topics.add("status");
      invalidate([...topics]);
    };
    // Live rows are applied only for rooms on screen, so only those rooms keep a cursor.
    const shownOnly = (rooms: string[]) =>
      rooms.filter((room): room is ChatRoom => (visibleRooms.current ?? []).includes(room as ChatRoom));
    let killed = false;
    try {
      killed = chatEventStreamKilled(window.sessionStorage, window.location.search);
    } catch {}
    const stream = killed
      ? null
      : new ChatEventStream({
          read: (path) => updates.read(path),
          apply,
          // Every reader of the room: the history, the open thread, reply counts, pins, its
          // status and the reactions on screen.
          reconcile: () => updates.invalidate("history", "room", "pins", "status", "reactions"),
          ready: (room, inStep) => updates.setStreamRoom(room, inStep, stream?.numbered(room)),
          now: () => Date.now(),
        });
    const streamState = (room: ChatRoom, numbered: boolean): RoomStreamState => {
      const known = stream?.numbered(room);
      return { numbered, pins: !!known?.pins, state: !!known?.state };
    };
    updates.setStreamCover(stream ? (room, need) => stream.covers(room as ChatRoom, need) : undefined);
    // CHAT-TIMING's stream tag: a sample is "on" while its room's numbered events are in step.
    const stopProbe = setChatTimingStreamProbe((room) => updates.streamInStep(room));
    // Live events are not applied while the tab is hidden or offline: catch up when it is back.
    const resume = () => {
      if (!document.hidden && navigator.onLine) stream?.resume();
    };
    if (stream) {
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("online", resume);
    }
    const stopRooms = stream
      ? updates.onStreamRooms((rooms) => stream.setRooms(shownOnly(rooms)))
      : undefined;
    stream?.setRooms(shownOnly(updates.streamRoomsWatched()));
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
          // A numbered event for a room in step needs no reload: its row is applied as it is, and
          // a numbered "reload" signal (or a gap) is a catch-up of just the changed rows.
          const { seq, head } = liveEventNumbers(message.data);
          const numbered = !!stream?.inStep(room) && (seq !== undefined || head !== undefined);
          // Only a row this window applies may move its cursor.
          if ((visibleRooms.current ?? []).includes(room)) stream?.event(room, message.data);
          invalidate(
            dispatch(room, message.name ?? "", message.data, undefined, streamState(room, numbered)),
          );
        });
      }
    })().catch(() => undefined);
    return () => {
      disposed = true;
      stopRooms?.();
      stream?.stop();
      updates.setStreamCover(undefined);
      stopProbe();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      releaseChatTypingClient(client);
      client?.close();
      setLive(false);
    };
  }, [updates, visibleRooms]);
  return live;
}
