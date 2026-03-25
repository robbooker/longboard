"use client";

import Link from "next/link";

/* ═══ Data ═════════════════════════════════════════════════════════════ */

const RESULTS = [
  { month: "November", label: "TRAIN", n: 52, wins: 13, wr: "25.0%", pnl: "+$2,797.58", pf: "13.91", color: "#a78bfa", bg: "#2d1b4e" },
  { month: "December", label: "OOS", n: 73, wins: 13, wr: "17.8%", pnl: "+$2,351.82", pf: "2.64", color: "#67e8f9", bg: "#1b3a4e" },
  { month: "January", label: "OOS", n: 38, wins: 0, wr: "0.0%", pnl: "-$977.25", pf: "0.00", color: "#6ee7b7", bg: "#1b4e2d" },
  { month: "Feb-Mar", label: "OOS", n: 26, wins: 9, wr: "34.6%", pnl: "+$1,830.95", pf: "4.16", color: "#fbbf24", bg: "#4e3a1b" },
];

const BUCKETS = {
  "10-25%": [
    { month: "Nov", n: 10, wr: "10%", pnl: "+$89", pf: "10.00" },
    { month: "Dec", n: 13, wr: "23%", pnl: "+$708", pf: "7.81" },
    { month: "Jan", n: 8, wr: "0%", pnl: "-$72", pf: "0.00" },
    { month: "Feb-Mar", n: 7, wr: "43%", pnl: "+$372", pf: "10.00" },
  ],
  "25-50%": [
    { month: "Nov", n: 17, wr: "29%", pnl: "+$1,168", pf: "13.06" },
    { month: "Dec", n: 18, wr: "17%", pnl: "+$1,884", pf: "8.55" },
    { month: "Jan", n: 19, wr: "0%", pnl: "-$656", pf: "0.00" },
    { month: "Feb-Mar", n: 11, wr: "54%", pnl: "+$1,540", pf: "4.09" },
  ],
  "50%+": [
    { month: "Nov", n: 25, wr: "28%", pnl: "+$1,540", pf: "13.85" },
    { month: "Dec", n: 42, wr: "17%", pnl: "-$240", pf: "0.78" },
    { month: "Jan", n: 11, wr: "0%", pnl: "-$249", pf: "0.00" },
    { month: "Feb-Mar", n: 8, wr: "0%", pnl: "-$81", pf: "0.00" },
  ],
};

const FINDINGS = [
  { icon: "1", color: "#4ade80", title: "25-50% gap bucket is the sweet spot", desc: "Consistently profitable across Nov, Dec, and Feb-Mar. Best balance of trade frequency and win quality." },
  { icon: "!", color: "#f87171", title: "January 2026: 0% win rate — total wipeout", desc: "38 trades, zero winners. Every gapper that dropped and popped just kept dropping. Market regime anomaly worth investigating." },
  { icon: "2", color: "#fbbf24", title: "50%+ gappers unreliable in validation", desc: "Strong in Nov training (+$1,540) but net negative in Dec (-$240), Jan (-$249), and Feb-Mar (-$81). Likely overfitted." },
  { icon: "3", color: "#60a5fa", title: "Best OOS: +$3,206 out-of-sample total", desc: "Config d5%/p1%/w60m/s25%/be@3% produced +$2,352 (Dec) + -$977 (Jan) + +$1,831 (Feb-Mar) = +$3,206 net OOS." },
];

/* ═══ Styles ═══════════════════════════════════════════════════════════ */

const PAGE: React.CSSProperties = {
  background: "#0a0a0f",
  color: "#e0e0e0",
  fontFamily: "'IBM Plex Mono', monospace",
  minHeight: "100vh",
};

const HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 20px",
  background: "#12121a",
  borderBottom: "1px solid #1e1e2e",
};

const LINK: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  color: "#6b8afd",
  textDecoration: "none",
  padding: "5px 12px",
  border: "1px solid #2a2a3e",
  borderRadius: 4,
};

const SECTION: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "32px 24px",
};

const CARD: React.CSSProperties = {
  background: "#12121e",
  border: "1px solid #1e1e2e",
  borderRadius: 6,
  padding: 24,
  marginBottom: 24,
};

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13,
};

const TH: React.CSSProperties = {
  textAlign: "left" as const,
  padding: "10px 12px",
  borderBottom: "2px solid #2a2a3e",
  color: "#666",
  fontSize: 10,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
};

const TD: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #1e1e2e",
  color: "#ccc",
};

/* ═══ Page ═════════════════════════════════════════════════════════════ */

