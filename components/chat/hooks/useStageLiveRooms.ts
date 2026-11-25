"use client";
// #505: which of the rooms on a Dual, Quad or Six view's cards have live video, for the cards'
// "LIVE · Watch live" button. One hook for the whole page, never one per card and never on a timer:
//  - one request for all the cards' rooms shortly after the page opens (and for a room newly put
//    on a card, unless it was answered in the last half minute);
//  - one for a room when its "stage" signal arrives over Ably (the page already listens to every
//    room's channel), and one more a few seconds later, as the single room view does;
//  - one for all of them when the tab comes back after a while.
// Requests wanted at the same moment go out as one. With live video not set up on the server
// (`rooms` null) nothing is asked at all.
import { useEffect, useMemo, useRef, useState } from "react";
import { CHAT_STAGE_EVENT, parseStageState, type ChatStageEventDetail, type StageState } from "@/lib/chatStageLive";
import type { ChatRoom } from "@/lib/publicChat";

/** After the cards are on screen: their own reads go first. */
const AFTER_OPEN_MS = 600;
/** Rooms wanted within this long of each other are asked together. */
const TOGETHER_MS = 50;
/** A signal is followed by one more look, once every server has forgotten its few seconds' memory. */
const SETTLE_MS = 5_000;
/** An answer older than this is asked again when the tab comes back, or the room returns to a card. */
const STALE_MS = 30_000;

const NONE: ReadonlySet<ChatRoom> = new Set();

export function useStageLiveRooms(rooms: readonly ChatRoom[] | null): ReadonlySet<ChatRoom> {
  const key = rooms ? [...new Set(rooms)].sort().join(",") : "";
  const known = useRef(new Map<string, { state: StageState; at: number }>());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!key) return;
    const shown = key.split(",");
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (run: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        run();
      }, ms);
      timers.add(timer);
    };
    const wanted = new Set<string>();
    const ask = () => {
      const asking = [...wanted];
      wanted.clear();
      if (!asking.length) return;
      const at = Date.now();
      fetch(`/api/chat/stage/status?rooms=${asking.map(encodeURIComponent).join(",")}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { states?: Record<string, unknown> } | null) => {
          if (controller.signal.aborted || !body?.states) return;
          let changed = false;
          for (const room of asking) {
            // A room left out of the answer is one this member cannot read: never live here.
            const state = parseStageState(body.states[room]);
            if (known.current.get(room)?.state !== state) changed = true;
            known.current.set(room, { state, at });
          }
          if (changed) setVersion((value) => value + 1);
        })
        .catch(() => undefined);
    };
    const want = (list: readonly string[], wait = TOGETHER_MS) => {
      if (!list.length) return;
      const first = wanted.size === 0;
      list.forEach((room) => wanted.add(room));
      if (first) later(ask, wait);
    };
    const old = (room: string) => Date.now() - (known.current.get(room)?.at ?? 0) > STALE_MS;
    want(shown.filter(old), AFTER_OPEN_MS);
    const signal = (event: Event) => {
      const room = (event as CustomEvent<ChatStageEventDetail>).detail?.room;
      if (!room) return;
      // A room on no card: what was known about it is out of date now.
      if (!shown.includes(room)) return void known.current.delete(room);
      want([room]);
      later(() => want([room]), SETTLE_MS);
    };
    const back = () => {
      if (document.visibilityState === "visible") want(shown.filter(old));
    };
    window.addEventListener(CHAT_STAGE_EVENT, signal);
    document.addEventListener("visibilitychange", back);
    return () => {
      controller.abort();
      timers.forEach(clearTimeout);
      window.removeEventListener(CHAT_STAGE_EVENT, signal);
      document.removeEventListener("visibilitychange", back);
    };
  }, [key]);
  return useMemo(() => {
    void version;
    const live = key.split(",").filter((room) => known.current.get(room)?.state === "live") as ChatRoom[];
    return live.length ? new Set(live) : NONE;
  }, [key, version]);
}
