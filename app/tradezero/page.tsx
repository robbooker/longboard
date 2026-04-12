"use client";

import React, { useState, useEffect } from "react";
import { green, red, dim, text, font, tradezeroTheme } from "@/lib/theme";

const { TZ_BLUE, TZ_GOLD, amber, bg, card, cardHi, border } = tradezeroTheme;

// ============================================================
// TradeZero integration — built to feel PREMIUM.
// Leans into what TradeZero is actually known for:
//   - HTB short locates marketplace
//   - Level 2 order book / direct access
//   - Smart routing (ARCA, NSDQ, EDGX, BATS, IEX)
//   - Hotkey trading
// Mock data is shaped to TradeZero's public API surface so
// swapping in real endpoints later is clean.
// ============================================================

const ACCOUNT = {
  account_id: "TZP-41209",
  buying_power: "412800.00",
  cash: "103200.00",
  equity: "208440.18",
  day_pl: "2841.40",
  day_pl_pct: "0.0138",
  open_pl: "-412.30",
  day_trades_used: 1,
  status: "ACTIVE",
  tier: "ZERO PRO",
};

const POSITIONS = [
  { symbol: "MARA",  qty: -2000, avg: "18.42",  last: "18.05",  pl:  "740.00",  plpc:  "0.0201", route: "EDGX" },
  { symbol: "RIOT",  qty: -1500, avg: "11.88",  last: "11.52",  pl:  "540.00",  plpc:  "0.0303", route: "ARCA" },
  { symbol: "AMC",   qty:  1000, avg: "4.22",   last: "4.41",   pl:  "190.00",  plpc:  "0.0450", route: "NSDQ" },
  { symbol: "SOUN",  qty:  -800, avg: "7.15",   last: "7.38",   pl: "-184.00",  plpc: "-0.0321", route: "BATS" },
];

const LOCATES = [
  { symbol: "GME",   available: 25000, rate: "3.25", cost_per_share: "0.08", tier: "STANDARD" },
  { symbol: "AMC",   available: 50000, rate: "1.80", cost_per_share: "0.04", tier: "STANDARD" },
  { symbol: "BBBYQ", available: 500,   rate: "42.5", cost_per_share: "0.95", tier: "PREMIUM" },
  { symbol: "TSLA",  available: 100000,rate: "0.75", cost_per_share: "0.02", tier: "EASY" },
  { symbol: "DJT",   available: 2000,  rate: "68.0", cost_per_share: "1.52", tier: "PREMIUM" },
  { symbol: "MARA",  available: 15000, rate: "2.10", cost_per_share: "0.05", tier: "STANDARD" },
];

const LEVEL2_BID = [
  { route: "ARCA", price: "18.04", size: 1200 },
  { route: "NSDQ", price: "18.04", size:  800 },
  { route: "EDGX", price: "18.03", size: 2500 },
  { route: "BATS", price: "18.03", size:  600 },
  { route: "IEX",  price: "18.02", size: 1800 },
];
const LEVEL2_ASK = [
  { route: "NSDQ", price: "18.05", size:  900 },
  { route: "ARCA", price: "18.05", size: 1500 },
  { route: "EDGX", price: "18.06", size: 2200 },
  { route: "BATS", price: "18.07", size:  400 },
  { route: "IEX",  price: "18.08", size: 1100 },
];

const TIME_SALES = [
  { time: "09:45:22.431", price: "18.05", size: 500,  side: "buy"  },
  { time: "09:45:22.118", price: "18.04", size: 1200, side: "sell" },
  { time: "09:45:21.907", price: "18.05", size: 300,  side: "buy"  },
  { time: "09:45:21.622", price: "18.04", size: 800,  side: "sell" },
  { time: "09:45:21.401", price: "18.05", size: 200,  side: "buy"  },
  { time: "09:45:20.998", price: "18.03", size: 1500, side: "sell" },
];

const HALT_TICKER = [
  { symbol: "XELA", status: "LUDP", reason: "Volatility Pause",     time: "09:43:12" },
  { symbol: "BBBYQ", status: "SSR",  reason: "Short Sale Restricted", time: "09:31:00" },
  { symbol: "DJT",  status: "SSR",  reason: "Short Sale Restricted", time: "09:31:00" },
  { symbol: "NVDA", status: "T12",  reason: "News Pending",          time: "09:38:44" },
  { symbol: "GME",  status: "SSR",  reason: "Short Sale Restricted", time: "09:31:00" },
  { symbol: "SOUN", status: "LUDP", reason: "Volatility Pause",     time: "09:44:02" },
];

