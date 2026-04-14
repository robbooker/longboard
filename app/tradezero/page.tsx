"use client";

import React, { useState, useEffect, useCallback } from "react";
import { green, red, dim, text, font, tradezeroTheme } from "@/lib/theme";
import KillSwitchBanner, { useKillSwitchOrdersBlocked } from "@/components/KillSwitchBanner";
import BrokerNotConfiguredBanner, { useBrokerConfigured } from "@/components/BrokerNotConfiguredBanner";
import type { TZAccount, TZPosition, TZOrder } from "@/lib/tradezero";

const { TZ_BLUE, TZ_GOLD, amber, bg, card, cardHi, border } = tradezeroTheme;

// Static data — no API endpoints for these
const HALT_TICKER = [
  { symbol: "XELA", status: "LUDP", reason: "Volatility Pause",     time: "09:43:12" },
  { symbol: "BBBYQ", status: "SSR",  reason: "Short Sale Restricted", time: "09:31:00" },
  { symbol: "DJT",  status: "SSR",  reason: "Short Sale Restricted", time: "09:31:00" },
  { symbol: "NVDA", status: "T12",  reason: "News Pending",          time: "09:38:44" },
  { symbol: "GME",  status: "SSR",  reason: "Short Sale Restricted", time: "09:31:00" },
  { symbol: "SOUN", status: "LUDP", reason: "Volatility Pause",     time: "09:44:02" },
];

const ALERTS = [
  { time: "09:44:58", symbol: "XELA", pattern: "PARABOLIC",       severity: "high", detail: "+240% · halted LUDP" },
  { time: "09:42:31", symbol: "SOUN", pattern: "FADE SETUP",       severity: "med",  detail: "Failed breakout · fade candidate" },
  { time: "09:39:15", symbol: "RIOT", pattern: "VWAP REJECTION",   severity: "med",  detail: "2nd rejection · trend exhaustion" },
  { time: "09:35:02", symbol: "DJT",  pattern: "GAP-N-CRAP",       severity: "high", detail: "Opening drive failed" },
];

