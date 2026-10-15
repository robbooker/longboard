"use client";
import { ChatReadRecovery } from "@/lib/chatReadRecovery";
import { realtimeRoomMessage } from "@/lib/chatRealtimeRoom";
import { reconcileRoomMessages } from "@/lib/chatMessageIdentity";
import {
  mergeReaction,
  mergeRoomMessage,
  type ChatRoom,
  type PublicChatMessage,
  type PublicChatReaction,
} from "@/lib/publicChat";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { useChatUpdates } from "../ChatUpdates";
import type { useChatScrollOwner } from "../hooks/useChatScrollOwner";

type Setter<T> = Dispatch<SetStateAction<T>>;

/**
 * Loads the room's history (on start, on "history" invalidations and every minute) and applies
 * realtime room messages and reactions. The scroll/opening state it reads stays owned by PublicChat.
 */
export function useRoomHistory({
  updates,
  room,
  inlineDm,
  loginHref,
  shortScoutRoom,
  scrollOwner,
  clearSession,
  setMessages,
  setReactions,
  messageVersion,
  knownMessageIds,
  openingAnchor,
  historyWindow,
  resumeLive,
  serverRendered,
  loadedRoom,
  setConnectionIssue,
  setLoading,
  setAccessDenied,
  setHistoryPage,
  onServerTruth,
}: {
  updates: NonNullable<ReturnType<typeof useChatUpdates>>;
  room: ChatRoom;
  inlineDm: boolean;
  loginHref: string;
  shortScoutRoom: boolean;
  scrollOwner: ReturnType<typeof useChatScrollOwner>;
  clearSession: () => void;
  setMessages: Setter<PublicChatMessage[]>;
  setReactions: Setter<PublicChatReaction[]>;
  messageVersion: RefObject<number>;
  knownMessageIds: RefObject<string>;
  openingAnchor: RefObject<string | null>;
  historyWindow: RefObject<string | null>;
  resumeLive: RefObject<boolean>;
  serverRendered: RefObject<boolean>;
  loadedRoom: RefObject<ChatRoom | null>;
  setConnectionIssue: Setter<{ room: ChatRoom; message: string } | null>;
  setLoading: Setter<boolean>;
  setAccessDenied: Setter<boolean>;
  setHistoryPage: Setter<{ hasMore: boolean; hasNewer: boolean }>;
  /** The list now holds the server's copy (replacing anything drawn from the device). */
  onServerTruth?: () => void;
}) {
  useEffect(() => {
    if (inlineDm) return;
    let cancelled = false;
    const recovery = new ChatReadRecovery((message) => setConnectionIssue({ room, message }));
    setConnectionIssue(null);
    if (loadedRoom.current !== room) setLoading(true);
    const load = async (why: string) => {
      if (why === "start" && serverRendered.current) {
        serverRendered.current = false;
        setLoading(false);
        return;
      }
      serverRendered.current = false;
      try {
        const version = messageVersion.current;
        const requestedAnchor = openingAnchor.current,
          requestedWindow = historyWindow.current;
        const response = await updates.read(
          `/api/chat/history?room=${room}&${knownMessageIds.current}${requestedWindow ? `&range=${requestedWindow}` : requestedAnchor ? `&anchor=${requestedAnchor}` : ""}`,
        );
        const result = await response.json();
        if (cancelled) return;
        if (response.status === 401) {
          clearSession();
          setMessages([]);
          setReactions([]);
          window.location.replace(loginHref);
          return;
        }
        if (
          response.status === 403 ||
          (response.status === 503 && result.error === "chat_unavailable" && shortScoutRoom)
        ) {
          setAccessDenied(true);
          setMessages([]);
          setReactions([]);
          setLoading(false);
          return;
        }
        if (!response.ok) throw new Error("Chat history did not load. Please try again.");
        if (
          version !== messageVersion.current ||
          requestedAnchor !== openingAnchor.current ||
          requestedWindow !== historyWindow.current
        ) {
          updates.invalidate("history");
          return;
        }
        loadedRoom.current = room;
        setAccessDenied(false);
        // Do not drop pending local sends while a reconciliation is in flight.
        if (requestedWindow) {
          setHistoryPage({ hasMore: !!result.hasMore, hasNewer: !!result.hasNewer });
          // Only a deliberate tail return plus a current no-gap response releases a fixed window.
          if (resumeLive.current && scrollOwner.following() && !result.hasNewer) {
            historyWindow.current = null;
            openingAnchor.current = null;
            resumeLive.current = false;
            updates.invalidate("history");
          }
        }
        setMessages((current) => reconcileRoomMessages(current, result.messages));
        setReactions(result.reactions);
        setLoading(false);
        onServerTruth?.();
        recovery.success();
      } catch (e) {
        if (!cancelled) {
          recovery.failure(e);
          setLoading(false);
        }
      }
    };
    const stop = updates.watch(load, ["history"], true, 60000);
    const message = (event: Event) => {
      const payload = (event as CustomEvent).detail;
      if (payload.eventType === "DELETE")
        setMessages((current) => current.filter((m) => m.id !== payload.old.id));
      else if (payload.new.room_slug === room) {
        // Trust the realtime row; reload history only when no loaded message can supply its badges.
        setMessages((current) => {
          const range = historyWindow.current?.split(",").map(Number);
          const { message: incoming, needsProjection } = realtimeRoomMessage(current, payload.new);
          if (
            range &&
            !incoming.removed &&
            !current.some((row) => row.id === incoming.id) &&
            ((incoming.unread_seq ?? 0) < range[0] || (incoming.unread_seq ?? 0) > range[1])
          )
            return current;
          if (needsProjection) queueMicrotask(() => updates.invalidate("history"));
          return mergeRoomMessage(current, incoming);
        });
      }
    };
    const reaction = (event: Event) => {
      const payload = (event as CustomEvent).detail;
      if (payload.new?.message_id)
        setReactions((current) => mergeReaction(current, payload.new as PublicChatReaction));
    };
    window.addEventListener("chat-room-event", message);
    window.addEventListener("chat-reaction-event", reaction);
    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("chat-room-event", message);
      window.removeEventListener("chat-reaction-event", reaction);
    };
  }, [
    updates,
    room,
    inlineDm,
    loginHref,
    setMessages,
    setReactions,
    clearSession,
    shortScoutRoom,
    scrollOwner,
    messageVersion,
    knownMessageIds,
    openingAnchor,
    historyWindow,
    resumeLive,
    serverRendered,
    loadedRoom,
    setConnectionIssue,
    setLoading,
    setAccessDenied,
    setHistoryPage,
    onServerTruth,
  ]);
}
