"use client";
// #502: whether the room on screen has live video. One small request for the room being viewed:
// shortly after it opens (or is switched to), when a "stage" signal for it arrives over Ably, and
// when the tab comes back after a while. Never on a timer and never for any other room. With live
// video not set up on the server (`room` null) nothing is asked at all.
// #523:
//  - a signal that carries the stock the host put on screen asks nothing: the stock is in the signal;
//  - signals that arrive in a burst (a broadcast starting is several) ask once, and once more a few
//    seconds after the last of them;
//  - a read caused by something (a signal, the player, coming back to the tab, a stage link) says
//    so with `fresh=1`, so the server never answers it from its half-minute memory of "waiting"
//    (lib/chatStageVideo.ts STAGE_SETTLED_MEMORY_MS). Only the plain read when a room opens may be.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_STAGE_EVENT,
  newerStageOnScreen,
  parseStageOnScreen,
  parseStageState,
  type ChatStageEventDetail,
  type StageOnScreen,
  type StageState,
} from "@/lib/chatStageLive";
import type { ChatRoom } from "@/lib/publicChat";

/** After the room is on screen: the room's own reads go first, and a quick hop past a room asks nothing. */
const AFTER_OPEN_MS = 400;
/** A signal is followed by one more look, once every server has forgotten its few seconds' memory. */
const SETTLE_MS = 5_000;
/** A tab that comes back is asked again only if its answer is older than this. */
const STALE_MS = 30_000;
/** #523: signals closer together than this are one change: one read now, one settle read after the last. */
const SIGNAL_BURST_MS = 1_000;
/** The page was opened by a "Watch live" link: its first read must not be a remembered "waiting". */
const stageLinkOpened = () => new URL(window.location.href).searchParams.get("stage") === "1";

export function useStageStatus(room: ChatRoom | null): {
  state: StageState;
  /** The server has answered for this room at least once. */
  answered: boolean;
  refresh: () => void;
  /** #507: the stock the host put on screen (null: none). Comes with the same answer and signal. */
  onScreen: string | null;
  /**
   * #535: Booker Stock Club only: the server says the room's chat is open to members right now (a
   * webinar is live there, or stopped a moment ago and may come back; lib/chatClubLive.ts). It only
   * decides what the page shows: the server decides again, by itself, for every post.
   */
  chatOpen: boolean;
} {
  const [known, setKnown] = useState<{ room: ChatRoom; state: StageState; onScreen: StageOnScreen | null; chatOpen: boolean } | null>(null);
  const read = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!room) return;
    const controller = new AbortController();
    let checkedAt = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (run: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        run();
      }, ms);
      timers.add(timer);
      return timer;
    };
    const check = (fresh: boolean) => {
      checkedAt = Date.now();
      fetch(`/api/chat/stage/status?room=${encodeURIComponent(room)}${fresh ? "&fresh=1" : ""}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { state?: unknown; onScreen?: unknown; chat?: unknown } | null) => {
          if (controller.signal.aborted || !body) return;
          const state = parseStageState(body.state);
          const read = parseStageOnScreen(body.onScreen);
          const chatOpen = body.chat === true;
          setKnown((current) => {
            // Off: nothing is on screen. Otherwise the newest heard of, from an answer or a signal.
            const onScreen = state === "off" ? null : newerStageOnScreen(current?.room === room ? current.onScreen : null, read);
            return current?.room === room && current.state === state && current.onScreen === onScreen && current.chatOpen === chatOpen ? current : { room, state, onScreen, chatOpen };
          });
        })
        .catch(() => undefined);
    };
    read.current = () => check(true);
    later(() => check(stageLinkOpened()), AFTER_OPEN_MS);
    let signalledAt = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const signal = (event: Event) => {
      const detail = (event as CustomEvent<ChatStageEventDetail>).detail;
      if (detail?.room !== room) return;
      // #507: the host's stock comes with the signal and is shown at once. #523: and that is all:
      // the signal says nothing about the broadcast, so the status is not asked again for it.
      if (detail.onScreen) {
        const told = parseStageOnScreen(detail.onScreen);
        if (told)
          setKnown((current) => {
            if (current?.room !== room || current.state === "off") return current;
            const onScreen = newerStageOnScreen(current.onScreen, told);
            return onScreen === current.onScreen ? current : { ...current, onScreen };
          });
        return;
      }
      // #523: one read for a burst of signals, and one settle read after the last of them.
      const now = Date.now();
      if (now - signalledAt > SIGNAL_BURST_MS) check(true);
      signalledAt = now;
      if (settle) {
        clearTimeout(settle);
        timers.delete(settle);
      }
      settle = later(() => check(true), SETTLE_MS);
    };
    const shown = () => {
      if (document.visibilityState === "visible" && Date.now() - checkedAt > STALE_MS) check(true);
    };
    window.addEventListener(CHAT_STAGE_EVENT, signal);
    document.addEventListener("visibilitychange", shown);
    return () => {
      controller.abort();
      timers.forEach(clearTimeout);
      read.current = () => undefined;
      window.removeEventListener(CHAT_STAGE_EVENT, signal);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [room]);
  const refresh = useCallback(() => read.current(), []);
  // Another room's answer is never shown for this one.
  const answered = !!room && known?.room === room;
  return { state: answered ? known.state : "off", answered, refresh, onScreen: answered ? (known.onScreen?.symbol ?? null) : null, chatOpen: answered && known.chatOpen };
}
