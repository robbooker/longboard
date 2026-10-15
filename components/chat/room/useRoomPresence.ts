"use client";
import { countChatters, type ChatRoom } from "@/lib/publicChat";
import type { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { IdentityStatus } from "./types";

/** Who is in the room right now, from the room's Supabase presence channel. */
export function useRoomPresence({
  guestId,
  identityStatus,
  supabase,
  room,
  conversationId,
}: {
  guestId: string;
  identityStatus: IdentityStatus;
  supabase: ReturnType<typeof createClient>;
  room: ChatRoom;
  conversationId: string | undefined;
}) {
  const [chatterCount, setChatterCount] = useState(0);
  const [presenceReady, setPresenceReady] = useState(false);
  const [onlineMemberIds, setOnlineMemberIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (conversationId) return;
    let channel: RealtimeChannel | null = null;
    const presenceKey = guestId || `observer-${crypto.randomUUID()}`;

    channel = supabase.channel(`longboard-public-chat-presence-${room}`, {
      config: { presence: { key: presenceKey } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setPresenceReady(true);
        const presence = channel?.presenceState<{ guestId?: string }>() ?? {};
        setChatterCount(countChatters(presence));
        setOnlineMemberIds(
          new Set(
            Object.values(presence)
              .flat()
              .map((item) => item.guestId)
              .filter((id): id is string => typeof id === "string"),
          ),
        );
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
      setOnlineMemberIds(new Set());
      if (channel) void supabase.removeChannel(channel);
    };
  }, [guestId, identityStatus, supabase, room, conversationId]);
  return { chatterCount, presenceReady, onlineMemberIds };
}
