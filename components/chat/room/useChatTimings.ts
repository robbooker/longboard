"use client";
// CHAT-TIMING browser side. Only 1 in 5 tab sessions gets a recorder; for the others every
// export here returns after one null check and no listener is ever installed.
// See lib/chatTimings.ts for what each timing measures.
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  CHAT_TIMING_ENDPOINT,
  ChatTimingBuffer,
  chatClockOffset,
  chatDeliveryLag,
  chatLandingDistance,
  decideChatTimingSample,
  encodeChatTimingBatch,
  type ChatTimingMetric,
} from "@/lib/chatTimings";
import { CHAT_PHONE_QUERY } from "@/lib/chatPhoneNav";
import type { ChatRoom } from "@/lib/publicChat";

/** How long after the room is ready the landing is checked (the scroll owner settles first). */
const LANDING_SETTLE_MS = 600;
/** A room change counts as a switch only if it follows a tap/key/back within this time. */
const SWITCH_INPUT_MS = 2000;
const INTERACTIVE = 'button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="option"],summary,label,select,input,textarea';

function loadedAsChatPage() {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return !!entry && new URL(entry.name).pathname.startsWith("/chat");
  } catch {
    return false;
  }
}

/** Runs after the next frame has been painted (rAF, then a task after that frame). */
function afterNextPaint(callback: () => void) {
  requestAnimationFrame(() => setTimeout(callback, 0));
}

class ChatTimingRecorder {
  buffer = new ChatTimingBuffer();
  lastHiddenAt = document.visibilityState === "hidden" ? performance.now() : -1;
  lastInputAt = -Infinity;
  /** The first room mount is the page open: timed only if this document was loaded as a chat page. */
  firstOpen: "time" | "skip" | "done" = loadedAsChatPage() ? "time" : "skip";
  room: ChatRoom | null = null;
  root: HTMLElement | null = null;
  clock: { offset: number; error: number } | null = null;
  private clockAsked = false;
  sends = new Map<string, number>();

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      this.lastHiddenAt = performance.now();
      this.flush();
    });
    window.addEventListener("pagehide", () => this.flush());
    const input = (event: Event) => {
      if (event.timeStamp > 0) this.lastInputAt = event.timeStamp;
    };
    window.addEventListener("keydown", input, { capture: true, passive: true });
    window.addEventListener("popstate", input);
    window.addEventListener(
      "click",
      (event) => {
        input(event);
        this.tap(event);
      },
      { capture: true, passive: true },
    );
  }

  /** Records `now - start` after the next paint, unless the tab was hidden in between. */
  measure(metric: ChatTimingMetric, start: number, room: ChatRoom, ready?: () => boolean, tries = 10) {
    afterNextPaint(() => {
      if (document.hidden || this.lastHiddenAt >= start) return;
      if (ready && !ready()) {
        if (tries > 0) this.measure(metric, start, room, ready, tries - 1);
        return;
      }
      this.buffer.add(metric, performance.now() - start, room);
    });
  }

  private tap(event: MouseEvent) {
    const target = event.target;
    if (!this.room || !this.root || !(target instanceof Element) || !(event.timeStamp > 0)) return;
    if (!this.root.contains(target) || !target.closest(INTERACTIVE)) return;
    this.measure("tap_response", event.timeStamp, this.room);
  }

  /** One server-time read per sampled session, for delivery_lag. No retry if it fails. */
  askClock() {
    if (this.clockAsked) return;
    this.clockAsked = true;
    const sentAt = Date.now();
    void fetch(CHAT_TIMING_ENDPOINT, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const receivedAt = Date.now();
        if (body && typeof body.now === "number") this.clock = chatClockOffset(sentAt, receivedAt, body.now);
      })
      .catch(() => undefined);
  }

  flush() {
    const rows = this.buffer.take();
    let phone = false;
    try {
      phone = window.matchMedia(CHAT_PHONE_QUERY).matches;
    } catch {}
    const body = encodeChatTimingBatch(phone ? "phone" : "desktop", rows);
    if (!body) return;
    try {
      // text/plain keeps the beacon a simple request; the server parses and checks it strictly.
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (typeof navigator.sendBeacon === "function") navigator.sendBeacon(CHAT_TIMING_ENDPOINT, blob);
      else void fetch(CHAT_TIMING_ENDPOINT, { method: "POST", body: blob, keepalive: true }).catch(() => undefined);
    } catch {}
    // Never retried: a lost batch is just fewer samples.
  }
}

let recorder: ChatTimingRecorder | null | undefined;
function chatTimingRecorder(): ChatTimingRecorder | null {
  if (recorder !== undefined) return recorder;
  if (typeof window === "undefined") return null;
  let store: Storage | null = null;
  try {
    store = window.sessionStorage;
  } catch {}
  recorder = decideChatTimingSample(store) ? new ChatTimingRecorder() : null;
  return recorder;
}

const rowPainted = (id: string) => () => !!document.getElementById(`chat-message-${id}`);

/** Call when Send is pressed for a text-only room message. */
export function chatTimingSendStart(clientId: string | undefined, pressedAt: number) {
  const rec = recorder;
  if (!rec || !clientId || !(pressedAt > 0)) return;
  if (rec.sends.size >= 20) rec.sends.clear();
  rec.sends.set(clientId, pressedAt);
}