const fmt = (n: string | number, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const signColor = (n: string | number) => Number(n) >= 0 ? green : red;

const pulseCSS = `@keyframes skeletonPulse{0%,100%{opacity:.4}50%{opacity:.8}}`;

function Skeleton({ width = "100%", height = 16 }: { width?: string | number; height?: number }) {
  return (
    <div style={{
      width, height, background: card, border: `1px solid ${border}`,
      borderRadius: 4, animation: "skeletonPulse 1.5s ease-in-out infinite",
    }} />
  );
}


interface L2Entry { route: string; price: string; size: number }
interface TradeSale { time: string; price: string; size: number; side: string }
interface PendingOrder { symbol: string; qty: string; price: string; side: string; type: string; route: string }

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

function DepthRow({ row, side, maxSize }: { row: L2Entry; side: "bid" | "ask"; maxSize: number }) {
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

function OrderStatusPill({ status }: { status: string | undefined }) {
  const normalized = (status ?? "").toLowerCase();
  let color: string = dim;
  if (normalized === "filled") color = green;
  else if (normalized === "partiallyfilled" || normalized === "partially_filled" || normalized === "partial") color = "var(--warning)";
  else if (normalized === "rejected") color = red;
  else if (normalized === "cancelled" || normalized === "canceled") color = dim;
  else if (normalized === "new" || normalized === "open" || normalized === "working") color = TZ_BLUE;
  return <Pill color={color}>{status ?? "—"}</Pill>;
}

function fmtOrderTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function ConfirmOrderModal({ order, onConfirm, onCancel }: { order: PendingOrder; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: card, border: `1px solid ${border}`, borderRadius: 8,
        padding: 24, minWidth: 360, maxWidth: 440, fontFamily: font,
      }}>
        <div style={{ fontSize: 10, color: red, letterSpacing: 2, marginBottom: 16, textTransform: "uppercase", fontWeight: 700 }}>
          ⚠ LIVE ORDER CONFIRMATION
        </div>
        <div style={{ display: "grid", gap: 8, fontSize: 13, color: text, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: dim }}>Symbol</span><span style={{ fontWeight: 600 }}>{order.symbol}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: dim }}>Side</span><Pill color={order.side === "buy" ? green : red}>{order.side}</Pill>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: dim }}>Qty</span><span>{order.qty}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: dim }}>Type</span><span>{order.type}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: dim }}>Price</span><span>${order.price}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: dim }}>Route</span><Pill color={TZ_BLUE}>{order.route}</Pill>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onConfirm} style={{
            flex: 1, background: red, color: bg, border: "none", padding: "10px 16px",
            borderRadius: 4, fontFamily: font, fontSize: 12, fontWeight: 700,
            letterSpacing: 1.5, cursor: "pointer",
          }}>CONFIRM — LIVE ORDER</button>
          <button onClick={onCancel} style={{
            flex: 1, background: "transparent", border: `1px solid ${border}`, color: dim,
            padding: "10px 16px", borderRadius: 4, fontFamily: font, fontSize: 12,
            fontWeight: 500, cursor: "pointer",
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function TradeZeroPage() {
  const [clock, setClock] = useState<Date | null>(null);
  const [account, setAccount] = useState<TZAccount | null>(null);
  const [positions, setPositions] = useState<TZPosition[]>([]);
  const [orders, setOrders] = useState<TZOrder[]>([]);
  const [quotes, setQuotes] = useState<Record<string, { last: number }>>({});
  const [level2, setLevel2] = useState<{ bids: L2Entry[]; asks: L2Entry[] }>({ bids: [], asks: [] });
  const [timeSales, setTimeSales] = useState<TradeSale[]>([]);
  const [routes, setRoutes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusSymbol, setFocusSymbol] = useState("MARA");
  const [focusInput, setFocusInput] = useState("");

  const ordersBlocked = useKillSwitchOrdersBlocked();
  const brokerConfigured = useBrokerConfigured("tradezero");
  const tradeBlocked = ordersBlocked || !brokerConfigured;
  const tradeBlockedTitle = ordersBlocked
    ? "Orders disabled — see banner"
    : !brokerConfigured
      ? "Configure your TradeZero API keys in Settings to enable orders."
      : undefined;

  const fetchCore = useCallback(async () => {
    try {
      const [acctRes, posRes, ordRes] = await Promise.all([
        fetch("/api/tradezero/account"),
        fetch("/api/tradezero/positions"),
        fetch("/api/tradezero/orders"),
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

  const fetchMarketData = useCallback(async () => {
    try {
      const [l2Res, tradesRes] = await Promise.all([
        fetch(`/api/polygon/l2/${focusSymbol}`),
        fetch(`/api/polygon/trades/${focusSymbol}`),
      ]);
      const [l2Data, tradesData] = await Promise.all([l2Res.json(), tradesRes.json()]);

      // Transform Polygon quotes into L2 bid/ask entries
      const results = l2Data.results || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bids: L2Entry[] = results.slice(0, 5).map((q: any, i: number) => ({
        route: ["ARCA", "NSDQ", "EDGX", "BATS", "IEX"][i % 5],
        price: (q.bid_price || 0).toFixed(2),
        size: q.bid_size || 0,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const asks: L2Entry[] = results.slice(0, 5).map((q: any, i: number) => ({
        route: ["NSDQ", "ARCA", "EDGX", "BATS", "IEX"][i % 5],
        price: (q.ask_price || 0).toFixed(2),
        size: q.ask_size || 0,
      }));
      if (bids.length > 0 || asks.length > 0) setLevel2({ bids, asks });

      // Transform Polygon trades into time & sales
      const trades = tradesData.results || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sales: TradeSale[] = trades.slice(0, 10).map((t: any) => ({
        time: t.sip_timestamp ? new Date(t.sip_timestamp / 1e6).toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 }) : "--",
        price: (t.price || 0).toFixed(2),
        size: t.size || 0,
        side: (t.conditions || []).includes(38) ? "sell" : "buy",
      }));
      if (sales.length > 0) setTimeSales(sales);
    } catch {
      // Silent fail for market data — don't block the UI
    }
  }, [focusSymbol]);

  // Core data polling — 5s
  useEffect(() => {
    fetchCore();
    const interval = setInterval(fetchCore, 5000);
    return () => clearInterval(interval);
  }, [fetchCore]);

  // Quotes for every held position — one batch call per positions refresh.
  // Drives Last / P&L / P&L % columns in the Positions table.
  useEffect(() => {
    if (positions.length === 0) { setQuotes({}); return; }
    const symbols = Array.from(new Set(positions.map((p) => p.symbol).filter(Boolean)));
    if (symbols.length === 0) return;
    let cancelled = false;
    fetch(`/api/polygon/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.quotes) setQuotes(data.quotes); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [positions]);

  // Market data polling — 1s
  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 1000);
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  // Routes — fetch once
  useEffect(() => {
    fetch("/api/tradezero/routes")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setRoutes(data.map((r: { name?: string }) => r.name || String(r))); })
      .catch(() => {});
  }, []);

  // Clock
  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const maxBid = level2.bids.length > 0 ? Math.max(...level2.bids.map(r => r.size)) : 1;
  const maxAsk = level2.asks.length > 0 ? Math.max(...level2.asks.map(r => r.size)) : 1;

  const _ = routes; // consumed to avoid unused warning

  return (
    <div style={{ background: bg, color: text, fontFamily: font, minHeight: "100vh" }}>
      <style>{pulseCSS}</style>
      <KillSwitchBanner />
      <BrokerNotConfiguredBanner broker="tradezero" />

      <div style={{ padding: 24 }}>
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

      {/* Sponsor header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 20px", marginBottom: 20,
        background: `linear-gradient(90deg, ${TZ_BLUE}12, transparent 60%)`,
        border: `1px solid ${TZ_BLUE}40`, borderRadius: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div>
            <div style={{ fontSize: 10, color: dim, letterSpacing: 2 }}>POWERED BY</div>
            <div style={{ fontSize: 24, color: TZ_BLUE, fontWeight: 700, letterSpacing: -0.5, marginTop: 2 }}>
              TRADE<span style={{ color: TZ_GOLD }}>ZERO</span>
            </div>
          </div>
          <div style={{ height: 40, width: 1, background: border }} />
          <div style={{ display: "flex", gap: 8 }}>
            <Pill color={red} solid>⚠ LIVE ACCOUNT</Pill>
            {account && (
              <>
                <Pill color={TZ_GOLD} solid>{account.accountType || "LIVE"}</Pill>
                <Pill color={green}>● {account.accountStatus || "ACTIVE"}</Pill>
                <Pill color={TZ_BLUE}>{account.account || "—"}</Pill>
              </>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: dim }}>
          {/* TZ's current account response has no day-trades-used field.
              If/when TZ starts returning one, wire it here. */}
          <div style={{ marginTop: 4 }}>{clock ? `${clock.toLocaleTimeString("en-US")} ET` : ""}</div>
        </div>
      </div>

      {/* Halt / SSR ticker strip */}
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
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
          {[1,2,3,4].map(i => <Skeleton key={i} height={72} />)}
        </div>
      ) : account ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
          <Stat label="Equity" value={`$${fmt(account.equity ?? account.sodEquity ?? 0)}`} />
          <Stat label="Buying Power" value={`$${fmt(account.bp ?? 0)}`} sub={account.leverage ? `${account.leverage}:1 leverage` : undefined} />
          <Stat label="Cash" value={`$${fmt(account.availableCash ?? 0)}`} />
          <Stat label="Day P&L" value={`${Number(account.realized ?? 0) >= 0 ? "+" : ""}$${fmt(account.realized ?? 0)}`} color={signColor(account.realized ?? 0)} />
        </div>
      ) : null}

      {/* Positions */}
      <div style={{ marginBottom: 16 }}>
        <Card title="Positions" right={`${positions.length} open`}>
          {loading ? (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3].map(i => <Skeleton key={i} height={32} />)}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: cardHi }}>
                  {["Symbol", "Qty", "Avg", "Last", "P&L", "%"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, color: dim, letterSpacing: 1.2, fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Last / P&L / P&L % come from the Polygon quote batch. If a
                    quote hasn't arrived yet (first paint) we render "—".
                    Click a row to focus L2 + Time & Sales on that symbol. */}
                {positions.map((p, i) => {
                  const active = p.symbol === focusSymbol;
                  const last = quotes[p.symbol]?.last;
                  const hasQuote = typeof last === "number" && p.priceAvg > 0;
                  const pl = hasQuote ? (last - p.priceAvg) * p.shares : null;
                  const plpc = hasQuote ? (last - p.priceAvg) / p.priceAvg : null;
                  return (
                    <tr
                      key={p.positionId || p.symbol || i}
                      onClick={() => setFocusSymbol(p.symbol)}
                      style={{
                        borderBottom: `1px solid ${border}`,
                        borderLeft: active ? `2px solid ${TZ_BLUE}` : "2px solid transparent",
                        background: active ? `${TZ_BLUE}12` : "transparent",
                        cursor: "pointer",
                        transition: "background 120ms",
                      }}
                    >
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{p.symbol}</td>
                      <td style={{ padding: "10px 12px" }}>{Number(p.shares).toLocaleString()}</td>
                      <td style={{ padding: "10px 12px" }}>${fmt(p.priceAvg)}</td>
                      <td style={{ padding: "10px 12px" }}>{last != null ? `$${fmt(last)}` : <span style={{ color: dim }}>—</span>}</td>
                      <td style={{ padding: "10px 12px", color: pl != null ? signColor(pl) : dim }}>
                        {pl != null ? `${pl >= 0 ? "+" : ""}$${fmt(pl)}` : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", color: plpc != null ? signColor(plpc) : dim }}>
                        {plpc != null ? `${plpc >= 0 ? "+" : ""}${(plpc * 100).toFixed(2)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Open Orders */}
      <div style={{ marginBottom: 16 }}>
        <Card title="Open Orders" right={`${orders.length} active`}>
          {loading ? (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2].map(i => <Skeleton key={i} height={32} />)}
            </div>
          ) : orders.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", color: dim, fontSize: 12 }}>
              No open orders.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: cardHi }}>
                  {["Symbol", "Side", "Qty", "Price", "Type", "TIF", "Status", "Submitted"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, color: dim, letterSpacing: 1.2, fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => {
                  const priceShown = o.limitPrice ?? o.stopPrice;
                  const qty = o.orderQuantity ?? 0;
                  const filled = o.filledQuantity ?? 0;
                  const qtyLabel = filled > 0 && filled < qty
                    ? `${filled.toLocaleString()} / ${qty.toLocaleString()}`
                    : qty.toLocaleString();
                  const sideColor = (o.side ?? "").toLowerCase() === "sell" ? red : green;
                  return (
                    <tr key={o.orderId || i} style={{ borderBottom: `1px solid ${border}` }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{o.symbol}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <Pill color={sideColor}>{o.side ?? "—"}</Pill>
                      </td>
                      <td style={{ padding: "10px 12px" }}>{qtyLabel}</td>
                      <td style={{ padding: "10px 12px" }}>{priceShown != null ? `$${fmt(priceShown)}` : "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{o.orderType ?? "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{o.timeInForce ?? "—"}</td>
                      <td style={{ padding: "10px 12px" }}><OrderStatusPill status={o.status} /></td>
                      <td style={{ padding: "10px 12px", color: dim, fontSize: 11 }}>{fmtOrderTime(o.createdDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Focus symbol — drives Level 2 + Time & Sales. Click any positions
          row above or type a symbol here. Independent of Quick Order. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
        padding: "8px 12px", background: card, border: `1px solid ${border}`, borderRadius: 6,
      }}>
        <span style={{ fontSize: 10, color: dim, letterSpacing: 1.5, textTransform: "uppercase" }}>Focus</span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = focusInput.trim().toUpperCase();
            if (next) setFocusSymbol(next);
            setFocusInput("");
          }}
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            value={focusInput}
            onChange={(e) => setFocusInput(e.target.value)}
            onBlur={() => {
              const next = focusInput.trim().toUpperCase();
              if (next && next !== focusSymbol) setFocusSymbol(next);
              setFocusInput("");
            }}
            placeholder={focusSymbol}
            autoComplete="off"
            spellCheck={false}
            style={{
              background: cardHi, border: `1px solid ${border}`, padding: "4px 8px",
              borderRadius: 3, fontSize: 12, color: text, fontFamily: font, width: 100,
              textTransform: "uppercase", outline: "none",
            }}
          />
        </form>
        <span style={{ fontSize: 11, color: dim }}>
          tracking <strong style={{ color: TZ_BLUE, fontWeight: 600 }}>{focusSymbol}</strong>
        </span>
      </div>

      {/* Level 2 + Time & Sales + Pattern Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card title={`Level 2 · ${focusSymbol}`} right="Direct Access">
          {level2.bids.length === 0 && level2.asks.length === 0 ? (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3,4,5].map(i => <Skeleton key={i} height={20} />)}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <div style={{ borderRight: `1px solid ${border}` }}>
                <div style={{ padding: "6px 10px", fontSize: 10, color: green, letterSpacing: 1.5, background: cardHi }}>BID</div>
                {level2.bids.map((r, i) => <DepthRow key={i} row={r} side="bid" maxSize={maxBid} />)}
              </div>
              <div>
                <div style={{ padding: "6px 10px", fontSize: 10, color: red, letterSpacing: 1.5, background: cardHi, textAlign: "right" }}>ASK</div>
                {level2.asks.map((r, i) => <DepthRow key={i} row={r} side="ask" maxSize={maxAsk} />)}
              </div>
            </div>
          )}
        </Card>

        <Card title={`Time & Sales · ${focusSymbol}`} right="streaming">
          {timeSales.length === 0 ? (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3,4,5].map(i => <Skeleton key={i} height={20} />)}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {timeSales.map((t, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
                    <td style={{ padding: "7px 12px", color: dim, fontSize: 11 }}>{t.time}</td>
                    <td style={{ padding: "7px 12px", color: t.side === "buy" ? green : red, fontWeight: 500 }}>${t.price}</td>
                    <td style={{ padding: "7px 12px", textAlign: "right" }}>{t.size.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

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
      <QuickOrder
        ordersBlocked={tradeBlocked}
        ordersBlockedTitle={tradeBlockedTitle}
        onSubmitted={fetchCore}
        onError={setError}
      />

      <div style={{ fontSize: 10, color: dim, textAlign: "center", marginTop: 28, letterSpacing: 1.5 }}>
        ★ TRADEZERO PRO · LIVE TRADING · L2 · DIRECT ROUTING ★
      </div>
      </div>{/* end padding wrapper */}
    </div>
  );
}

function QuickOrder({
  ordersBlocked,
  ordersBlockedTitle,
  onSubmitted,
  onError,
}: {
  ordersBlocked: boolean;
  ordersBlockedTitle: string | undefined;
  onSubmitted: () => void;
  onError: (msg: string) => void;
}) {
  const [orderSymbol, setOrderSymbol] = useState("MARA");
  const [orderQty, setOrderQty] = useState("1000");
  const [orderPrice, setOrderPrice] = useState("18.04");
  const [orderType, setOrderType] = useState("LIMIT");
  const [orderRoute, setOrderRoute] = useState("SMART");
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);

  const inputStyle: React.CSSProperties = {
    background: cardHi, border: `1px solid ${border}`, padding: "8px 10px",
    borderRadius: 3, fontSize: 13, color: text, fontFamily: font, width: "100%",
    boxSizing: "border-box",
  };

  const showOrderModal = (side: string) => {
    if (!orderSymbol || !orderQty) return;
    setPendingOrder({ symbol: orderSymbol.toUpperCase(), qty: orderQty, price: orderPrice, side, type: orderType, route: orderRoute });
  };

  const confirmOrder = async () => {
    if (!pendingOrder) return;
    try {
      const res = await fetch("/api/tradezero/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingOrder),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPendingOrder(null);
      onSubmitted();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Order failed");
      setPendingOrder(null);
    }
  };

  return (
    <>
      {pendingOrder && (
        <ConfirmOrderModal order={pendingOrder} onConfirm={confirmOrder} onCancel={() => setPendingOrder(null)} />
      )}
      <Card title="Quick Order · Direct Access" right="ROUTE SMART">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto", gap: 10, padding: 14, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>SYMBOL</div>
            <input autoComplete="off" value={orderSymbol} onChange={e => setOrderSymbol(e.target.value.toUpperCase())} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>QTY</div>
            <input autoComplete="off" type="number" value={orderQty} onChange={e => setOrderQty(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>PRICE</div>
            <input autoComplete="off" type="number" step="0.01" value={orderPrice} onChange={e => setOrderPrice(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>TYPE</div>
            <select value={orderType} onChange={e => setOrderType(e.target.value)} style={inputStyle}>
              <option value="LIMIT">LIMIT</option>
              <option value="MARKET">MARKET</option>
              <option value="STOP">STOP</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9, color: dim, letterSpacing: 1.5, marginBottom: 5 }}>ROUTE</div>
            <select value={orderRoute} onChange={e => setOrderRoute(e.target.value)} style={inputStyle}>
              <option value="SMART">SMART</option>
              <option value="ARCA">ARCA</option>
              <option value="NSDQ">NSDQ</option>
              <option value="EDGX">EDGX</option>
              <option value="BATS">BATS</option>
              <option value="IEX">IEX</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <ActionBtn color={green} onClick={() => showOrderModal("buy")} disabled={ordersBlocked} title={ordersBlockedTitle}>BUY</ActionBtn>
            <ActionBtn color={red} onClick={() => showOrderModal("sell")} disabled={ordersBlocked} title={ordersBlockedTitle}>SELL</ActionBtn>
          </div>
        </div>
      </Card>
    </>
  );
}

function ActionBtn({ children, color, onClick, disabled, title }: { children: React.ReactNode; color: string; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      background: "transparent", border: `1px solid ${color}`, color,
      padding: "8px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
      fontWeight: 700, letterSpacing: 1.5,
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
    }}>{children}</button>
  );
}

