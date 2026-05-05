"use client";

import type {
  ConnectionStateChange,
  InboundMessage,
  Realtime,
  RealtimeChannel,
  TokenRequest,
} from "ably";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "@/lib/polygon/types";
import {
  rossCameronMomentum,
  rvolLookbackForResolution,
} from "@/lib/indicators";
import type { Resolution } from "@/lib/polygon/bars";
import type { SessionBoundaries } from "@/lib/time/sessionBoundaries";
import ChartView from "./ChartView";

type BarsResponse = {
  date: string;
  bars: Bar[];
  sessions: SessionBoundaries;
};

type Props = {
  ticker: string;
  initialDate: string;
  resolution: Resolution;
  initialBars: Bar[];
  initialSessions: SessionBoundaries;
  realtime?: {
    enabled: boolean;
  };
};

type RealtimeStatus = "connecting" | "live" | "reconnecting" | "paused";

type RealtimeBar = Bar & {
  type?: "bar";
  symbol?: string;
  resolution?: Resolution;
};

function previousWeekday(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function fetchBars(
  ticker: string,
  date: string,
  resolution: Resolution,
): Promise<BarsResponse> {
  const params = new URLSearchParams({ ticker, date });
  if (resolution !== "1m") params.set("res", resolution);
  const res = await fetch(`/api/polygon/bars?${params.toString()}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : `bars request failed (${res.status})`,
    );
  }
  return data as BarsResponse;
}

function isRealtimeBar(value: unknown): value is RealtimeBar {
  if (!value || typeof value !== "object") return false;
  const bar = value as Partial<RealtimeBar>;
  return (
    typeof bar.time === "number" &&
    typeof bar.open === "number" &&
    typeof bar.high === "number" &&
    typeof bar.low === "number" &&
    typeof bar.close === "number" &&
    typeof bar.volume === "number"
  );
}

function mergeRealtimeBar(current: Bar[], incoming: Bar): Bar[] {
  if (current.length === 0) return [incoming];

  const existingIndex = current.findIndex((bar) => bar.time === incoming.time);
  if (existingIndex >= 0) {
    return current.map((bar, index) =>
      index === existingIndex ? incoming : bar,
    );
  }

  const last = current[current.length - 1];
  if (incoming.time <= last.time) return current;

  return [...current, incoming];
}

function mergeBarSet(current: Bar[], incoming: Bar[]): Bar[] {
  if (incoming.length === 0) return current;

  const byTime = new Map(current.map((bar) => [bar.time, bar]));
  for (const bar of incoming) {
    byTime.set(bar.time, bar);
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

function realtimeLabel(status: RealtimeStatus): string {
  if (status === "live") return "LIVE";
  if (status === "reconnecting") return "RECONNECTING";
  if (status === "connecting") return "CONNECTING";
  return "PAUSED";
}

async function requestRealtimeToken(
  ticker: string,
  resolution: Resolution,
): Promise<TokenRequest> {
  const res = await fetch(
    `/api/ably/chart-token?symbol=${encodeURIComponent(
      ticker,
    )}&res=${encodeURIComponent(resolution)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : `realtime auth failed (${res.status})`;
    throw new Error(message);
  }

  return data as TokenRequest;
}

export default function BackfilledChart({
  ticker,
  initialDate,
  resolution,
  initialBars,
  initialSessions,
  realtime,
}: Props) {
  const [bars, setBars] = useState(initialBars);
  const [sessions, setSessions] = useState<SessionBoundaries[]>([
    initialSessions,
  ]);
  const [oldestDate, setOldestDate] = useState(initialDate);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeStatus>("paused");
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const loadedDatesRef = useRef(new Set([initialDate]));
  const realtimeEnabled = realtime?.enabled ?? false;
  const showRealtimeStatus = Boolean(realtime);

  const indicator = useMemo(
    () =>
      rossCameronMomentum(bars, {
        rvolLookback: rvolLookbackForResolution(resolution),
      }),
    [bars, resolution],
  );

  const loadOlder = useCallback(async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    setError(null);

    let cursor = oldestDate;
    try {
      for (let attempts = 0; attempts < 5; attempts++) {
        const candidate = previousWeekday(cursor);
        cursor = candidate;
        if (loadedDatesRef.current.has(candidate)) continue;
        loadedDatesRef.current.add(candidate);

        const data = await fetchBars(ticker, candidate, resolution);
        if (data.bars.length === 0) continue;

        setBars((current) => [...data.bars, ...current]);
        setSessions((current) => [data.sessions, ...current]);
        setOldestDate(candidate);
        return;
      }
      setOldestDate(cursor);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, oldestDate, resolution, ticker]);

  useEffect(() => {
    if (!showRealtimeStatus) return;
    if (!realtimeEnabled) {
      setRealtimeStatus("paused");
      setRealtimeError(null);
      return;
    }

    let cancelled = false;
    setRealtimeStatus("connecting");
    setRealtimeError(null);

    const channelName = `private:chart:${ticker}:1m`;
    let client: Realtime | null = null;
    let channel: RealtimeChannel | null = null;

    const handleMessage = (message: InboundMessage) => {
      if (cancelled || !isRealtimeBar(message.data)) return;
      const bar = message.data;
      if (bar.symbol && bar.symbol.toUpperCase() !== ticker) return;
      if (bar.resolution && bar.resolution !== resolution) return;

      setBars((current) =>
        mergeRealtimeBar(current, {
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        }),
      );
    };

    const handleConnected = () => {
      if (!cancelled) {
        setRealtimeStatus("live");
        setRealtimeError(null);
      }
    };
    const handleReconnecting = (change: ConnectionStateChange) => {
      if (!cancelled) {
        setRealtimeStatus("reconnecting");
        setRealtimeError(change.reason?.message ?? "Trying to reconnect");
      }
    };
    const handleFailed = (change: ConnectionStateChange) => {
      if (cancelled) return;
      setRealtimeStatus("paused");
      setRealtimeError(change.reason?.message ?? "Realtime connection failed");
    };

    void (async () => {
      try {
        const { Realtime: AblyRealtime } = await import("ably");
        if (cancelled) return;

        client = new AblyRealtime({
          authCallback: async (_tokenParams, callback) => {
            try {
              const tokenRequest = await requestRealtimeToken(
                ticker,
                resolution,
              );
              callback(null, tokenRequest);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              callback(message, null);
            }
          },
          autoConnect: true,
        });
        channel = client.channels.get(channelName);

        client.connection.on("connected", handleConnected);
        client.connection.on("disconnected", handleReconnecting);
        client.connection.on("suspended", handleReconnecting);
        client.connection.on("failed", handleFailed);

        await channel.subscribe("bar", handleMessage);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setRealtimeStatus("paused");
        setRealtimeError(message);
      }
    })();

    return () => {
      cancelled = true;
      channel?.unsubscribe("bar", handleMessage);
      client?.connection.off("connected", handleConnected);
      client?.connection.off("disconnected", handleReconnecting);
      client?.connection.off("suspended", handleReconnecting);
      client?.connection.off("failed", handleFailed);
      client?.close();
    };
  }, [realtimeEnabled, resolution, showRealtimeStatus, ticker]);

  useEffect(() => {
    if (!showRealtimeStatus || !realtimeEnabled || realtimeStatus === "live") {
      return;
    }

    let cancelled = false;
    const refreshBars = async () => {
      try {
        const data = await fetchBars(ticker, initialDate, resolution);
        if (cancelled) return;
        setBars((current) => mergeBarSet(current, data.bars));
        setSessions((current) => {
          const rest = current.filter(
            (s) => s.pmStart !== data.sessions.pmStart,
          );
          return [...rest, data.sessions].sort((a, b) => a.pmStart - b.pmStart);
        });
      } catch {
        // Realtime status already carries the visible connection state.
      }
    };

    const id = window.setInterval(refreshBars, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    initialDate,
    realtimeEnabled,
    realtimeStatus,
    resolution,
    showRealtimeStatus,
    ticker,
  ]);

  return (
    <>
      <ChartView
        bars={bars}
        indicator={indicator}
        sessions={sessions}
        onLoadOlder={loadOlder}
        loadingOlder={loadingOlder}
      />
      {(loadingOlder || error) && (
        <div className="lab-chart-backfill-status">
          {loadingOlder ? "Loading previous session..." : error}
        </div>
      )}
      {showRealtimeStatus && (
        <div
          className={`lab-chart-realtime-status lab-chart-realtime-status--${realtimeStatus}`}
        >
          <span>{realtimeLabel(realtimeStatus)}</span>
          {realtimeError && <small>{realtimeError}</small>}
        </div>
      )}
    </>
  );
}
