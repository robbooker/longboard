"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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

export default function BackfilledChart({
  ticker,
  initialDate,
  resolution,
  initialBars,
  initialSessions,
}: Props) {
  const [bars, setBars] = useState(initialBars);
  const [sessions, setSessions] = useState<SessionBoundaries[]>([
    initialSessions,
  ]);
  const [oldestDate, setOldestDate] = useState(initialDate);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedDatesRef = useRef(new Set([initialDate]));

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
    </>
  );
}
