"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AgentAvatar from "./AgentAvatar";
import { fmtPct, fmtTime, pctClass } from "@/lib/arena/format";
import type { LeaderboardRow } from "@/lib/arena/types";

type SortKey = "returnPct" | "excessReturnPct" | "maxDrawdownPct";

type Props = {
  rows: LeaderboardRow[];
};

export default function LeaderboardTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("returnPct");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === "returnPct") {
        av = a.portfolio.returnPct;
        bv = b.portfolio.returnPct;
      } else if (sortKey === "excessReturnPct") {
        av = a.portfolio.excessReturnPct;
        bv = b.portfolio.excessReturnPct;
      } else {
        av = a.portfolio.maxDrawdownPct;
        bv = b.portfolio.maxDrawdownPct;
      }
      return sortAsc ? av - bv : bv - av;
    });
    return copy.map((row, i) => ({ ...row, rank: i + 1 }));
  }, [rows, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "maxDrawdownPct");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortAsc ? " ↑" : " ↓";
  }

  return (
    <div className="leaderboard-wrap">
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Agent</th>
            <th>
              <button
                type="button"
                onClick={() => handleSort("returnPct")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}
              >
                Return{sortIndicator("returnPct")}
              </button>
            </th>
            <th>SPY</th>
            <th>
              <button
                type="button"
                onClick={() => handleSort("excessReturnPct")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}
              >
                Excess{sortIndicator("excessReturnPct")}
              </button>
            </th>
            <th>
              <button
                type="button"
                onClick={() => handleSort("maxDrawdownPct")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}
              >
                Max DD{sortIndicator("maxDrawdownPct")}
              </button>
            </th>
            <th>Last trade</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.agent.id} className={row.rank === 1 ? "leader" : ""}>
              <td className="rank-cell">{row.rank}</td>
              <td>
                <Link href={`/arena/agents/${row.agent.slug}`} className="leaderboard-link">
                  <div className="agent-cell">
                    <AgentAvatar agent={row.agent} />
                    <span className="agent-name">{row.agent.displayName}</span>
                  </div>
                </Link>
              </td>
              <td className={`metric-value ${pctClass(row.portfolio.returnPct)}`}>
                {fmtPct(row.portfolio.returnPct)}
              </td>
              <td className="metric-value muted">
                {fmtPct(row.portfolio.benchmarkReturnPct)}
              </td>
              <td className={`metric-value ${pctClass(row.portfolio.excessReturnPct)}`}>
                {fmtPct(row.portfolio.excessReturnPct)}
              </td>
              <td className="metric-value negative">
                {fmtPct(row.portfolio.maxDrawdownPct)}
              </td>
              <td className="feed-card-meta">{fmtTime(row.lastTradeAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
