"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import { projectRoomMessagePins, type RoomMessagePins } from "@/lib/chatRoomMessagePins";
import { useChatUpdates } from "../ChatUpdates";
const empty: RoomMessagePins = { pins: [], canManagePins: false };
export function useRoomMessagePins(accountId: string | undefined, room: ChatRoom, enabled: boolean) {
  const updates = useChatUpdates();
  const key = `${accountId ?? ""}:${room}:${enabled}`;
  // An opaque scope also prevents coordinator deduplication across A→B→A owners.
  const scope = useMemo(() => ({ owner: key, token: crypto.randomUUID() }), [key]).token;
  const owner = useRef(key);
  owner.current = key;
  const version = useRef(0),
    operation = useRef(0),
    mounted = useRef(false),
    mutating = useRef(false);
  const [state, setState] = useState<{
    key: string;
    data: RoomMessagePins;
    error: string;
    busy: string | null;
  }>({ key, data: empty, error: "", busy: null });
  useEffect(() => {
    mounted.current = true;
    mutating.current = false;
    version.current++;
    operation.current++;
    setState({ key, data: empty, error: "", busy: null });
    if (!enabled || !accountId)
      return () => {
        mounted.current = false;
      };
    let cancelled = false;
    const lifecycleVersion = version;
    const load = async () => {
      if (mutating.current) return;
      const request = version.current;
      try {
        const path = `/api/chat/message-pins?room=${room}&scope=${scope}`;
        const response = await (updates ? updates.read(path) : fetch(path, { cache: "no-store" }));
        const data = await response.json();
        if (cancelled || owner.current !== key || request !== version.current) return;
        if (!response.ok) {
          if ([401, 403].includes(response.status)) setState({ key, data: empty, error: "", busy: null });
          return;
        }
        setState((current) => ({
          key,
          data: projectRoomMessagePins(data, true),
          error: current.key === key ? current.error : "",
          busy: null,
        }));
      } catch {
        /* A transient refresh does not replace a known list with fabricated emptiness. */
      }
    };
    const stop = updates?.watch(load, ["room", "history"], false);
    if (!updates) void load();
    const changed = () => {
      version.current++;
      updates?.invalidate("room");
      if (!updates) void load();
    };
    const message = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (
        value?.eventType === "DELETE" ||
        (value?.new?.room_slug === room && (value.new.deleted_at || value.new.removed))
      ) {
        const id = value.eventType === "DELETE" ? value.old?.id : value.new?.id;
        version.current++;
        setState((current) =>
          current.key === key
            ? {
                ...current,
                data: { ...current.data, pins: current.data.pins.filter((pin) => pin.messageId !== id) },
              }
            : current,
        );
        updates?.invalidate("room");
      }
    };
    window.addEventListener("chat-room-refresh", changed);
    window.addEventListener("chat-room-event", message);
    return () => {
      cancelled = true;
      mounted.current = false;
      lifecycleVersion.current++;
      stop?.();
      window.removeEventListener("chat-room-refresh", changed);
      window.removeEventListener("chat-room-event", message);
    };
  }, [accountId, room, enabled, key, scope, updates]);
  const toggle = useCallback(
    async (messageId: string, pinned: boolean) => {
      if (!enabled || !accountId || mutating.current || state.key !== key || !state.data.canManagePins)
        return;
      mutating.current = true;
      const request = ++version.current,
        mutation = ++operation.current;
      setState((current) => ({ ...current, error: "", busy: messageId }));
      try {
        const response = await fetch("/api/chat/message-pins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, messageId, action: pinned ? "unpin" : "pin" }),
        });
        const data = await response.json();
        if (!mounted.current || owner.current !== key || request !== version.current) return;
        if (!response.ok)
          throw Error(
            data.error === "pin_limit"
              ? "This room already has 10 pinned messages. Unpin one first."
              : data.error === "message_not_found"
                ? "This message is no longer available."
                : data.error === "admin_required"
                  ? "Only chat admins can change pinned messages."
                  : "Could not update pinned messages. Please try again.",
          );
        setState({ key, data: projectRoomMessagePins(data, true), error: "", busy: null });
      } catch (error) {
        if (mounted.current && owner.current === key && request === version.current)
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Could not update pinned messages.",
            busy: null,
          }));
      } finally {
        if (mounted.current && owner.current === key && mutation === operation.current) {
          mutating.current = false;
          setState((current) => ({ ...current, busy: null }));
          updates?.invalidate("room");
        }
      }
    },
    [accountId, room, enabled, key, state.key, state.data.canManagePins, updates],
  );
  const current = state.key === key && enabled ? state : { key, data: empty, error: "", busy: null };
  return { ...current.data, error: current.error, busy: current.busy, toggle };
}
