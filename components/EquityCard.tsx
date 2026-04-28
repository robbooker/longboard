"use client";

import { useEffect, useMemo, useState } from "react";
import EquityChart, { type EquityPoint } from "@/components/EquityChart";

type Broker = "alpaca" | "tradezero";
type Range = "1d" | "1w" | "1m" | "all";

type HistoryResponse = {
  broker: Broker;
  range: Range;
  snapshots: EquityPoint[];
  summary: {
    open: number | null;
    current: number | null;
    change: number | null;
    change_pct: number | null;
  };
};

type Props = {
  broker: Broker;
  /** Live equity from the parent's existing 5s poll. Drives the big number
   *  in the header so it ticks in sync with the Stat grid, without forcing
   *  the card to run its own polling loop. */
  liveEquity?: number | null;
};

const RANGES: Range[] = ["1d", "1w", "1m", "all"];

function fmtUsd(n: number | null, withSign = false): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = withSign && n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

export default function EquityCard({ broker, liveEquity }: Props) {
  const [range, setRange] = useState<Range>("1d");
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/equity/history?broker=${broker}&range=${range}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({ error: "invalid_json" }));
        return j as HistoryResponse & { error?: string };
      })
      .then((j: HistoryResponse & { error?: string }) => {
        if (cancelled) return;
        if (j.error) {
          setError(j.error);
          setData(null);
        } else {
          setError(null);
          setData(j);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [broker, range]);

  // Prefer parent's live equity for the header; fall back to summary.current
  // (which already includes the live append for range=1d server-side).
  const displayEquity = liveEquity ?? data?.summary.current ?? null;
  const change = data?.summary.change ?? null;
  const changePct = data?.summary.change_pct ?? null;
  const changeSign: 1 | -1 | 0 | null = change === null ? null : change > 0 ? 1 : change < 0 ? -1 : 0;

  const changeColor = useMemo(() => {
    if (changeSign === 1) return "var(--accent)";
    if (changeSign === -1) return "var(--danger)";
    return "var(--text-secondary)";
  }, [changeSign]);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "hidden",
        marginBottom: 20,
      }}
    >
      {/* Header strip: [Equity $X] ........ [Change +$Y +Z%] [1D|1W|1M|ALL] */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase" }}>Equity</span>
          <span style={{ fontSize: 22, fontWeight: 500, color: "var(--text-primary)" }}>
            {fmtUsd(displayEquity)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase" }}>Change</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: changeColor }}>
              {fmtUsd(change, true)}
            </span>
            <span style={{ fontSize: 12, color: changeColor }}>
              {fmtPct(changePct)}
            </span>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {RANGES.map((r) => {
              const active = r === range;
              return (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  style={{
                    background: active ? "var(--accent-15)" : "transparent",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                    padding: "4px 10px",
                    borderRadius: 3,
                    fontFamily: "var(--font-labels)",
                    fontSize: 10,
                    letterSpacing: 1.5,
                    cursor: "pointer",
                    textTransform: "uppercase",
                  }}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chart body */}
      <div style={{ padding: "12px 4px 4px" }}>
        {error ? (
          <div style={{ padding: 24, fontSize: 12, color: "var(--danger)", textAlign: "center" }}>
            Failed to load: {error}
          </div>
        ) : loading && !data ? (
          <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-secondary)", letterSpacing: 2 }}>
            LOADING…
          </div>
        ) : data && data.snapshots.length === 0 ? (
          <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase" }}>
            No snapshots yet for this range
          </div>
        ) : data ? (
          <EquityChart snapshots={data.snapshots} changeSign={changeSign} height={220} />
        ) : null}
      </div>
    </div>
  );
}
