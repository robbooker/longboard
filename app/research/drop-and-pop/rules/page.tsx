"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

/* ═══ Theme system (synced with dashboard) ═════════════════════════════ */

type ThemeName = "dark" | "light" | "blue" | "retro";

interface ThemeColors {
  bg: string; bg2: string; bgCard: string; bgHeader: string; bgStat: string;
  border: string; border2: string;
  t1: string; t2: string; t3: string; t4: string; t5: string;
  green: string; greenBg: string; greenBdr: string;
  red: string; redBg: string; redBdr: string;
  link: string;
  chartBg: string; gridColor: string;
  candleUp: string; candleDown: string;
  fontMono: string;
}

const THEMES: Record<ThemeName, ThemeColors> = {
  dark: {
    bg: "#0a0a0f", bg2: "#0e0e16", bgCard: "#12121e", bgHeader: "#12121a", bgStat: "#1a1a24",
    border: "#1e1e2e", border2: "#2a2a3e",
    t1: "#e0e0e0", t2: "#ccc", t3: "#aaa", t4: "#888", t5: "#666",
    green: "#4ade80", greenBg: "#0a1a0a", greenBdr: "#1a3a1a",
    red: "#f87171", redBg: "#1a0a0a", redBdr: "#3a1a1a",
    link: "#6b8afd",
    chartBg: "#0a0a0f", gridColor: "#1a1a24",
    candleUp: "#4ade80", candleDown: "#f87171",
    fontMono: "'IBM Plex Mono', monospace",
  },
  light: {
    bg: "#fafafa", bg2: "#f3f3f6", bgCard: "#eeeef2", bgHeader: "#eeeef2", bgStat: "#e4e4ea",
    border: "#d8d8e0", border2: "#c8c8d0",
    t1: "#1a1a2e", t2: "#333", t3: "#555", t4: "#777", t5: "#999",
    green: "#16a34a", greenBg: "#f0fdf4", greenBdr: "#bbf7d0",
    red: "#dc2626", redBg: "#fef2f2", redBdr: "#fecaca",
    link: "#4f46e5",
    chartBg: "#fafafa", gridColor: "#e4e4ea",
    candleUp: "#16a34a", candleDown: "#dc2626",
    fontMono: "'IBM Plex Mono', monospace",
  },
  blue: {
    bg: "#edf4fc", bg2: "#dde9f7", bgCard: "#d0e2f4", bgHeader: "#d0e2f4", bgStat: "#c0d6ee",
    border: "#8fbde0", border2: "#6faad4",
    t1: "#1a3654", t2: "#2a5070", t3: "#3a6890", t4: "#5a8ab4", t5: "#7aa4c8",
    green: "#059669", greenBg: "#ecfdf5", greenBdr: "#6ee7b7",
    red: "#dc2626", redBg: "#fff1f2", redBdr: "#fca5a5",
    link: "#2563eb",
    chartBg: "#edf4fc", gridColor: "#c0d6ee",
    candleUp: "#059669", candleDown: "#dc2626",
    fontMono: "'IBM Plex Mono', monospace",
  },
  retro: {
    bg: "#c0c0c0", bg2: "#d4d0c8", bgCard: "#ffffff", bgHeader: "#c0c0c0", bgStat: "#d4d0c8",
    border: "#808080", border2: "#a0a0a0",
    t1: "#000000", t2: "#000000", t3: "#000080", t4: "#333", t5: "#666",
    green: "#008000", greenBg: "#c0ffc0", greenBdr: "#008000",
    red: "#ff0000", redBg: "#ffc0c0", redBdr: "#ff0000",
    link: "#0000ff",
    chartBg: "#ffffff", gridColor: "#c0c0c0",
    candleUp: "#008000", candleDown: "#ff0000",
    fontMono: "'Courier New', Courier, monospace",
  },
};

