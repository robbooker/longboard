"use client";

import EquityChart from "@/components/EquityChart";
import type { PerformanceSnapshot } from "@/lib/arena/types";

type Props = {
  snapshots: PerformanceSnapshot[];
  changeSign: 1 | -1 | 0;
};

export default function ArenaEquityChart({ snapshots, changeSign }: Props) {
  const points = snapshots.map((s) => ({
    snapshot_at: s.asOf,
    equity: s.equity,
  }));

  if (points.length === 0) {
    return (
      <div className="chart-wrap">
        <p className="feed-card-meta">No performance history yet.</p>
      </div>
    );
  }

  return (
    <div className="chart-wrap">
      <p className="chart-label">Equity curve</p>
      <EquityChart snapshots={points} changeSign={changeSign} height={240} />
    </div>
  );
}
