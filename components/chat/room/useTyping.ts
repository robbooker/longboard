"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  createTypingThrottle,
  expireTyping,
  noteTyping,
  typingLabel,
  typingNames,
  type TypingRoster,
} from "@/lib/chatTyping";
import type { ChatRoom } from "@/lib/publicChat";
import { publishTyping, subscribeTyping } from "../hooks/chatTypingTransport";

/**
 * The composer's `onInput`: one typing signal at most every 3 s while there is text.
 * Never re-renders anything; the transport skips it offline, hidden, or without rights.
 */
export function useTypingSender(channel: string | null) {
  const throttle = useRef(createTypingThrottle());
  const current = useRef(channel);
  useEffect(() => {
    current.current = channel;
    throttle.current.reset();
  }, [channel]);
  return useCallback((event: FormEvent<HTMLElement>) => {
    const target = event.target;
    if (!current.current || !(target instanceof HTMLTextAreaElement) || !target.value.trim()) return;
    if (throttle.current.shouldSend(Date.now())) publishTyping(current.current);
  }, []);
}

const NAME_TTL_MS = 10 * 60 * 1000;
const roomNames = new Map<string, { name: string | null; at: number }>();
const pendingNames = new Map<string, Promise<string | null | undefined>>();
/**
 * A typer's name from the room's member list (the same server list the Members panel shows),
 * never from the signal. Null: not someone you can see in this room. Undefined: try later.
 */
export function roomMemberName(room: ChatRoom, memberId: string): Promise<string | null | undefined> {
  const key = `${room}:${memberId}`;
  const cached = roomNames.get(key);
  if (cached && Date.now() - cached.at < NAME_TTL_MS) return Promise.resolve(cached.name);
  const pending = pendingNames.get(key);
  if (pending) return pending;
  const request = fetch("/api/chat/room-members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The hint ranks this member first, so page one holds them if they are listed at all.
    body: JSON.stringify({ room, q: "", onlineIds: [memberId] }),
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) return undefined;
      const data = (await response.json()) as { members?: Array<{ id: string; display_name: string }> };
      const name = data.members?.find((member) => member.id.toLowerCase() === memberId)?.display_name ?? null;
      roomNames.set(key, { name, at: Date.now() });
      return name;
    })
    .catch(() => undefined)
    .finally(() => pendingNames.delete(key));
  pendingNames.set(key, request);
  return request;
}

/**
 * "Name is typing…" for one channel. State lives only in the caller (the indicator), so typing
 * changes never re-render the message list. Re-renders only when the label text changes.
 */
export function useTypingLabel({
  channel,
  selfId,
  resolveName,
  room,
  clearKey,
}: {
  channel: string | null;
  selfId: string | null | undefined;
  resolveName: (memberId: string) => string | null | undefined | Promise<string | null | undefined>;
  /** Clear a typer when their message arrives in this room. */
  room?: ChatRoom;
  /** Clears everyone when it changes (e.g. the latest incoming DM). */
  clearKey?: string | null;
}): string {
  const [label, setLabel] = useState("");
  const roster = useRef<TypingRoster>(new Map());
  const names = useRef(new Map<string, string | null>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resolve = useRef(resolveName);
  resolve.current = resolveName;
  const self = useRef(selfId?.toLowerCase());
  self.current = selfId?.toLowerCase();

  const update = useCallback(() => {
    clearTimeout(timer.current);
    const now = Date.now();
    const next = expireTyping(roster.current, now);
    setLabel(typingLabel(typingNames(roster.current, self.current, (id) => names.current.get(id))));
    if (next !== null) timer.current = setTimeout(update, next - now + 50);
  }, []);

  useEffect(() => {
    const typers = roster.current,
      known = names.current;
    typers.clear();
    known.clear();
    setLabel("");
    if (!channel) return;
    const off = subscribeTyping(channel, (id) => {
      if (id === self.current) return;
      noteTyping(typers, id, Date.now());
      if (!known.has(id)) {
        known.set(id, null);
        void Promise.resolve(resolve.current(id))
          .then((name) => {
            if (name === undefined) known.delete(id);
            else known.set(id, name);
            update();
          })
          .catch(() => known.delete(id));
      }
      update();
    });
    const arrived = (event: Event) => {
      const row = (event as CustomEvent<{ eventType?: string; new?: Record<string, unknown> }>).detail;
      const author = typeof row?.new?.member_id === "string" ? row.new.member_id.toLowerCase() : null;
      if (row?.eventType === "INSERT" && author && row.new?.room_slug === room && typers.delete(author)) update();
    };
    if (room) window.addEventListener("chat-room-event", arrived);
    return () => {
      off();
      if (room) window.removeEventListener("chat-room-event", arrived);
      clearTimeout(timer.current);
    };
  }, [channel, room, update]);

  useEffect(() => {
    if (!roster.current.size) return;
    roster.current.clear();
    update();
  }, [clearKey, update]);

  return label;
}
