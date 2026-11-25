"use client";
// #502: whether the room on screen has live video. One small request for the room being viewed:
// shortly after it opens (or is switched to), when a "stage" signal for it arrives over Ably, and
// when the tab comes back after a while. Never on a timer and never for any other room. With live
// video not set up on the server (`room` null) nothing is asked at all.
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

export function useStageStatus(room: ChatRoom | null): {
  state: StageState;
  /** The server has answered for this room at least once. */
  answered: boolean;
  refresh: () => void;
  /** #507: the stock the host put on screen (null: none). Comes with the same answer and signal. */
  onScreen: string | null;
} {
  const [known, setKnown] = useState<{ room: ChatRoom; state: StageState; onScreen: StageOnScreen | null } | null>(null);
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
    };
    const check = () => {
      checkedAt = Date.now();
      fetch(`/api/chat/stage/status?room=${encodeURIComponent(room)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { state?: unknown; onScreen?: unknown } | null) => {
          if (controller.signal.aborted || !body) return;
          const state = parseStageState(body.state);
          const read = parseStageOnScreen(body.onScreen);
          setKnown((current) => {
            // Off: nothing is on screen. Otherwise the newest heard of, from an answer or a signal.
            const onScreen = state === "off" ? null : newerStageOnScreen(current?.room === room ? current.onScreen : null, read);
            return current?.room === room && current.state === state && current.onScreen === onScreen ? current : { room, state, onScreen };
          });
        })
        .catch(() => undefined);
    };
    read.current = check;
    later(check, AFTER_OPEN_MS);
    const signal = (event: Event) => {
      const detail = (event as CustomEvent<ChatStageEventDetail>).detail;
      if (detail?.room !== room) return;
      // #507: the host's stock comes with the signal: shown at once, before the status is asked again.
      const told = parseStageOnScreen(detail.onScreen);
      if (told)
        setKnown((current) => {
          if (current?.room !== room || current.state === "off") return current;
          const onScreen = newerStageOnScreen(current.onScreen, told);
          return onScreen === current.onScreen ? current : { ...current, onScreen };
        });
      check();
      later(check, SETTLE_MS);
    };
    const shown = () => {
      if (document.visibilityState === "visible" && Date.now() - checkedAt > STALE_MS) check();
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
  return { state: answered ? known.state : "off", answered, refresh, onScreen: answered ? (known.onScreen?.symbol ?? null) : null };
}
