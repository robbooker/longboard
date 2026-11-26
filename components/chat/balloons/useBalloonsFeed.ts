"use client";
// #528 Gainer Balloons: the page's read of /api/chat/balloons. The whole day once, then only the
// newest bars about once a minute while the scene is on screen (never while the tab or the card is
// hidden), waiting longer after each failure (1, 2, 4, then 5 minutes). Coming back to the tab reads
// again at once when the last read is over a minute old.
import { useEffect, useRef, useState } from "react";
import { mergeFeed, type BalloonsFeed } from "@/lib/gainerBalloons/data";

export const FEED_REFRESH_MS = 60_000;
const FEED_MAX_WAIT_MS = 5 * 60_000;
/** Bars this recent are asked for again: the newest ones are still filling in. */
const REREAD_MS = 6 * 60_000;

export type FeedState = {
  feed: BalloonsFeed | null;
  /** loading: nothing yet. ready: a day to show. error: no answer yet and the last try failed. */
  status: "loading" | "ready" | "error";
  /** The server's clock minus this device's, so "now" is the market's now even on a wrong clock. */
  clockOffsetMs: number;
};

const testWait = () =>
  (process.env.NODE_ENV !== "production" &&
    (window as unknown as { __balloonsRefreshMsForTests?: number }).__balloonsRefreshMsForTests) ||
  FEED_REFRESH_MS;

export function useBalloonsFeed(active: boolean): FeedState {
  const [state, setState] = useState<FeedState>({ feed: null, status: "loading", clockOffsetMs: 0 });
  const held = useRef<BalloonsFeed | null>(null);
  const readAt = useRef(0);
  const failures = useRef(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async (whole: boolean): Promise<void> => {
      readAt.current = Date.now();
      const current = held.current;
      let since: number | null = null;
      if (!whole && current) {
        let newest = 0;
        for (const stock of current.stocks)
          newest = Math.max(newest, stock.bars[stock.bars.length - 1]?.[0] ?? 0);
        since = newest > 0 ? newest - REREAD_MS : null;
      }
      try {
        const response = await fetch(`/api/chat/balloons${since ? `?since=${since}` : ""}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          window.location.replace("/chat/login");
          return;
        }
        if (!response.ok) throw Error("unavailable");
        const answer = (await response.json()) as BalloonsFeed;
        if (controller.signal.aborted) return;
        const merged = mergeFeed(current, answer);
        // The newest bars didn't fit what is held (a new day, a new stock): read the whole day.
        if (!merged) return read(true);
        held.current = merged;
        failures.current = 0;
        setState({ feed: merged, status: "ready", clockOffsetMs: answer.now - Date.now() });
      } catch {
        if (controller.signal.aborted) return;
        failures.current += 1;
        setState((before) => (before.feed ? before : { ...before, status: "error" }));
      }
    };
    const wait = () => Math.min(FEED_MAX_WAIT_MS, testWait() * 2 ** Math.min(failures.current, 3));
    const loop = async (first: boolean) => {
      // Back on screen within a minute of the last read: wait out the rest of the minute.
      const due = readAt.current + wait() - Date.now();
      if (!first || !held.current || due <= 0) await read(!held.current);
      if (controller.signal.aborted) return;
      timer = setTimeout(() => void loop(false), first && held.current && due > 0 ? due : wait());
    };
    // Started a moment later, so an effect that is set up and torn down at once sends nothing.
    timer = setTimeout(() => void loop(true), 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active]);

  return state;
}