export default function RulesPage() {
  return (
    <div style={PAGE}>
      {/* Header */}
      <div style={HEADER}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, color: "#888", fontWeight: 500, letterSpacing: 1, margin: 0 }}>
            DROP &amp; POP — RULES &amp; RESULTS
          </h1>
          <Link href="/research/drop-and-pop" style={LINK}>
            &larr; TRADE VIEWER
          </Link>
          <Link href="/" style={LINK}>
            HOME
          </Link>
        </div>
      </div>

      <div style={SECTION}>
        {/* ─── Strategy Rules ──────────────────────────────────── */}
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "#4ade80", marginBottom: 20, letterSpacing: 2 }}>
          STRATEGY RULES
        </h2>

        <div style={CARD}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Universe &amp; Filters</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[
                  "Stocks that gap UP 10%+ premarket",
                  "No warrants, SPACs, or preferred shares",
                  "Price at 8:30am >= $1.00",
                  "Market cap <= $100M (when available)",
                  "All qualifying gappers included — no staircase filter",
                ].map((rule, i) => (
                  <li key={i} style={{ padding: "6px 0", borderBottom: "1px solid #1e1e2e", fontSize: 13, color: "#ccc", display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ color: "#4ade80", fontSize: 10 }}>&#9654;</span> {rule}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Entry Logic</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[
                  "Wait for market open at 9:30am ET",
                  "Stock must drop 5% below the opening price",
                  "Entry window: 60 minutes from open (by 10:30am)",
                  "Once dropped, enter LONG when price pops 1% off the drop low",
                  "Position size: $1,000 per trade",
                ].map((rule, i) => (
                  <li key={i} style={{ padding: "6px 0", borderBottom: "1px solid #1e1e2e", fontSize: 13, color: "#ccc", display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ color: "#60a5fa", fontSize: 10 }}>&#9654;</span> {rule}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Exit Rules</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[
                  "Stop loss: 25% below entry price",
                  "Once price hits +3% profit, stop moves to breakeven (entry price)",
                  "Hold until stop is hit or end of day (3:55pm)",
                  "No pyramid — single entry only",
                ].map((rule, i) => (
                  <li key={i} style={{ padding: "6px 0", borderBottom: "1px solid #1e1e2e", fontSize: 13, color: "#ccc", display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ color: "#fbbf24", fontSize: 10 }}>&#9654;</span> {rule}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Config Identifier</h3>
              <div style={{ background: "#1a1a24", borderRadius: 4, padding: 16, fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, color: "#4ade80" }}>
                d5%_p1%_w60m_s25%_be@3%_none
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                <strong style={{ color: "#aaa" }}>Trained on:</strong> November 2025<br />
                <strong style={{ color: "#aaa" }}>Validated on:</strong> December 2025, January 2026, Feb-Mar 2026<br />
                <strong style={{ color: "#aaa" }}>Combos tested:</strong> 2,160 total parameter combinations<br />
                <strong style={{ color: "#aaa" }}>Rank:</strong> #6 by Profit Factor on training data
              </div>
            </div>
          </div>
        </div>

        {/* ─── Results ─────────────────────────────────────────── */}
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "#60a5fa", marginBottom: 20, letterSpacing: 2, marginTop: 40 }}>
          RESULTS
        </h2>

        {/* Monthly summary table */}
        <div style={CARD}>
          <h3 style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
            Monthly Performance
          </h3>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Month</th>
                <th style={TH}>Type</th>
                <th style={TH}>Trades</th>
                <th style={TH}>Wins</th>
                <th style={TH}>Win Rate</th>
                <th style={TH}>P&amp;L</th>
                <th style={TH}>Profit Factor</th>
              </tr>
            </thead>
            <tbody>
              {RESULTS.map((r) => (
                <tr key={r.month}>
                  <td style={TD}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 1, background: r.bg, color: r.color }}>
                      {r.month.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ ...TD, color: "#666", fontSize: 11 }}>{r.label}</td>
                  <td style={TD}>{r.n}</td>
                  <td style={TD}>{r.wins}</td>
                  <td style={{ ...TD, color: r.wins === 0 ? "#f87171" : "#ccc" }}>{r.wr}</td>
                  <td style={{ ...TD, color: r.pnl.startsWith("+") ? "#4ade80" : "#f87171", fontWeight: 700 }}>{r.pnl}</td>
                  <td style={{ ...TD, color: parseFloat(r.pf) >= 1.5 ? "#4ade80" : parseFloat(r.pf) === 0 ? "#f87171" : "#ccc" }}>{r.pf}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #2a2a3e" }}>
                <td style={{ ...TD, fontWeight: 700 }}>TOTAL</td>
                <td style={TD}></td>
                <td style={{ ...TD, fontWeight: 700 }}>189</td>
                <td style={{ ...TD, fontWeight: 700 }}>35</td>
                <td style={{ ...TD, fontWeight: 700 }}>18.5%</td>
                <td style={{ ...TD, fontWeight: 700, color: "#4ade80" }}>+$6,003.10</td>
                <td style={TD}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Gap bucket breakdown */}
        <div style={CARD}>
          <h3 style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
            Gap Bucket Breakdown
          </h3>
          {(Object.entries(BUCKETS) as [string, typeof BUCKETS["10-25%"]][]).map(([bucket, months]) => (
            <div key={bucket} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: bucket === "25-50%" ? "#fbbf24" : bucket === "50%+" ? "#4ade80" : "#888", marginBottom: 8 }}>
                {bucket} Gap
                {bucket === "25-50%" && <span style={{ fontSize: 10, color: "#fbbf24", marginLeft: 8, fontWeight: 400 }}>&#9733; sweet spot</span>}
              </div>
              <table style={TABLE}>
                <thead>
                  <tr>
                    <th style={TH}>Month</th>
                    <th style={TH}>N</th>
                    <th style={TH}>Win Rate</th>
                    <th style={TH}>P&amp;L</th>
                    <th style={TH}>PF</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month}>
                      <td style={TD}>{m.month}</td>
                      <td style={TD}>{m.n}</td>
                      <td style={{ ...TD, color: m.wr === "0%" ? "#f87171" : "#ccc" }}>{m.wr}</td>
                      <td style={{ ...TD, color: m.pnl.startsWith("+") ? "#4ade80" : "#f87171", fontWeight: 600 }}>{m.pnl}</td>
                      <td style={{ ...TD, color: parseFloat(m.pf) >= 1.5 ? "#4ade80" : parseFloat(m.pf) === 0 ? "#f87171" : "#ccc" }}>{m.pf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* Key findings */}
        <div style={CARD}>
          <h3 style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
            Key Findings
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {FINDINGS.map((f) => (
              <div key={f.title} style={{ background: "#1a1a24", border: `1px solid ${f.color}33`, borderRadius: 6, padding: 16, borderLeft: `3px solid ${f.color}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: f.color, marginBottom: 6 }}>
                  {f.title}
                </div>
                <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>
                  {f.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
