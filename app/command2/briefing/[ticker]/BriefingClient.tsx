"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BriefingApiResponse,
  StockBriefingRow,
} from "@/lib/briefings/types";
import BriefingPage from "./BriefingPage";
import WaitingState from "./WaitingState";

type Phase =
  | { kind: "initial" }
  | { kind: "waiting"; startedAt: number }
  | { kind: "ready"; briefing: StockBriefingRow }
  | { kind: "error"; message: string }
  | { kind: "timeout" };

const POLL_MS = 3_000;
const TIMEOUT_MS = 5 * 60 * 1000;

export default function BriefingClient({ ticker }: { ticker: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "initial" });
  const [retryNonce, setRetryNonce] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setPhase({ kind: "initial" });

    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const requestBriefing = async (): Promise<BriefingApiResponse> => {
      const r = await fetch("/api/briefings/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker }),
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`request failed: ${r.status}`);
      return (await r.json()) as BriefingApiResponse;
    };

    const fetchStatus = async (): Promise<BriefingApiResponse> => {
      const r = await fetch(
        `/api/briefings/status?ticker=${encodeURIComponent(ticker)}`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error(`status failed: ${r.status}`);
      return (await r.json()) as BriefingApiResponse;
    };

    const apply = (res: BriefingApiResponse): "stop" | "poll" | "repost" => {
      if (res.status === "ready") {
        setPhase({ kind: "ready", briefing: res.briefing });
        return "stop";
      }
      if (res.status === "error") {
        setPhase({ kind: "error", message: res.error_message });
        return "stop";
      }
      if (res.status === "queued" || res.status === "pending") {
        setPhase((prev) =>
          prev.kind === "waiting" ? prev : { kind: "waiting", startedAt },
        );
        return "poll";
      }
      // not_requested — should be impossible after a successful POST. Re-queue.
      return "repost";
    };

    const tick = async () => {
      if (cancelledRef.current) return;
      try {
        const res = await fetchStatus();
        if (cancelledRef.current) return;
        const next = apply(res);
        if (next === "poll") {
          pollTimer = setTimeout(tick, POLL_MS);
        } else if (next === "repost") {
          const reposted = await requestBriefing();
          if (cancelledRef.current) return;
          if (apply(reposted) === "poll") {
            pollTimer = setTimeout(tick, POLL_MS);
          }
        }
      } catch (err) {
        if (cancelledRef.current) return;
        console.error("[briefing] poll failed", err);
        pollTimer = setTimeout(tick, POLL_MS);
      }
    };

    (async () => {
      try {
        const initial = await requestBriefing();
        if (cancelledRef.current) return;
        const next = apply(initial);
        if (next === "poll") {
          pollTimer = setTimeout(tick, POLL_MS);
          timeoutTimer = setTimeout(() => {
            if (cancelledRef.current) return;
            setPhase((prev) =>
              prev.kind === "waiting" ? { kind: "timeout" } : prev,
            );
            if (pollTimer) {
              clearTimeout(pollTimer);
              pollTimer = null;
            }
          }, TIMEOUT_MS);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        console.error("[briefing] initial request failed", err);
        setPhase({
          kind: "error",
          message:
            "We couldn't reach the briefing service. Try again in a moment.",
        });
      }
    })();

    return () => {
      cancelledRef.current = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
  }, [ticker, retryNonce]);

  const handleRetry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  if (phase.kind === "ready") {
    return <BriefingPage briefing={phase.briefing} />;
  }

  if (phase.kind === "error") {
    return (
      <div className="err-wrap">
        <div className="err-card">
          <div className="eyebrow">BRIEFING ERROR · {ticker}</div>
          <h1>Buddy hit a snag.</h1>
          <p className="msg">{phase.message}</p>
          <button type="button" className="retry" onClick={handleRetry}>
            Request again
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === "timeout") {
    return (
      <div className="err-wrap">
        <div className="err-card">
          <div className="eyebrow">TAKING LONGER THAN USUAL · {ticker}</div>
          <h1>This one&rsquo;s running long.</h1>
          <p className="msg">
            Buddy normally finishes in about a minute. We&rsquo;ve been waiting
            five minutes — the worker may be backed up. Try again, or check back
            shortly.
          </p>
          <button type="button" className="retry" onClick={handleRetry}>
            Request again
          </button>
        </div>
      </div>
    );
  }

  // initial + waiting share the same UI; the brief "initial" beat just shows
  // the same waiting frame at 0:00.
  const startedAt = phase.kind === "waiting" ? phase.startedAt : Date.now();
  return <WaitingState ticker={ticker} startedAt={startedAt} />;
}