const THEME_DOTS: Record<ThemeName, string> = {
  dark: "#0a0a0f",
  light: "#fafafa",
  blue: "#a0c4e8",
  retro: "#ffff00",
};

const LS_KEY = "pop-drop-theme";

/* ═══ Data ═════════════════════════════════════════════════════════════ */

const RESULTS = [
  { month: "November", label: "TRAIN", n: 52, wins: 13, wr: "25.0%", pnl: "+$2,797.58", pf: "13.91", tagBg: "#2d1b4e", tagColor: "#a78bfa" },
  { month: "December", label: "OOS", n: 73, wins: 13, wr: "17.8%", pnl: "+$2,351.82", pf: "2.64", tagBg: "#1b3a4e", tagColor: "#67e8f9" },
  { month: "January", label: "OOS", n: 38, wins: 0, wr: "0.0%", pnl: "-$977.25", pf: "0.00", tagBg: "#1b4e2d", tagColor: "#6ee7b7" },
  { month: "Feb-Mar", label: "OOS", n: 26, wins: 9, wr: "34.6%", pnl: "+$1,830.95", pf: "4.16", tagBg: "#4e3a1b", tagColor: "#fbbf24" },
];

const BUCKETS: Record<string, { month: string; n: number; wr: string; pnl: string; pf: string }[]> = {
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

/* ═══ Page ═════════════════════════════════════════════════════════════ */

export default function RulesPage() {
  const [theme, setTheme] = useState<ThemeName>("dark");

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && saved in THEMES) setTheme(saved as ThemeName);

    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY && e.newValue && e.newValue in THEMES) {
        setTheme(e.newValue as ThemeName);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const changeTheme = (t: ThemeName) => {
    setTheme(t);
    localStorage.setItem(LS_KEY, t);
  };

  const c = THEMES[theme];
  const isRetro = theme === "retro";
  const radius = isRetro ? 0 : 4;
  const fontBody = isRetro ? "'Comic Sans MS', cursive" : c.fontMono;

  const thStyle: React.CSSProperties = {
    textAlign: "left", padding: "10px 12px", borderBottom: `2px solid ${c.border2}`,
    color: c.t5, fontSize: 10, textTransform: "uppercase", letterSpacing: 1,
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px", borderBottom: `1px solid ${c.border}`, color: c.t2,
  };

  return (
    <div style={{ background: c.bg, color: c.t1, fontFamily: fontBody, minHeight: "100vh", transition: "background .3s, color .3s" }}>
      {/* Retro marquee */}
      {isRetro && (
        <>
          <style>{`@keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }`}</style>
          <div style={{ background: "#ffff00", color: "#ff0000", padding: "4px 0", fontFamily: "'Comic Sans MS', cursive", fontSize: 14, fontWeight: 700, borderBottom: "2px solid #000", overflow: "hidden", whiteSpace: "nowrap" }}>
            <span style={{ display: "inline-block", animation: "marquee 15s linear infinite" }}>
              &#9733; &#9733; &#9733; DROP &amp; POP RULES &amp; RESULTS!!! &#9733; BEST VIEWED IN NETSCAPE NAVIGATOR 4.0 AT 800x600 &#9733; UNDER CONSTRUCTION &#9733; &#9733; &#9733;
            </span>
          </div>
        </>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: c.bgHeader, borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontFamily: c.fontMono, fontSize: 14, color: c.t4, fontWeight: 500, letterSpacing: 1, margin: 0 }}>
            DROP &amp; POP — RULES &amp; RESULTS
          </h1>
          <Link href="/research/drop-and-pop" style={{ fontFamily: c.fontMono, fontSize: 11, color: c.link, textDecoration: "none", padding: "5px 12px", border: `1px solid ${c.border2}`, borderRadius: radius }}>
            &larr; TRADE VIEWER
          </Link>
          <Link href="/" style={{ fontFamily: c.fontMono, fontSize: 11, color: c.link, textDecoration: "none", padding: "5px 12px", border: `1px solid ${c.border2}`, borderRadius: radius }}>
            HOME
          </Link>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["dark", "light", "blue", "retro"] as ThemeName[]).map((t) => (
            <button key={t} onClick={() => changeTheme(t)} title={t} style={{
              width: 24, height: 24,
              borderRadius: t === "retro" ? 2 : "50%",
              border: `2px solid ${theme === t ? c.green : c.border2}`,
              background: t === "retro"
                ? "repeating-linear-gradient(45deg,#ff0,#ff0 3px,#000 3px,#000 6px)"
                : THEME_DOTS[t],
              cursor: "pointer",
              boxShadow: theme === t ? `0 0 8px ${c.green}` : "none",
              transition: "all .2s",
              padding: 0,
            }} />
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        {/* ─── Strategy Rules ──────────────────────────────────── */}
        <h2 style={{ fontSize: 18, fontWeight: 600, color: c.green, marginBottom: 20, letterSpacing: 2, fontFamily: c.fontMono }}>
          STRATEGY RULES
        </h2>

        <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: radius, padding: 24, marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Universe & Filters */}
            <div>
              <h3 style={{ fontSize: 12, color: c.t5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: c.fontMono }}>Universe &amp; Filters</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[
                  "Stocks that gap UP 10%+ premarket",
                  "No warrants, SPACs, or preferred shares",
                  "Price at 8:30am >= $1.00",
                  "Market cap <= $100M (when available)",
                  "All qualifying gappers included — no staircase filter",
                ].map((rule, i) => (
                  <li key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${c.border}`, fontSize: 13, color: c.t2, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ color: c.green, fontSize: 10 }}>&#9654;</span> {rule}
                  </li>
                ))}
              </ul>
            </div>

            {/* Entry Logic */}
            <div>
              <h3 style={{ fontSize: 12, color: c.t5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: c.fontMono }}>Entry Logic</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[
                  "Wait for market open at 9:30am ET",
                  "Stock must drop 5% below the opening price",
                  "Entry window: 60 minutes from open (by 10:30am)",
                  "Once dropped, enter LONG when price pops 1% off the drop low",
                  "Position size: $1,000 per trade",
                ].map((rule, i) => (
                  <li key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${c.border}`, fontSize: 13, color: c.t2, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ color: c.link, fontSize: 10 }}>&#9654;</span> {rule}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Exit Rules */}
            <div>
              <h3 style={{ fontSize: 12, color: c.t5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: c.fontMono }}>Exit Rules</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[
                  "Stop loss: 25% below entry price",
                  "Once price hits +3% profit, stop moves to breakeven (entry price)",
                  "Hold until stop is hit or end of day (3:55pm)",
                  "No pyramid — single entry only",
                ].map((rule, i) => (
                  <li key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${c.border}`, fontSize: 13, color: c.t2, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ color: "#fbbf24", fontSize: 10 }}>&#9654;</span> {rule}
                  </li>
                ))}
              </ul>
            </div>

            {/* Config Identifier */}
            <div>
              <h3 style={{ fontSize: 12, color: c.t5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontFamily: c.fontMono }}>Config Identifier</h3>
              <div style={{ background: c.bgStat, borderRadius: radius, padding: 16, fontFamily: c.fontMono, fontSize: 14, color: c.green }}>
                d5%_p1%_w60m_s25%_be@3%_none
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: c.t5, lineHeight: 1.6 }}>
                <strong style={{ color: c.t3 }}>Trained on:</strong> November 2025<br />
                <strong style={{ color: c.t3 }}>Validated on:</strong> December 2025, January 2026, Feb-Mar 2026<br />
                <strong style={{ color: c.t3 }}>Combos tested:</strong> 2,160 total parameter combinations<br />
                <strong style={{ color: c.t3 }}>Rank:</strong> #6 by Profit Factor on training data
              </div>
            </div>
          </div>
        </div>

        {/* ─── Results ─────────────────────────────────────────── */}
        <h2 style={{ fontSize: 18, fontWeight: 600, color: c.link, marginBottom: 20, letterSpacing: 2, marginTop: 40, fontFamily: c.fontMono }}>
          RESULTS
        </h2>

        {/* Monthly summary table */}
        <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: radius, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 12, color: c.t5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16, fontFamily: c.fontMono }}>
            Monthly Performance
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: c.fontMono, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Month</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Trades</th>
                <th style={thStyle}>Wins</th>
                <th style={thStyle}>Win Rate</th>
                <th style={thStyle}>P&amp;L</th>
                <th style={thStyle}>Profit Factor</th>
              </tr>
            </thead>
            <tbody>
              {RESULTS.map((r) => (
                <tr key={r.month}>
                  <td style={tdStyle}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 1, background: r.tagBg, color: r.tagColor }}>
                      {r.month.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: c.t5, fontSize: 11 }}>{r.label}</td>
                  <td style={tdStyle}>{r.n}</td>
                  <td style={tdStyle}>{r.wins}</td>
                  <td style={{ ...tdStyle, color: r.wins === 0 ? c.red : c.t2 }}>{r.wr}</td>
                  <td style={{ ...tdStyle, color: r.pnl.startsWith("+") ? c.green : c.red, fontWeight: 700 }}>{r.pnl}</td>
                  <td style={{ ...tdStyle, color: parseFloat(r.pf) >= 1.5 ? c.green : parseFloat(r.pf) === 0 ? c.red : c.t2 }}>{r.pf}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${c.border2}` }}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>TOTAL</td>
                <td style={tdStyle}></td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>189</td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>35</td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>18.5%</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: c.green }}>+$6,003.10</td>
                <td style={tdStyle}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Gap bucket breakdown */}
        <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: radius, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 12, color: c.t5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16, fontFamily: c.fontMono }}>
            Gap Bucket Breakdown
          </h3>
          {Object.entries(BUCKETS).map(([bucket, months]) => (
            <div key={bucket} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: bucket === "25-50%" ? "#fbbf24" : bucket === "50%+" ? c.green : c.t4, marginBottom: 8, fontFamily: c.fontMono }}>
                {bucket} Gap
                {bucket === "25-50%" && <span style={{ fontSize: 10, color: "#fbbf24", marginLeft: 8, fontWeight: 400 }}>&#9733; sweet spot</span>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: c.fontMono, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Month</th>
                    <th style={thStyle}>N</th>
                    <th style={thStyle}>Win Rate</th>
                    <th style={thStyle}>P&amp;L</th>
                    <th style={thStyle}>PF</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month}>
                      <td style={tdStyle}>{m.month}</td>
                      <td style={tdStyle}>{m.n}</td>
                      <td style={{ ...tdStyle, color: m.wr === "0%" ? c.red : c.t2 }}>{m.wr}</td>
                      <td style={{ ...tdStyle, color: m.pnl.startsWith("+") ? c.green : c.red, fontWeight: 600 }}>{m.pnl}</td>
                      <td style={{ ...tdStyle, color: parseFloat(m.pf) >= 1.5 ? c.green : parseFloat(m.pf) === 0 ? c.red : c.t2 }}>{m.pf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* Key findings */}
        <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: radius, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 12, color: c.t5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16, fontFamily: c.fontMono }}>
            Key Findings
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {FINDINGS.map((f) => (
              <div key={f.title} style={{ background: c.bgStat, border: `1px solid ${f.color}33`, borderRadius: radius, padding: 16, borderLeft: `3px solid ${f.color}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: f.color, marginBottom: 6, fontFamily: c.fontMono }}>
                  {f.title}
                </div>
                <div style={{ fontSize: 12, color: c.t4, lineHeight: 1.5 }}>
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
