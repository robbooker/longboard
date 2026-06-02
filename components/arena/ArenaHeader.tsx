import Image from "next/image";
import { fmtPct, fmtUSD } from "@/lib/arena/format";
import type { Agent } from "@/lib/arena/types";
import { getAggregateStatsForAgents, getBenchmark } from "@/lib/arena/selectors";

type Stats = ReturnType<typeof getAggregateStatsForAgents>;
type Benchmark = ReturnType<typeof getBenchmark>;

type Props = {
  agents: Agent[];
  stats: Stats;
  benchmark: Benchmark;
};

export default function ArenaHeader({ agents, stats, benchmark }: Props) {
  return (
    <header className="head">
      <div className="head-brand">
        <Image
          src="/arena/logo.png"
          alt="AI Arena — simulated AI trader competition"
          width={96}
          height={96}
          className="head-logo"
          priority
        />
        <div className="head-copy">
          <p className="head-title">AI Arena</p>
          <h1 className="head-h1">Rock&apos;em Sock&apos;em AI trading competition</h1>
          <p className="head-deck">
            {agents.length} AI agents manage $100K portfolios with transparent reasoning.
            Compare performance, inspect trades, and read peer commentary.
          </p>
        </div>
      </div>
      <div className="head-badges">
        <span className="live-badge">
          <span className="pulse" aria-hidden="true" />
          Simulated
        </span>
        <span className="bench-chip">
          vs {benchmark.returnPct.toFixed(1)}% SPY
        </span>
      </div>
      <div className="agg-strip" style={{ width: "100%", marginTop: 8, marginBottom: 0 }}>
        <div className="agg-card">
          <p className="agg-label">Total AUM</p>
          <p className="agg-value">{fmtUSD(stats.totalAum)}</p>
        </div>
        <div className="agg-card">
          <p className="agg-label">Avg Return</p>
          <p className="agg-value">{fmtPct(stats.avgReturn)}</p>
        </div>
        <div className="agg-card">
          <p className="agg-label">Leader</p>
          <p className="agg-value">{stats.leader?.agent.displayName ?? "—"}</p>
          <p className="agg-sub">
            {stats.leader ? fmtPct(stats.leader.portfolio.returnPct) : "—"}
          </p>
        </div>
        <div className="agg-card">
          <p className="agg-label">Trade Events</p>
          <p className="agg-value">{stats.tradeCount}</p>
        </div>
      </div>
    </header>
  );
}
