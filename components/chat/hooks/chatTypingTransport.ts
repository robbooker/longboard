"use client";
import type { InboundMessage, Realtime, RealtimeChannel } from "ably";
import { CHAT_TYPING_EVENT, isChatTypingDmChannel, memberIdFromClientId } from "@/lib/chatTyping";

/**
 * Typing signals share the window's one Ably connection (opened by useAblyRoomEvents).
 * Without a live connection (rollout off, no token, offline) every call here is a no-op,
 * so the indicator simply never shows.
 */
type Listener = (memberId: string) => void;
let client: Realtime | null = null;
const listeners = new Map<string, Set<Listener>>();
const attached = new Map<string, () => void>();
let lastAuthorize = 0;
let rights: Record<string, string[]> = {};

/** The rights in the newest token the server signed for this window (from the auth callback). */
export function noteChatTypingToken(capability: string | undefined) {
  try {
    const parsed: unknown = JSON.parse(capability || "{}");
    rights = parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    rights = {};
  }
}
const allowed = (channel: string, op: "publish" | "subscribe") =>
  !!client && Array.isArray(rights[channel]) && rights[channel].includes(op);

/** A DM that began after the token was issued: ask for a fresh token, at most once a minute. */
async function refreshFor(channel: string): Promise<boolean> {
  if (!client || !isChatTypingDmChannel(channel) || Date.now() - lastAuthorize < 60_000) return false;
  lastAuthorize = Date.now();
  try {
    await client.auth.authorize();
  } catch {
    return false;
  }
  return true;
}

function attach(name: string) {
  const current = client;
  if (!current || attached.has(name)) return;
  if (!allowed(name, "subscribe")) {
    void refreshFor(name).then((ok) => {
      if (ok && current === client && listeners.has(name) && allowed(name, "subscribe")) attach(name);
    });
    return;
  }
  const channel: RealtimeChannel = current.channels.get(name);
  const handler = (message: InboundMessage) => {
    if (document.hidden) return;
    // The sender is whoever Ably authenticated, never anything inside the message.
    const memberId = memberIdFromClientId(message.clientId);
    if (!memberId) return;
    for (const listener of listeners.get(name) ?? []) listener(memberId);
  };
  void channel.subscribe(CHAT_TYPING_EVENT, handler).catch(() => undefined);
  attached.set(name, () => {
    channel.unsubscribe(CHAT_TYPING_EVENT, handler);
    void channel.detach().catch(() => undefined);
  });
}

function detach(name: string) {
  attached.get(name)?.();
  attached.delete(name);
}

export function setChatTypingClient(next: Realtime | null) {
  if (client === next) return;
  for (const name of [...attached.keys()]) detach(name);
  client = next;
  if (!next) rights = {};
  // Rights arrive with the token: (re)try waiting channels once connected or re-authorized.
  next?.connection.on(["connected", "update"], () => {
    if (client === next) for (const name of listeners.keys()) attach(name);
  });
  for (const name of listeners.keys()) attach(name);
}

/** Drop the connection only if it is still the one in use (a newer window may have replaced it). */
export function releaseChatTypingClient(owner: Realtime | null) {
  if (owner && client === owner) setChatTypingClient(null);
}

export function subscribeTyping(channel: string, listener: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) listeners.set(channel, (set = new Set()));
  set.add(listener);
  attach(channel);
  return () => {
    set.delete(listener);
    if (set.size) return;
    listeners.delete(channel);
    detach(channel);
  };
}

/** Fire-and-forget. Never while offline, hidden, or without publish rights for this channel. */
export function publishTyping(channel: string): boolean {
  if (!client || client.connection.state !== "connected" || document.hidden || !navigator.onLine) return false;
  if (!allowed(channel, "publish")) {
    void refreshFor(channel);
    return false;
  }
  void client.channels
    .get(channel)
    .publish({ name: CHAT_TYPING_EVENT, extras: { ephemeral: true } })
    .catch(() => undefined);
  return true;
}