const MY_LOCATES = [
  { symbol: "GME",  shares: 2000, cost: "160.00", reserved_at: "09:15:22", used: 0 },
  { symbol: "AMC",  shares: 5000, cost: "200.00", reserved_at: "09:12:08", used: 1000 },
  { symbol: "MARA", shares: 2000, cost: "100.00", reserved_at: "09:08:44", used: 2000 },
];

const ALERTS = [
  { time: "09:44:58", symbol: "XELA", pattern: "PARABOLIC",       severity: "high", detail: "+240% · halted LUDP" },
  { time: "09:42:31", symbol: "SOUN", pattern: "FADE SETUP",       severity: "med",  detail: "Failed breakout · short bias" },
  { time: "09:39:15", symbol: "RIOT", pattern: "VWAP REJECTION",   severity: "med",  detail: "2nd rejection · momentum short" },
  { time: "09:35:02", symbol: "DJT",  pattern: "GAP-N-CRAP",       severity: "high", detail: "Opening drive failed" },
];

const HOTKEYS = [
  { key: "F1", action: "BUY · Ask · 100sh" },
  { key: "F2", action: "SELL · Bid · 100sh" },
  { key: "F3", action: "SHORT · Bid · 100sh" },
  { key: "F4", action: "COVER · Ask · 100sh" },
  { key: "F9", action: "CANCEL ALL" },
  { key: "F12", action: "FLATTEN ALL" },
];

const fmt = (n: string | number, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: string | number) => `${(Number(n) * 100).toFixed(2)}%`;
const signColor = (n: string | number) => Number(n) >= 0 ? green : red;

