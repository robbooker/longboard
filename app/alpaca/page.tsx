"use client";

import React, { useState, useEffect } from "react";
import { green, red, dim, text, font, alpacaTheme } from "@/lib/theme";

const { bg, card, border } = alpacaTheme;

// Mock Alpaca data shaped exactly like the real API responses,
// so swapping in live fetch('/v2/account'), /v2/positions, /v2/orders is trivial.
const MOCK_ACCOUNT = {
  status: "ACTIVE",
  currency: "USD",
  buying_power: "184320.45",
  cash: "42108.22",
  portfolio_value: "142212.23",
  equity: "142212.23",
  last_equity: "139845.10",
  daytrade_count: 2,
  pattern_day_trader: false,
  trading_blocked: false,
};

const MOCK_POSITIONS = [
  { symbol: "NVDA", qty: "50",  avg_entry_price: "118.40", current_price: "124.82", market_value: "6241.00", unrealized_pl: "321.00",  unrealized_plpc: "0.0542", side: "long" },
  { symbol: "TSLA", qty: "25",  avg_entry_price: "241.10", current_price: "236.45", market_value: "5911.25", unrealized_pl: "-116.25", unrealized_plpc: "-0.0193", side: "long" },
  { symbol: "AAPL", qty: "100", avg_entry_price: "182.05", current_price: "189.20", market_value: "18920.00", unrealized_pl: "715.00", unrealized_plpc: "0.0393", side: "long" },
  { symbol: "SOFI", qty: "500", avg_entry_price: "8.12",   current_price: "7.88",   market_value: "3940.00",  unrealized_pl: "-120.00", unrealized_plpc: "-0.0296", side: "long" },
  { symbol: "GME",  qty: "-30", avg_entry_price: "22.40",  current_price: "21.10",  market_value: "-633.00",  unrealized_pl: "39.00",   unrealized_plpc: "0.0580", side: "short" },
];

const MOCK_ORDERS = [
  { id: "o1", symbol: "AMD",  side: "buy",  qty: "40",  type: "limit",  limit_price: "142.50", stop_price: null,   status: "new",             submitted_at: "09:42:11" },
  { id: "o2", symbol: "PLTR", side: "sell", qty: "200", type: "limit",  limit_price: "28.90",  stop_price: null,   status: "partially_filled", submitted_at: "09:38:02" },
  { id: "o3", symbol: "NVDA", side: "sell", qty: "50",  type: "stop",   limit_price: null,     stop_price: "120.00", status: "new",             submitted_at: "09:31:44" },
];

const MOCK_ACTIVITY = [
  { time: "09:41:22", symbol: "AAPL", side: "buy",  qty: 100, price: "182.05", type: "FILL" },
  { time: "09:35:18", symbol: "SOFI", side: "buy",  qty: 500, price: "8.12",   type: "FILL" },
  { time: "09:32:07", symbol: "TSLA", side: "buy",  qty: 25,  price: "241.10", type: "FILL" },
  { time: "09:30:44", symbol: "GME",  side: "sell", qty: 30,  price: "22.40",  type: "FILL" },
];

const fmt = (n: string | number, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: string | number) => `${(Number(n) * 100).toFixed(2)}%`;

function Stat({ label, value, color = text }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "14px 16px", background: card, border: `1px solid ${border}`, borderRadius: 4 }}>
      <div style={{ fontSize: 10, color: dim, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, color, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1,
    }}>{children}</span>
  );
}

