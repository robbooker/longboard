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
import type { ChatRoom } from "@/lib/publicChat";

async function chatToken(): Promise<TokenRequest | null> {
  const response = await fetch("/api/chat/realtime-token", { cache: "no-store" });
  return response.ok ? ((await response.json()) as TokenRequest) : null;
}

/**
 * Subscribe to every room this account may read over Ably, when the server grants a
 * token. Returns whether the connection is live; callers keep polling while it is not.
 */
export function useAblyRoomEvents(
  updates: ChatUpdateCoordinator,
  visibleRooms: RefObject<ChatRoom[]>,
): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let disposed = false;
    let client: Realtime | null = null;
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
            .then((token) => (token ? callback(null, token) : callback("realtime_unavailable", null)))
            .catch(() => callback("realtime_unavailable", null));
        },
        closeOnUnload: true,
      });
      client.connection.on((change) => {
        if (!disposed) setLive(change.current === "connected");
      });
      for (const room of rooms)
        void client.channels.get(chatRoomChannel(room)).subscribe((message) => {
          if (disposed || document.hidden || !navigator.onLine) return;
          const { detail, topics, reaction } = ablyRoomEventActions(
            room,
            visibleRooms.current ?? [],
            message.name ?? "",
            message.data,
          );
          if (detail) window.dispatchEvent(new CustomEvent("chat-room-event", { detail }));
          if (reaction) window.dispatchEvent(new CustomEvent(CHAT_REACTION_EVENT, { detail: reaction }));
          const immediate = topics.filter((topic) => topic !== "activity");
          if (immediate.length) updates.invalidate(...immediate);
          // Unread badges tolerate a short delay; this keeps the bell query off every message.
          if (topics.includes("activity")) updates.invalidateAtMost("activity", 5000);
        });
    })().catch(() => undefined);
    return () => {
      disposed = true;
      client?.close();
      setLive(false);
    };
  }, [updates, visibleRooms]);
  return live;
}
