"use client";
// #468 Trading Desk: Rob's TradeZero account at a glance, view only. The account strip (day P&L first),
// open positions, open orders and the bot's activity today. A mock-up for now: the numbers come from
// /api/chat/trading-desk (owner only), which serves sample data in TradeZero's shape; the home
// computer's feed replaces it later. There is deliberately no control here that trades, cancels or
// closes anything, and nothing that pauses or starts the bot: the status pill only reports it.
import { useEffect, useState } from "react";
import {
  deskClock,
  deskFreshness,
  formatMoney,
  formatPercent,
  formatPrice,
  formatShares,
  tone,
  type DeskOrder,
  type DeskPosition,
  type DeskView,
} from "@/lib/tradingDesk";
import styles from "./TradingDesk.module.css";

const READ_EVERY_MS = 10_000;

type Loaded = { desk: DeskView; /** Browser clock minus server clock when it was read. */ skew: number };
type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | ({ kind: "ready" } & Loaded);

function useDesk(): State {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      clearTimeout(timer);
      try {
        const response = await fetch("/api/chat/trading-desk", { cache: "no-store", signal: controller.signal });
        if (response.status === 404) return setState({ kind: "missing" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { desk: DeskView; serverNow: string };
        const server = Date.parse(body.serverNow);
        setState({ kind: "ready", desk: body.desk, skew: Number.isFinite(server) ? Date.now() - server : 0 });
      } catch {
        if (controller.signal.aborted) return;
        // Keep what is on screen (it turns amber as it ages); show the error only before a first read.
        setState((current) => (current.kind === "ready" ? current : { kind: "error" }));
      }
      if (!controller.signal.aborted && document.visibilityState === "visible") timer = setTimeout(read, READ_EVERY_MS);
    };
    const shown = () => {
      if (document.visibilityState === "visible") void read();
      else clearTimeout(timer);
    };
    void read();
    document.addEventListener("visibilitychange", shown);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, []);
  return state;
}

/** The time now, once a second, for "Updated 3s ago". */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Money({ value, sign, className }: { value: number; sign?: boolean; className?: string }) {
  return (
    <span className={[styles.num, sign ? styles[tone(value)] : "", className ?? ""].join(" ")} data-tone={sign ? tone(value) : undefined}>
      {formatMoney(value, { sign })}
    </span>
  );
}

function Percent({ value }: { value: number }) {
  return (
    <span className={`${styles.num} ${styles[tone(value)]}`} data-tone={tone(value)}>
      {formatPercent(value)}
    </span>
  );
}

function By({ who }: { who: "Bot" | "Rob" | null }) {
  if (!who) return <span className={styles.muted}>—</span>;
  return (
    <span className={styles.by} data-by={who.toLowerCase()}>
      {who}
    </span>
  );
}

function Side({ side }: { side: string }) {
  return (
    <span className={styles.side} data-side={side.toLowerCase()}>
      {side}
    </span>
  );
}

function AccountStrip({ desk }: { desk: DeskView }) {
  const { account } = desk;
  const { gross, long, short } = account.exposure;
  const longShare = gross > 0 ? Math.round((long / (long + short || 1)) * 100) : 50;
  return (
    <section className={styles.strip} aria-label="Account" data-desk-section="account">
      <div className={styles.hero}>
        <span className={styles.label}>Day P&amp;L</span>
        <Money value={account.dayPnl} sign className={styles.heroNumber} />
        <span className={styles.split}>
          <span>
            Realized <Money value={account.dayRealized} sign />
          </span>
          <span>
            Unrealized <Money value={account.dayUnrealized} sign />
          </span>
        </span>
      </div>
      <div className={styles.tile}>
        <span className={styles.label}>Open P&amp;L</span>
        <Money value={account.openPnl} sign className={styles.tileNumber} />
        <span className={styles.note}>{desk.positions.length} positions</span>
      </div>
      <div className={styles.tile}>
        <span className={styles.label}>Equity</span>
        <Money value={account.equity} className={styles.tileNumber} />
      </div>
      <div className={styles.tile}>
        <span className={styles.label}>Buying power</span>
        <Money value={account.buyingPower} className={styles.tileNumber} />
      </div>
      <div className={styles.tile}>
        <span className={styles.label}>Exposure</span>
        <Money value={gross} className={styles.tileNumber} />
        <span className={styles.bar} aria-hidden="true">
          <span className={styles.barLong} style={{ width: `${longShare}%` }} />
        </span>
        <span className={styles.note}>
          <span>
            <i className={styles.keyLong} aria-hidden="true" />
            Long <span className={styles.num}>{formatMoney(long, { cents: false })}</span>
          </span>
          <span>
            <i className={styles.keyShort} aria-hidden="true" />
            Short <span className={styles.num}>{formatMoney(short, { cents: false })}</span>
          </span>
        </span>
      </div>
    </section>
  );
}