export default function AlpacaPage() {
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const dayPL = Number(MOCK_ACCOUNT.equity) - Number(MOCK_ACCOUNT.last_equity);
  const dayPLpct = dayPL / Number(MOCK_ACCOUNT.last_equity);
  const plColor = dayPL >= 0 ? green : red;

  return (
    <div style={{ background: bg, color: text, fontFamily: font, minHeight: "100vh", padding: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: `1px solid ${border}`, paddingBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: dim, letterSpacing: 2 }}>LONGBOARD.AI // ALPACA PAPER</div>
          <div style={{ fontSize: 22, color: green, marginTop: 4, fontWeight: 500 }}>Trading Desk</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: dim }}>
            <Pill color={green}>● {MOCK_ACCOUNT.status}</Pill>
            <span style={{ marginLeft: 10 }}>DT COUNT: {MOCK_ACCOUNT.daytrade_count}/3</span>
          </div>
          <div style={{ fontSize: 13, color: "#a9b5ae", marginTop: 6 }}>{clock.toLocaleTimeString("en-US")} ET</div>
        </div>
      </div>

      {/* Account stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Stat label="Portfolio Value" value={`$${fmt(MOCK_ACCOUNT.portfolio_value)}`} />
        <Stat label="Buying Power"    value={`$${fmt(MOCK_ACCOUNT.buying_power)}`} />
        <Stat label="Cash"            value={`$${fmt(MOCK_ACCOUNT.cash)}`} />
        <Stat label="Day P&L"         value={`${dayPL >= 0 ? "+" : ""}$${fmt(dayPL)} (${pct(dayPLpct)})`} color={plColor} />
      </div>

      {/* Positions */}
      <Section title={`Positions (${MOCK_POSITIONS.length})`}>
        <Table
          headers={["Symbol", "Side", "Qty", "Avg Entry", "Last", "Mkt Value", "Unrealized P&L", "%"]}
          rows={MOCK_POSITIONS.map(p => {
            const plColor = Number(p.unrealized_pl) >= 0 ? green : red;
            return [
              <strong key="sym" style={{ color: text }}>{p.symbol}</strong>,
              <Pill key="side" color={p.side === "long" ? green : red}>{p.side}</Pill>,
              p.qty,
              `$${fmt(p.avg_entry_price)}`,
              `$${fmt(p.current_price)}`,
              `$${fmt(p.market_value)}`,
              <span key="pl" style={{ color: plColor }}>{Number(p.unrealized_pl) >= 0 ? "+" : ""}${fmt(p.unrealized_pl)}</span>,
              <span key="plpc" style={{ color: plColor }}>{pct(p.unrealized_plpc)}</span>,
            ];
          })}
        />
      </Section>

      {/* Open orders */}
      <Section title={`Open Orders (${MOCK_ORDERS.length})`}>
        <Table
          headers={["Time", "Symbol", "Side", "Qty", "Type", "Price", "Status"]}
          rows={MOCK_ORDERS.map(o => [
            <span key="time" style={{ color: dim }}>{o.submitted_at}</span>,
            <strong key="sym">{o.symbol}</strong>,
            <Pill key="side" color={o.side === "buy" ? green : red}>{o.side}</Pill>,
            o.qty,
            o.type.toUpperCase(),
            `$${fmt(o.limit_price || o.stop_price || "0")}`,
            <Pill key="status" color={o.status === "partially_filled" ? "#e6b800" : green}>{o.status.replace("_", " ")}</Pill>,
          ])}
        />
      </Section>

      {/* Activity */}
      <Section title="Today's Activity">
        <Table
          headers={["Time", "Symbol", "Side", "Qty", "Price", "Event"]}
          rows={MOCK_ACTIVITY.map(a => [
            <span key="time" style={{ color: dim }}>{a.time}</span>,
            <strong key="sym">{a.symbol}</strong>,
            <Pill key="side" color={a.side === "buy" ? green : red}>{a.side}</Pill>,
            a.qty,
            `$${fmt(a.price)}`,
            <Pill key="type" color={green}>{a.type}</Pill>,
          ])}
        />
      </Section>

      <div style={{ fontSize: 10, color: dim, textAlign: "center", marginTop: 32, letterSpacing: 1.5 }}>
        DATA: ALPACA PAPER // NO REAL CAPITAL AT RISK
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: dim, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>{title}</div>
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 4, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#0c100e" }}>
          {headers.map((h, i) => (
            <th key={i} style={{ textAlign: "left", padding: "10px 14px", fontSize: 10, color: dim, letterSpacing: 1.5, fontWeight: 500, borderBottom: `1px solid ${border}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
            {r.map((cell, j) => (
              <td key={j} style={{ padding: "12px 14px" }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