function Card({ title, right, children, glow }: { title: string; right?: string; children: React.ReactNode; glow?: boolean }) {
  return (
    <div style={{
      background: card, border: `1px solid ${glow ? TZ_GOLD + "40" : border}`,
      borderRadius: 6, overflow: "hidden",
      boxShadow: glow ? `0 0 24px ${TZ_GOLD}18, inset 0 1px 0 ${TZ_GOLD}22` : "none",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px", borderBottom: `1px solid ${border}`, background: cardHi,
      }}>
        <div style={{ fontSize: 10, color: glow ? TZ_GOLD : dim, letterSpacing: 2, textTransform: "uppercase" }}>{title}</div>
        <div style={{ fontSize: 10, color: dim }}>{right}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Stat({ label, value, color = text, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ padding: "14px 16px", background: card, border: `1px solid ${border}`, borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: dim, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, color, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: dim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Pill({ children, color, solid }: { children: React.ReactNode; color: string; solid?: boolean }) {
  return (
    <span style={{
      fontSize: 9, padding: "2px 7px",
      border: `1px solid ${color}`, background: solid ? color : "transparent",
      color: solid ? bg : color,
      borderRadius: 2, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600,
    }}>{children}</span>
  );
}

function DepthRow({ row, side, maxSize }: { row: { route: string; price: string; size: number }; side: "bid" | "ask"; maxSize: number }) {
  const fill = (row.size / maxSize) * 100;
  const color = side === "bid" ? green : red;
  return (
    <div style={{ position: "relative", display: "grid", gridTemplateColumns: "60px 1fr 70px", fontSize: 12, padding: "5px 10px", borderBottom: `1px solid ${border}` }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(${side === "bid" ? "to left" : "to right"}, ${color}18, transparent ${fill}%)`,
        pointerEvents: "none",
      }} />
      <div style={{ color: dim, position: "relative" }}>{row.route}</div>
      <div style={{ color, fontWeight: 500, position: "relative", textAlign: side === "bid" ? "left" : "right" }}>${row.price}</div>
      <div style={{ color: text, position: "relative", textAlign: "right" }}>{row.size.toLocaleString()}</div>
    </div>
  );
}

export default function TradeZeroPage() {
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const maxBid = Math.max(...LEVEL2_BID.map(r => r.size));
  const maxAsk = Math.max(...LEVEL2_ASK.map(r => r.size));

  return (
    <div style={{ background: bg, color: text, fontFamily: font, minHeight: "100vh", padding: 24 }}>
      {/* Sponsor header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 20px", marginBottom: 20,
        background: `linear-gradient(90deg, ${TZ_BLUE}12, transparent 60%)`,
        border: `1px solid ${TZ_BLUE}40`, borderRadius: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div>
            <div style={{ fontSize: 10, color: dim, letterSpacing: 2 }}>LONGBOARD.AI // POWERED BY</div>
            <div style={{ fontSize: 24, color: TZ_BLUE, fontWeight: 700, letterSpacing: -0.5, marginTop: 2 }}>
              TRADE<span style={{ color: TZ_GOLD }}>ZERO</span>
            </div>
          </div>
          <div style={{ height: 40, width: 1, background: border }} />
          <div style={{ display: "flex", gap: 8 }}>
            <Pill color={TZ_GOLD} solid>{ACCOUNT.tier}</Pill>
            <Pill color={green}>● {ACCOUNT.status}</Pill>
            <Pill color={TZ_BLUE}>{ACCOUNT.account_id}</Pill>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: dim }}>
          <div>DT USED: <span style={{ color: text }}>{ACCOUNT.day_trades_used}/3</span></div>
          <div style={{ marginTop: 4 }}>{clock.toLocaleTimeString("en-US")} ET</div>
        </div>
      </div>

      {/* Halt / SSR ticker — marquee strip */}
      <div style={{
        border: `1px solid ${border}`, background: card, borderRadius: 6,
        marginBottom: 20, display: "flex", alignItems: "center", overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 14px", background: cardHi, borderRight: `1px solid ${border}`,
          fontSize: 10, color: amber, letterSpacing: 2, fontWeight: 700,
        }}>⚠ MARKET STATUS</div>
        <div style={{ display: "flex", gap: 24, padding: "10px 16px", overflowX: "auto", flex: 1 }}>
          {HALT_TICKER.map((h, i) => {
            const c = h.status === "SSR" ? amber : h.status.startsWith("LUDP") || h.status === "T12" ? red : dim;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, whiteSpace: "nowrap" }}>
                <Pill color={c}>{h.status}</Pill>
                <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                <span style={{ color: dim, fontSize: 11 }}>{h.reason} · {h.time}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Account stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Stat label="Equity" value={`$${fmt(ACCOUNT.equity)}`} />
        <Stat label="Buying Power" value={`$${fmt(ACCOUNT.buying_power)}`} sub="4:1 intraday" />
        <Stat label="Cash" value={`$${fmt(ACCOUNT.cash)}`} />
        <Stat label="Day P&L" value={`+$${fmt(ACCOUNT.day_pl)}`} color={signColor(ACCOUNT.day_pl)} sub={pct(ACCOUNT.day_pl_pct)} />
        <Stat label="Open P&L" value={`$${fmt(ACCOUNT.open_pl)}`} color={signColor(ACCOUNT.open_pl)} />
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Positions */}
        <Card title="Positions" right={`${POSITIONS.length} open`}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: cardHi }}>
                {["Symbol", "Qty", "Avg", "Last", "P&L", "%", "Route"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, color: dim, letterSpacing: 1.2, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map(p => (
                <tr key={p.symbol} style={{ borderBottom: `1px solid ${border}` }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                    {p.symbol}{" "}
                    <Pill color={p.qty < 0 ? red : green}>{p.qty < 0 ? "SHORT" : "LONG"}</Pill>
                  </td>
                  <td style={{ padding: "10px 12px" }}>{Math.abs(p.qty).toLocaleString()}</td>
                  <td style={{ padding: "10px 12px" }}>${p.avg}</td>
                  <td style={{ padding: "10px 12px" }}>${p.last}</td>
                  <td style={{ padding: "10px 12px", color: signColor(p.pl) }}>{Number(p.pl) >= 0 ? "+" : ""}${fmt(p.pl)}</td>
                  <td style={{ padding: "10px 12px", color: signColor(p.plpc) }}>{pct(p.plpc)}</td>
                  <td style={{ padding: "10px 12px" }}><Pill color={TZ_BLUE}>{p.route}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Locates — signature TradeZero feature */}
        <Card title="Short Locate Marketplace" right="LIVE" glow>
          <div style={{ padding: "8px 14px", fontSize: 10, color: TZ_GOLD, letterSpacing: 1.5, borderBottom: `1px solid ${border}` }}>
            ★ SPONSORED FEATURE · REAL-TIME HTB INVENTORY
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: cardHi }}>
                {["Symbol", "Available", "Rate", "Cost/Sh", "Tier", ""].map((h, i) => (
                  <th key={i} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, color: dim, letterSpacing: 1.2, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LOCATES.map(l => {
                const tierColor = l.tier === "EASY" ? green : l.tier === "PREMIUM" ? red : amber;
                return (
                  <tr key={l.symbol} style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: "9px 12px", fontWeight: 600 }}>{l.symbol}</td>
                    <td style={{ padding: "9px 12px" }}>{l.available.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px" }}>{l.rate}%</td>
                    <td style={{ padding: "9px 12px", color: TZ_GOLD }}>${l.cost_per_share}</td>
                    <td style={{ padding: "9px 12px" }}><Pill color={tierColor}>{l.tier}</Pill></td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <button style={{
                        background: TZ_BLUE, color: bg, border: "none", padding: "4px 10px",
                        borderRadius: 3, fontFamily: font, fontSize: 10, fontWeight: 700,
                        letterSpacing: 1, cursor: "pointer",
                      }}>LOCATE</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Level 2 + Time & Sales + Hotkeys */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.9fr", gap: 16, marginBottom: 16 }}>
        <Card title="Level 2 · MARA" right="Direct Access">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ borderRight: `1px solid ${border}` }}>
              <div style={{ padding: "6px 10px", fontSize: 10, color: green, letterSpacing: 1.5, background: cardHi }}>BID</div>
              {LEVEL2_BID.map((r, i) => <DepthRow key={i} row={r} side="bid" maxSize={maxBid} />)}
            </div>
            <div>
              <div style={{ padding: "6px 10px", fontSize: 10, color: red, letterSpacing: 1.5, background: cardHi, textAlign: "right" }}>ASK</div>
              {LEVEL2_ASK.map((r, i) => <DepthRow key={i} row={r} side="ask" maxSize={maxAsk} />)}
            </div>
          </div>
        </Card>

        <Card title="Time & Sales · MARA" right="streaming">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {TIME_SALES.map((t, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
                  <td style={{ padding: "7px 12px", color: dim, fontSize: 11 }}>{t.time}</td>
                  <td style={{ padding: "7px 12px", color: t.side === "buy" ? green : red, fontWeight: 500 }}>${t.price}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right" }}>{t.size.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Hotkeys" right="F-keys live">
          <div style={{ padding: "4px 0" }}>
            {HOTKEYS.map(h => (
              <div key={h.key} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 14px", borderBottom: `1px solid ${border}`, fontSize: 12,
              }}>
                <span style={{
                  fontFamily: font, background: cardHi, border: `1px solid ${border}`,
                  padding: "2px 8px", borderRadius: 3, color: TZ_BLUE, fontWeight: 600, minWidth: 32, textAlign: "center",
                }}>{h.key}</span>
                <span style={{ color: dim, fontSize: 11 }}>{h.action}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* My Locates cart + Borrow Calculator + Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card title="My Locates · Today" right={`${MY_LOCATES.length} reserved`} glow>
          <div style={{ padding: "8px 14px", fontSize: 10, color: TZ_GOLD, letterSpacing: 1.5, borderBottom: `1px solid ${border}` }}>
            ★ ACTIVE SHORT INVENTORY · RESERVED FOR YOU
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: cardHi }}>
                {["Symbol", "Reserved", "Used", "Cost", "Time", ""].map((h, i) => (
                  <th key={i} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, color: dim, letterSpacing: 1.2, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MY_LOCATES.map(l => {
                const pctUsed = l.used / l.shares;
                return (
                  <tr key={l.symbol} style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: "9px 12px", fontWeight: 600 }}>{l.symbol}</td>
                    <td style={{ padding: "9px 12px" }}>{l.shares.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{l.used.toLocaleString()}</span>
                        <div style={{ flex: 1, height: 4, background: cardHi, borderRadius: 2, overflow: "hidden", minWidth: 40 }}>
                          <div style={{ width: `${pctUsed * 100}%`, height: "100%", background: pctUsed === 1 ? green : TZ_BLUE }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px", color: TZ_GOLD }}>${l.cost}</td>
                    <td style={{ padding: "9px 12px", color: dim, fontSize: 11 }}>{l.reserved_at}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <button style={{
                        background: "transparent", border: `1px solid ${red}`, color: red,
                        padding: "3px 8px", borderRadius: 3, fontFamily: font, fontSize: 9,
                        fontWeight: 700, letterSpacing: 1, cursor: "pointer",
                      }}>RETURN</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 14px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: dim }}>Total reserved cost</span>
            <span style={{ color: TZ_GOLD, fontWeight: 600 }}>$460.00</span>
          </div>
        </Card>

        <BorrowCalculator />

        <Card title="Pattern Alerts" right="AI · streaming">
          {ALERTS.map((a, i) => {
            const sevColor = a.severity === "high" ? red : amber;
            return (
              <div key={i} style={{ padding: "10px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ width: 4, alignSelf: "stretch", background: sevColor, borderRadius: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {a.symbol} <Pill color={sevColor}>{a.pattern}</Pill>
                    </span>
                    <span style={{ color: dim, fontSize: 10 }}>{a.time}</span>
                  </div>
                  <div style={{ fontSize: 11, color: dim }}>{a.detail}</div>
                </div>
              </div>
            );
          })}
        </Card>
      </div>

      {/* Order entry */}
      <Card title="Quick Order · Direct Access" right="ROUTE SMART">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto", gap: 10, padding: 14, alignItems: "end" }}>
          <Field label="Symbol" value="MARA" />
          <Field label="Qty" value="1000" />
          <Field label="Price" value="18.04" />
          <Field label="Type" value="LIMIT" />
          <Field label="Route" value="SMART" />
          <div style={{ display: "flex", gap: 6 }}>
            <ActionBtn color={green}>BUY</ActionBtn>
            <ActionBtn color={red}>SELL</ActionBtn>
            <ActionBtn color={TZ_GOLD}>SHORT</ActionBtn>
          </div>
        </div>
      </Card>

      <div style={{ fontSize: 10, color: dim, textAlign: "center", marginTop: 28, letterSpacing: 1.5 }}>
        ★ TRADEZERO PRO INTEGRATION · LOCATES · L2 · DIRECT ROUTING · HOTKEYS ★
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>{label}</div>
      <div style={{ background: cardHi, border: `1px solid ${border}`, padding: "8px 10px", borderRadius: 3, fontSize: 13, color: text }}>{value}</div>
    </div>
  );
}

function ActionBtn({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <button style={{
      background: "transparent", border: `1px solid ${color}`, color,
      padding: "8px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
      fontWeight: 700, letterSpacing: 1.5, cursor: "pointer",
    }}>{children}</button>
  );
}

function BorrowCalculator() {
  const [symbol, setSymbol] = useState("GME");
  const [shares, setShares] = useState(1000);
  const [days, setDays] = useState(3);
  const [price] = useState(22.40);
  const [rate] = useState(3.25);

  const notional = shares * price;
  const dailyCost = (notional * (rate / 100)) / 365;
  const totalCost = dailyCost * days;
  const breakeven = (totalCost / shares);

  const input: React.CSSProperties = {
    background: cardHi, border: `1px solid ${border}`, padding: "8px 10px",
    borderRadius: 3, fontSize: 13, color: text, fontFamily: font, width: "100%",
    boxSizing: "border-box",
  };

  return (
    <Card title="Borrow Cost Calculator" right="HTB">
      <div style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>SYMBOL</div>
            <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} style={input} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>RATE %</div>
            <div style={{ ...input, color: TZ_GOLD }}>{rate.toFixed(2)}%</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>SHARES</div>
            <input type="number" value={shares} onChange={e => setShares(Number(e.target.value) || 0)} style={input} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>HOLD (DAYS)</div>
            <input type="number" value={days} onChange={e => setDays(Number(e.target.value) || 0)} style={input} />
          </div>
        </div>

        <div style={{ marginTop: 6, padding: "10px 12px", background: cardHi, border: `1px solid ${border}`, borderRadius: 3, fontSize: 12 }}>
          <Row k="Notional"       v={`$${fmt(notional)}`} />
          <Row k="Daily carry"    v={`$${fmt(dailyCost)}`} color={red} />
          <Row k={`Total (${days}d)`} v={`$${fmt(totalCost)}`} color={red} />
          <Row k="Breakeven move" v={`$${breakeven.toFixed(4)}/sh`} color={TZ_GOLD} />
        </div>
      </div>
    </Card>
  );
}

function Row({ k, v, color = text }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
      <span style={{ color: dim }}>{k}</span>
      <span style={{ color, fontWeight: 500 }}>{v}</span>
    </div>
  );
}
