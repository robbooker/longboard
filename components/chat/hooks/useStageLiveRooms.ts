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
// #523:
//  - the video-only cards (LiveVideoCard) read their room's state from this same reader, through
//    StageRoomsContext, instead of each asking for itself;
//  - a signal that only carries the stock on screen asks nothing; a burst of signals for a room
//    asks once, and once more a few seconds after the last;
//  - a read caused by something (a signal, a card's player, coming back to the tab) says so with
//    `fresh=1`, so the server never answers it from its half-minute memory of "waiting".
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
/** #523: signals for one room closer together than this are one change. */
const SIGNAL_BURST_MS = 1_000;

const NONE: ReadonlySet<ChatRoom> = new Set();

export type StageRooms = {
  /** The rooms that are live now. */
  live: ReadonlySet<ChatRoom>;
  /** One room's state as last answered ("off" until it is), and whether it has been answered. */
  of: (room: ChatRoom) => { state: StageState; answered: boolean };
  /** Ask about one room again now (a card's player saw the broadcast arrive, drop or refuse it). */
  refresh: (room: ChatRoom) => void;
};
const NOTHING: StageRooms = { live: NONE, of: () => ({ state: "off", answered: false }), refresh: () => undefined };

/** #523: the page's one reader, for the cards inside it (a video-only card reads its room here). */
export const StageRoomsContext = createContext<StageRooms>(NOTHING);
export const useStageRoomsContext = () => useContext(StageRoomsContext);

export function useStageLiveRooms(rooms: readonly ChatRoom[] | null): StageRooms {
  const key = rooms ? [...new Set(rooms)].sort().join(",") : "";
  const known = useRef(new Map<string, { state: StageState; at: number }>());
  const [version, setVersion] = useState(0);
  const ask = useRef<(room: string) => void>(() => undefined);
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
      return timer;
    };
    const wanted = new Set<string>();
    let wantedFresh = false;
    const send = () => {
      const asking = [...wanted];
      const fresh = wantedFresh;
      wanted.clear();
      wantedFresh = false;
      if (!asking.length) return;
      const at = Date.now();
      fetch(`/api/chat/stage/status?rooms=${asking.map(encodeURIComponent).join(",")}${fresh ? "&fresh=1" : ""}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { states?: Record<string, unknown> } | null) => {
          if (controller.signal.aborted || !body?.states) return;
          let changed = false;
          for (const room of asking) {
            // A room left out of the answer is one this member cannot read: never live here.
            const state = parseStageState(body.states[room]);
            const before = known.current.get(room);
            if (!before || before.state !== state) changed = true;
            known.current.set(room, { state, at });
          }
          if (changed) setVersion((value) => value + 1);
        })
        .catch(() => undefined);
    };
    const want = (list: readonly string[], fresh: boolean, wait = TOGETHER_MS) => {
      if (!list.length) return;
      const first = wanted.size === 0;
      list.forEach((room) => wanted.add(room));
      wantedFresh ||= fresh;
      if (first) later(send, wait);
    };
    const old = (room: string) => Date.now() - (known.current.get(room)?.at ?? 0) > STALE_MS;
    want(shown.filter(old), false, AFTER_OPEN_MS);
    ask.current = (room) => {
      if (shown.includes(room)) want([room], true);
    };
    const signalled = new Map<string, { at: number; settle?: ReturnType<typeof setTimeout> }>();
    const signal = (event: Event) => {
      const detail = (event as CustomEvent<ChatStageEventDetail>).detail;
      const room = detail?.room;
      // #523: the stock on screen says nothing about the broadcast (and a card does not show it).
      if (!room || detail.onScreen) return;
      // A room on no card: what was known about it is out of date now.
      if (!shown.includes(room)) return void known.current.delete(room);
      // #523: one read for a burst of signals, and one settle read after the last of them.
      const now = Date.now();
      const last = signalled.get(room);
      if (!last || now - last.at > SIGNAL_BURST_MS) want([room], true);
      if (last?.settle) {
        clearTimeout(last.settle);
        timers.delete(last.settle);
      }
      signalled.set(room, { at: now, settle: later(() => want([room], true), SETTLE_MS) });
    };
    const back = () => {
      if (document.visibilityState === "visible") want(shown.filter(old), true);
    };
    window.addEventListener(CHAT_STAGE_EVENT, signal);
    document.addEventListener("visibilitychange", back);
    return () => {
      controller.abort();
      timers.forEach(clearTimeout);
      ask.current = () => undefined;
      window.removeEventListener(CHAT_STAGE_EVENT, signal);
      document.removeEventListener("visibilitychange", back);
    };
  }, [key]);
  return useMemo(() => {
    void version;
    if (!key) return NOTHING;
    const shown = key.split(",");
    const live = shown.filter((room) => known.current.get(room)?.state === "live") as ChatRoom[];
    return {
      live: live.length ? new Set(live) : NONE,
      of: (room) => {
        const answer = shown.includes(room) ? known.current.get(room) : undefined;
        return { state: answer?.state ?? "off", answered: !!answer };
      },
      refresh: (room) => ask.current(room),
    };
  }, [key, version]);
}