/** Call once the server-confirmed message has been merged into the list. */
export function chatTimingSendShown(clientId: string | undefined, messageId: string, room: ChatRoom) {
  const rec = recorder;
  if (!rec || !clientId) return;
  const start = rec.sends.get(clientId);
  if (start === undefined) return;
  rec.sends.delete(clientId);
  rec.measure("send_visible", start, room, rowPainted(messageId));
}

type RoomEventDetail = {
  eventType?: string;
  new?: {
    id?: string;
    room_slug?: string;
    created_at?: string;
    member_id?: string | null;
    guest_id?: string | null;
    reply_to_id?: string | null;
    removed?: boolean;
    deleted_at?: string | null;
  };
};

/**
 * Room-level timings for one mounted room (PublicChatContent is keyed by room, so a mount is a
 * room open). `listRef` is the scrolling message list, `rootRef` the chat page.
 */
export function useChatTimings({
  enabled,
  room,
  memberId,
  rootRef,
  listRef,
  openingReady,
  hasMessages,
  shown,
  openingAnchor,
  openingCancelled,
}: {
  enabled: boolean;
  room: ChatRoom;
  memberId: string | null | undefined;
  rootRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  openingReady: boolean;
  hasMessages: boolean;
  /** The conversation is on screen (not under the phone's room list or a DM). */
  shown: boolean;
  openingAnchor: RefObject<string | null>;
  openingCancelled: RefObject<boolean>;
}) {
  const [rec] = useState(() => (enabled ? chatTimingRecorder() : null));
  const pending = useRef<{ metric: ChatTimingMetric; start: number | null; deepLink: boolean } | null>(null);
  const live = useRef({ memberId, shown });
  live.current = { memberId, shown };

  useEffect(() => {
    if (!rec) return;
    const first = rec.firstOpen;
    rec.firstOpen = "done";
    const now = performance.now();
    const deepLink =
      window.location.hash.startsWith("#chat-message-") || new URL(window.location.href).searchParams.has("thread");
    pending.current =
      first !== "done"
        ? { metric: "open_first_message", start: first === "time" ? 0 : null, deepLink }
        : { metric: "room_switch", start: now - rec.lastInputAt <= SWITCH_INPUT_MS ? rec.lastInputAt : null, deepLink };
    rec.room = room;
    rec.root = rootRef.current;
    rec.askClock();
    const arrived = (event: Event) => {
      const detail = (event as CustomEvent<RoomEventDetail>).detail;
      const row = detail?.new;
      if (detail?.eventType !== "INSERT" || !row?.id || !row.created_at || row.room_slug !== room) return;
      if (row.reply_to_id || row.removed || row.deleted_at || document.hidden || !live.current.shown) return;
      const own = live.current.memberId;
      if (own && (row.member_id === own || row.guest_id === own)) return;
      const createdAt = row.created_at,
        id = row.id,
        start = performance.now();
      const check = rowPainted(id);
      const wait = (tries: number) =>
        afterNextPaint(() => {
          if (document.hidden || rec.lastHiddenAt >= start) return;
          if (!check()) {
            if (tries > 0) wait(tries - 1);
            return;
          }
          const lag = chatDeliveryLag(createdAt, Date.now(), rec.clock);
          if (lag !== null) rec.buffer.add("delivery_lag", lag, room);
        });
      wait(10);
    };
    window.addEventListener("chat-room-event", arrived);
    return () => {
      window.removeEventListener("chat-room-event", arrived);
      if (rec.room === room) rec.room = null;
    };
  }, [rec, room, rootRef]);

  useEffect(() => {
    const open = pending.current;
    if (!rec || !open || !openingReady || !hasMessages) return;
    pending.current = null;
    if (!shown) return;
    const list = listRef.current;
    if (!list) return;
    const anyRow = () => !!list.querySelector('[id^="chat-message-"]');
    if (open.start !== null) rec.measure(open.metric, open.start, room, anyRow);
    // wrong_landing: deep links and rooms the reader already moved in are not judged.
    if (open.deepLink || openingCancelled.current) return;
    const anchor = openingAnchor.current;
    const readyAt = performance.now();
    let touched = false;
    const touch = () => (touched = true);
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of events) list.addEventListener(name, touch, { passive: true });
    const timer = setTimeout(() => {
      for (const name of events) list.removeEventListener(name, touch);
      if (touched || openingCancelled.current || document.hidden || rec.lastHiddenAt >= readyAt) return;
      if (!list.isConnected || !live.current.shown) return;
      const pane = list.getBoundingClientRect();
      const row = anchor ? document.getElementById(`chat-message-${anchor}`)?.getBoundingClientRect() : null;
      const distance = chatLandingDistance(
        {
          top: pane.top,
          bottom: pane.bottom,
          scrollHeight: list.scrollHeight,
          scrollTop: list.scrollTop,
          clientHeight: list.clientHeight,
        },
        row,
        !!anchor,
      );
      rec.buffer.add("wrong_landing", distance, room);
    }, LANDING_SETTLE_MS);
    return () => {
      clearTimeout(timer);
      for (const name of events) list.removeEventListener(name, touch);
    };
  }, [rec, openingReady, hasMessages, shown, room, listRef, openingAnchor, openingCancelled]);
}
