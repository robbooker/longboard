"use client";

import React, { useState, useEffect, useCallback } from "react";
import { green, red, dim, text, font, alpacaTheme } from "@/lib/theme";
import KillSwitchBanner, { useKillSwitchOrdersBlocked } from "@/components/KillSwitchBanner";
import BrokerNotConfiguredBanner, { useBrokerConfigured } from "@/components/BrokerNotConfiguredBanner";
import type { AlpacaAccount, AlpacaPosition, AlpacaOrder, AlpacaActivity } from "@/types/alpaca";

const { bg, card, border } = alpacaTheme;

const fmt = (n: string | number, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: string | number) => `${(Number(n) * 100).toFixed(2)}%`;

/* ---- Skeleton pulse animation (inline keyframe via style tag) ---- */
const pulseCSS = `@keyframes skeletonPulse{0%,100%{opacity:.4}50%{opacity:.8}}`;

function Skeleton({ width = "100%", height = 16 }: { width?: string | number; height?: number }) {
  return (
    <div style={{
      width, height, background: card, border: `1px solid ${border}`,
      borderRadius: 4, animation: "skeletonPulse 1.5s ease-in-out infinite",
    }} />
  );
}

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
  const [clock, setClock] = useState<Date | null>(null);
  const [account, setAccount] = useState<AlpacaAccount | null>(null);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [orders, setOrders] = useState<AlpacaOrder[]>([]);
  const [activities, setActivities] = useState<AlpacaActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ordersBlocked = useKillSwitchOrdersBlocked();
  const brokerConfigured = useBrokerConfigured("alpaca");

  const fetchData = useCallback(async () => {
    try {
      const [acctRes, posRes, ordRes] = await Promise.all([
        fetch("/api/alpaca/account"),
        fetch("/api/alpaca/positions"),
        fetch("/api/alpaca/orders"),
      ]);
      // broker_not_configured is surfaced by <BrokerNotConfiguredBanner>;
      // don't bounce it into the red error banner too.
      if (acctRes.status === 412 || posRes.status === 412 || ordRes.status === 412) {
        setAccount(null);
        setPositions([]);
        setOrders([]);
        setError(null);
        return;
      }
      const [acctData, posData, ordData] = await Promise.all([
        acctRes.json(), posRes.json(), ordRes.json(),
      ]);
      if (acctData.error) throw new Error(acctData.error);
      setAccount(acctData);
      setPositions(Array.isArray(posData) ? posData : []);
      setOrders(Array.isArray(ordData) ? ordData : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Activities — fetch once on mount
  useEffect(() => {
    fetch("/api/alpaca/activities")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setActivities(data); })
      .catch(() => {});
  }, []);

  // Clock
  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const cancelOrder = async (id: string) => {
    try {
      const res = await fetch(`/api/alpaca/orders/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const dayPL = account ? Number(account.equity) - Number(account.last_equity) : 0;
  const dayPLpct = account ? dayPL / Number(account.last_equity) : 0;
  const plColor = dayPL >= 0 ? green : red;

  return (
    <div style={{ background: bg, color: text, fontFamily: font, minHeight: "100vh" }}>
      <style>{pulseCSS}</style>
      <KillSwitchBanner />
      <BrokerNotConfiguredBanner broker="alpaca" />

      <div style={{ padding: "24px" }}>
      {/* Error banner */}
      {error && (
        <div style={{
          background: "var(--danger-20)", border: `1px solid ${red}`, color: red,
          padding: "10px 16px", borderRadius: 4, marginBottom: 16,
          display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{
            background: "none", border: "none", color: red, cursor: "pointer",
            fontFamily: font, fontSize: 16, fontWeight: 700, padding: "0 4px",
          }}>×</button>
        </div>
      )}

      {/* Status bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: `1px solid ${border}`, paddingBottom: 16 }}>
        <div style={{ fontSize: 22, color: green, fontWeight: 500 }}>Trading Desk</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Pill color={green}>PAPER</Pill>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: dim }}>
              {account && <><Pill color={green}>● {account.status}</Pill> <span style={{ marginLeft: 10 }}>DT COUNT: {account.daytrade_count}/3</span></>}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>{clock ? `${clock.toLocaleTimeString("en-US")} ET` : ""}</div>
          </div>
        </div>
      </div>

      {/* Account stats */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[1,2,3,4].map(i => <Skeleton key={i} height={72} />)}
        </div>
      ) : account ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
          <Stat label="Portfolio Value" value={`$${fmt(account.portfolio_value)}`} />
          <Stat label="Buying Power"    value={`$${fmt(account.buying_power)}`} />
          <Stat label="Cash"            value={`$${fmt(account.cash)}`} />
          <Stat label="Day P&L"         value={`${dayPL >= 0 ? "+" : ""}$${fmt(dayPL)} (${pct(dayPLpct)})`} color={plColor} />
        </div>
      ) : null}

      {/* Positions */}
      <Section title={`Positions (${positions.length})`}>
        {loading ? (
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {[1,2,3].map(i => <Skeleton key={i} height={32} />)}
          </div>
        ) : (
          <Table
            headers={["Symbol", "Side", "Qty", "Avg Entry", "Last", "Mkt Value", "Unrealized P&L", "%"]}
            rows={positions.map(p => {
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
        )}
      </Section>

      {/* Order Entry */}
      <OrderEntry
        ordersBlocked={ordersBlocked}
        brokerConfigured={brokerConfigured}
        onSubmitted={fetchData}
        onError={setError}
      />

      {/* Open orders */}
      <Section title={`Open Orders (${orders.length})`}>
        {loading ? (
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {[1,2].map(i => <Skeleton key={i} height={32} />)}
          </div>
        ) : (
          <Table
            headers={["Time", "Symbol", "Side", "Qty", "Type", "Price", "Status", ""]}
            rows={orders.map(o => [
              <span key="time" style={{ color: dim }}>{new Date(o.submitted_at).toLocaleTimeString("en-US")}</span>,
              <strong key="sym">{o.symbol}</strong>,
              <Pill key="side" color={o.side === "buy" ? green : red}>{o.side}</Pill>,
              o.qty,
              o.type.toUpperCase(),
              `$${fmt(o.limit_price || o.stop_price || "0")}`,
              <Pill key="status" color={o.status === "partially_filled" ? "var(--warning)" : green}>{o.status.replace("_", " ")}</Pill>,
              <button key="cancel" onClick={() => cancelOrder(o.id)} style={{
                background: "transparent", border: `1px solid ${red}`, color: red,
                padding: "2px 8px", borderRadius: 3, fontFamily: font, fontSize: 9,
                fontWeight: 700, letterSpacing: 1, cursor: "pointer",
              }}>×</button>,
            ])}
          />
        )}
      </Section>

      {/* Activity */}
      <Section title="Today's Activity">
        {loading ? (
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {[1,2,3].map(i => <Skeleton key={i} height={32} />)}
          </div>
        ) : (
          <Table
            headers={["Time", "Symbol", "Side", "Qty", "Price", "Event"]}
            rows={activities.map(a => [
              <span key="time" style={{ color: dim }}>{new Date(a.transaction_time).toLocaleTimeString("en-US")}</span>,
              <strong key="sym">{a.symbol}</strong>,
              <Pill key="side" color={a.side === "buy" ? green : red}>{a.side}</Pill>,
              a.qty,
              `$${fmt(a.price)}`,
              <Pill key="type" color={green}>{a.activity_type}</Pill>,
            ])}
          />
        )}
      </Section>

      <div style={{ fontSize: 10, color: dim, textAlign: "center", marginTop: 32, letterSpacing: 1.5 }}>
        DATA: ALPACA PAPER // NO REAL CAPITAL AT RISK
      </div>
      </div>{/* end padding wrapper */}
    </div>
  );
}

function OrderEntry({
  ordersBlocked,
  brokerConfigured,
  onSubmitted,
  onError,
}: {
  ordersBlocked: boolean;
  brokerConfigured: boolean;
  onSubmitted: () => void;
  onError: (msg: string) => void;
}) {
  const disabled = ordersBlocked || !brokerConfigured;
  const disabledTitle = ordersBlocked
    ? "Orders disabled — see banner"
    : !brokerConfigured
      ? "Configure your Alpaca API keys in Settings to enable orders."
      : undefined;
  const [orderSymbol, setOrderSymbol] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [orderType, setOrderType] = useState("market");
  const [orderLimitPrice, setOrderLimitPrice] = useState("");
  const [orderTif, setOrderTif] = useState("day");

  const inputStyle: React.CSSProperties = {
    background: "var(--bg)", border: `1px solid ${border}`, padding: "8px 10px",
    borderRadius: 3, fontSize: 13, color: text, fontFamily: font, width: "100%",
    boxSizing: "border-box",
  };

  const submitOrder = async (side: "buy" | "sell") => {
    if (!orderSymbol || !orderQty) return;
    try {
      const body: Record<string, string> = {
        symbol: orderSymbol.toUpperCase(),
        qty: orderQty,
        side,
        type: orderType,
        time_in_force: orderTif,
      };
      if (orderType === "limit" && orderLimitPrice) body.limit_price = orderLimitPrice;
      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOrderSymbol(""); setOrderQty(""); setOrderLimitPrice("");
      onSubmitted();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Order failed");
    }
  };

  return (
    <Section title="Order Entry">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto", gap: 10, padding: 14, alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>SYMBOL</div>
          <input autoComplete="off" value={orderSymbol} onChange={e => setOrderSymbol(e.target.value.toUpperCase())} placeholder="AAPL" style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>QTY</div>
          <input autoComplete="off" type="number" value={orderQty} onChange={e => setOrderQty(e.target.value)} placeholder="100" style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>TYPE</div>
          <select value={orderType} onChange={e => setOrderType(e.target.value)} style={inputStyle}>
            <option value="market">MARKET</option>
            <option value="limit">LIMIT</option>
            <option value="stop">STOP</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>LIMIT PRICE</div>
          <input autoComplete="off" type="number" step="0.01" value={orderLimitPrice} onChange={e => setOrderLimitPrice(e.target.value)} placeholder="—" disabled={orderType === "market"} style={{ ...inputStyle, opacity: orderType === "market" ? 0.4 : 1 }} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>TIF</div>
          <select value={orderTif} onChange={e => setOrderTif(e.target.value)} style={inputStyle}>
            <option value="day">DAY</option>
            <option value="gtc">GTC</option>
            <option value="ioc">IOC</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => submitOrder("buy")}
            disabled={disabled}
            title={disabledTitle}
            style={{
              background: "transparent", border: `1px solid ${green}`, color: green,
              padding: "8px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
              fontWeight: 700, letterSpacing: 1.5,
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >BUY</button>
          <button
            onClick={() => submitOrder("sell")}
            disabled={disabled}
            title={disabledTitle}
            style={{
              background: "transparent", border: `1px solid ${red}`, color: red,
              padding: "8px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
              fontWeight: 700, letterSpacing: 1.5,
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >SELL</button>
        </div>
      </div>
    </Section>
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
        <tr style={{ background: "var(--bg)" }}>
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