function PositionsTable({ desk, now }: { desk: DeskView; now: Date }) {
  const { totals } = desk;
  return (
    <section className={styles.panel} aria-labelledby="desk-positions" data-desk-section="positions">
      <h3 className={styles.heading} id="desk-positions">
        Open positions <span className={styles.count}>{desk.positions.length}</span>
      </h3>
      <div className={styles.frame} tabIndex={0} aria-label="Open positions, scrolls">
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.symbol} scope="col">Symbol</th>
              <th scope="col">Side</th>
              <th className={styles.right} scope="col">Shares</th>
              <th className={styles.right} scope="col">Avg</th>
              <th className={styles.right} scope="col">Last</th>
              <th className={styles.right} scope="col">Open P&amp;L</th>
              <th className={styles.right} scope="col">Open %</th>
              <th className={styles.right} scope="col">Day P&amp;L</th>
              <th className={styles.right} scope="col">Exposure</th>
              <th className={styles.right} scope="col">Opened</th>
              <th scope="col">By</th>
            </tr>
          </thead>
          <tbody>
            {desk.positions.map((p: DeskPosition) => (
              <tr key={p.id} data-desk-position={p.symbol}>
                <th className={styles.symbol} scope="row">{p.symbol}</th>
                <td><Side side={p.side} /></td>
                <td className={`${styles.right} ${styles.num}`}>{formatShares(p.shares)}</td>
                <td className={`${styles.right} ${styles.num}`}>{formatPrice(p.avgPrice)}</td>
                <td className={`${styles.right} ${styles.num}`}>{formatPrice(p.last)}</td>
                <td className={styles.right}><Money value={p.openPnl} sign /></td>
                <td className={styles.right}><Percent value={p.openPnlPct} /></td>
                <td className={styles.right}><Money value={p.dayPnl} sign /></td>
                <td className={styles.right}><Money value={p.exposure} /></td>
                <td className={`${styles.right} ${styles.num} ${styles.muted}`}>{deskClock(p.openedAt, now)}</td>
                <td><By who={p.openedBy} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-desk-totals>
              <th className={styles.symbol} scope="row">Total</th>
              <td className={styles.muted} colSpan={4}>{totals.count} positions</td>
              <td className={styles.right}><Money value={totals.openPnl} sign /></td>
              <td className={styles.right}><Percent value={totals.openPnlPct} /></td>
              <td className={styles.right}><Money value={totals.dayPnl} sign /></td>
              <td className={styles.right}><Money value={totals.exposure} /></td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function OrdersTable({ desk, now }: { desk: DeskView; now: Date }) {
  return (
    <section className={styles.panel} aria-labelledby="desk-orders" data-desk-section="orders">
      <h3 className={styles.heading} id="desk-orders">
        Open orders <span className={styles.count}>{desk.orders.length}</span>
      </h3>
      <div className={styles.frame} tabIndex={0} aria-label="Open orders, scrolls">
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.symbol} scope="col">Symbol</th>
              <th scope="col">Side</th>
              <th scope="col">Type</th>
              <th scope="col">TIF</th>
              <th className={styles.right} scope="col">Qty</th>
              <th className={styles.right} scope="col">Filled / left</th>
              <th className={styles.right} scope="col">Price</th>
              <th scope="col">Route</th>
              <th scope="col">Status</th>
              <th className={styles.right} scope="col">Placed</th>
              <th scope="col">By</th>
            </tr>
          </thead>
          <tbody>
            {desk.orders.map((o: DeskOrder) => (
              <tr key={o.id} data-desk-order={o.type}>
                <th className={styles.symbol} scope="row">{o.symbol}</th>
                <td><Side side={o.side} /></td>
                <td>{o.type}</td>
                <td className={styles.num}>{o.tif}</td>
                <td className={`${styles.right} ${styles.num}`}>{formatShares(o.qty)}</td>
                <td className={`${styles.right} ${styles.num}`}>
                  <span className={o.filled > 0 ? undefined : styles.muted}>{formatShares(o.filled)}</span>
                  <span className={styles.muted}> / </span>
                  {formatShares(o.remaining)}
                </td>
                <td className={`${styles.right} ${styles.num} ${styles.price}`} data-desk-price>{o.price}</td>
                <td className={`${styles.num} ${styles.muted}`}>{o.route}</td>
                <td>
                  <span className={styles.status} data-status={o.status === "Partially filled" ? "partial" : o.status.toLowerCase()}>
                    {o.status}
                  </span>
                </td>
                <td className={`${styles.right} ${styles.num} ${styles.muted}`}>{deskClock(o.placedAt, now)}</td>
                <td><By who={o.placedBy} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const KIND_LABEL = { fill: "Fill", cancel: "Cancel", placed: "Order", "stop-moved": "Stop" } as const;

function ActivityFeed({ desk, now }: { desk: DeskView; now: Date }) {
  return (
    <section className={`${styles.panel} ${styles.activity}`} aria-labelledby="desk-activity" data-desk-section="activity">
      <h3 className={styles.heading} id="desk-activity">
        Today&rsquo;s activity <span className={styles.count}>{desk.activity.length}</span>
      </h3>
      <ol className={styles.feed}>
        {desk.activity.map((line, i) => (
          <li key={`${line.at}-${i}`} data-desk-activity={line.kind}>
            <time className={`${styles.num} ${styles.muted}`} dateTime={line.at}>
              {deskClock(line.at, now)}
            </time>
            <span className={styles.kind} data-kind={line.kind}>
              {KIND_LABEL[line.kind]}
            </span>
            <span className={styles.line}>{line.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function TradingDesk({ compact = false }: { compact?: boolean }) {
  const state = useDesk();
  const nowMs = useNow();
  if (state.kind !== "ready")
    return (
      <div className={styles.scroll} data-trading-desk data-desk-state={state.kind}>
        <p className={styles.message} role="status">
          {state.kind === "loading" ? "Loading the desk…" : state.kind === "missing" ? "This page isn't available." : "The desk couldn't be read. It will try again."}
        </p>
      </div>
    );
  const { desk, skew } = state;
  // Ages come from the server's clock, so a browser clock that is off doesn't make the data look stale.
  const age = nowMs - skew - Date.parse(desk.updatedAt);
  const fresh = deskFreshness(age, desk.source);
  const now = new Date(nowMs - skew);
  return (
    <div className={styles.scroll} data-trading-desk data-desk-state="ready" data-compact={compact || undefined}>
      <div className={styles.desk} data-desk-stale={fresh.stale || undefined}>
        <header className={styles.head}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>TradeZero</h2>
            {desk.sample && (
              <span className={styles.sample} data-desk-sample title="Made-up numbers and tickers for the mock-up">
                Sample data
              </span>
            )}
          </div>
          <div className={styles.meta}>
            <span
              className={styles.pill}
              data-desk-automation={desk.automation}
              title="Read only: the bot is run from the home computer"
            >
              <i className={styles.dot} aria-hidden="true" />
              Automated · {desk.automation === "running" ? "Running" : "Paused"}
            </span>
            <span className={styles.updated} data-desk-updated role="status" aria-live="off">
              {fresh.stale && <i className={styles.warnMark} aria-hidden="true">!</i>}
              {fresh.label}
            </span>
          </div>
        </header>
        {fresh.stale && (
          <p className={styles.staleNote} data-desk-stale-note>
            No fresh numbers from the {desk.source} for over 30 seconds. What you see may be out of date.
          </p>
        )}
        <AccountStrip desk={desk} />
        <div className={styles.grid}>
          <div className={styles.tables}>
            <PositionsTable desk={desk} now={now} />
            <OrdersTable desk={desk} now={now} />
          </div>
          <ActivityFeed desk={desk} now={now} />
        </div>
        <p className={styles.footnote}>View only. Nothing here places, changes or cancels an order. Times are New York.</p>
      </div>
    </div>
  );
}
