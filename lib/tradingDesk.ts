// #468 Trading Desk: TradeZero's shape (lib/tradeZeroFeed.ts) turned into what the page draws, and
// the number formats it uses. Pure functions; nothing here reads a key, calls TradeZero or trades.
import type { TradeZeroFeed, TzOrderStatus, TzOrderType, TzTimeInForce } from "./tradeZeroFeed";

/** Data older than this is drawn amber ("stale"): the home computer may have stopped sending. */
export const DESK_STALE_AFTER_MS = 30_000;

/**
 * #469: when the desk turns amber. The home computer reads TradeZero every 5 s in market hours and
 * every 60 s otherwise (it says which in bridge.feed.pollEveryMs), so outside market hours a minute-old
 * read is normal: amber after 2.5 reads are missed, never sooner than DESK_STALE_AFTER_MS.
 */
export function deskStaleAfterMs(pollEveryMs: number | null | undefined): number {
  return typeof pollEveryMs === "number" && Number.isFinite(pollEveryMs) && pollEveryMs > 0
    ? Math.max(DESK_STALE_AFTER_MS, Math.min(3_600_000, Math.round(pollEveryMs * 2.5)))
    : DESK_STALE_AFTER_MS;
}

export type DeskSide = "Long" | "Short";
export type DeskBy = "Bot" | "Rob";

export type DeskPosition = {
  id: string;
  symbol: string;
  side: DeskSide;
  shares: number;
  avgPrice: number;
  /** Not sent by TradeZero (it has no quotes): worked back from the open P&L. */
  last: number;
  openPnl: number;
  /** Open P&L as a share of what the position cost, in percent (positive is a gain either way). */
  openPnlPct: number;
  /** Null when TradeZero doesn't send a day P&L for the position: shown as "—". */
  dayPnl: number | null;
  exposure: number;
  openedAt: string | null;
  openedBy: DeskBy | null;
};

export type DeskPositionTotals = {
  count: number;
  openPnl: number;
  openPnlPct: number;
  dayPnl: number | null;
  exposure: number;
};

export type DeskOrderType = "Market" | "Limit" | "Stop" | "Stop Limit" | "Range";
export type DeskTif = "Day" | "Day+" | "GTC" | "GTC+";
export type DeskOrderStatus = "Working" | "Partially filled" | "Pending";

export type DeskOrder = {
  id: string;
  symbol: string;
  /** Null (shown "—") when TradeZero's reply leaves it out or spells it some other way. */
  side: "Buy" | "Sell" | "Short" | "Cover" | null;
  type: DeskOrderType | null;
  tif: DeskTif | null;
  qty: number;
  filled: number;
  remaining: number;
  /** "2.65", "Stop 8.25", "Stop 12.40 · Lmt 12.55", "1.98 – 2.70" (low – high), "MKT". */
  price: string;
  route: string;
  status: DeskOrderStatus;
  placedAt: string | null;
  placedBy: DeskBy;
};

export type DeskActivity = { at: string; kind: "fill" | "cancel" | "placed" | "stop-moved"; symbol: string; text: string };

export type DeskView = {
  sample: boolean;
  /** #469: Paper or Live, from TradeZero's account (null when it doesn't say, and in the sample). */
  accountType: "Paper" | "Live" | null;
  updatedAt: string;
  source: string;
  automation: "running" | "paused" | "off";
  /** #469: age at which the numbers are drawn amber (see deskStaleAfterMs). */
  staleAfterMs: number;
  /** #469: the home computer's latest problems reading TradeZero (empty when all is well). */
  feedErrors: string[];
  account: {
    /** Null (shown "—") when TradeZero's reply leaves it out. */
    equity: number | null;
    buyingPower: number | null;
    dayPnl: number | null;
    dayRealized: number | null;
    dayUnrealized: number | null;
    openPnl: number | null;
    exposure: { gross: number; long: number; short: number };
  };
  positions: DeskPosition[];
  totals: DeskPositionTotals;
  orders: DeskOrder[];
  activity: DeskActivity[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
/** A number, or null when it is missing (the desk shows "—"). */
const maybe = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? round2(value) : null);

/** `pnl` as a percent of `cost`, to two decimals; 0 when there is no cost. */
export function pnlPercent(pnl: number, cost: number): number {
  return cost > 0 ? Math.round((pnl / cost) * 10_000) / 100 : 0;
}

const ORDER_TYPES: Record<TzOrderType, DeskOrderType> = { Market: "Market", Limit: "Limit", Stop: "Stop", StopLimit: "Stop Limit", Range: "Range" };
const TIFS: Record<TzTimeInForce, DeskTif> = { Day: "Day", Day_Plus: "Day+", GTC: "GTC", GTC_Plus: "GTC+" };
const STATUSES: Record<TzOrderStatus, DeskOrderStatus> = { New: "Working", PartiallyFilled: "Partially filled", PendingNew: "Pending" };

/** A price as the desk shows it: four places under $1 (small caps trade in tenths of a cent), else two. */
export function formatPrice(value: number): string {
  const places = Math.abs(value) < 1 ? 4 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
}

/** What the order's price column says for its type. A range shows its low first, whatever order it came in. */
export function orderPriceLabel(order: { orderType: TzOrderType | null; limitPrice: number | null; stopPrice: number | null; rangeLowPrice: number | null; rangeHighPrice: number | null }): string {
  const price = (value: number | null) => (value === null || !Number.isFinite(value) ? "—" : formatPrice(value));
  switch (order.orderType) {
    case null:
      // #469: TradeZero didn't say which type: show the limit price when there is one.
      return price(order.limitPrice);
    case "Market":
      return "MKT";
    case "Limit":
      return price(order.limitPrice);
    case "Stop":
      return `Stop ${price(order.stopPrice)}`;
    case "StopLimit":
      return `Stop ${price(order.stopPrice)} · Lmt ${price(order.limitPrice)}`;
    case "Range": {
      const { rangeLowPrice: a, rangeHighPrice: b } = order;
      if (a === null || b === null) return `${price(a)} – ${price(b)}`;
      return `${formatPrice(Math.min(a, b))} – ${formatPrice(Math.max(a, b))}`;
    }
  }
}

/** The bot's orders carry a "bot-" client order id (set by the home computer); anything else is Rob's. */
export function placedBy(clientOrderId: string): DeskBy {
  return /^bot-/i.test(clientOrderId) ? "Bot" : "Rob";
}

/** TradeZero's feed as the desk's rows: positions with their P&L, totals, working orders, the activity newest first. */
export function deskFromTradeZero(feed: TradeZeroFeed): DeskView {
  const pnlById = new Map(feed.pnl.pnl.map((row) => [row.positionId, row]));
  const positions: DeskPosition[] = feed.positions.map((p) => {
    const pnl = pnlById.get(p.positionId);
    const shares = Math.abs(finite(p.shares));
    const avgPrice = finite(p.priceAvg);
    const openPnl = round2(finite(pnl?.unrealizedPnL));
    const direction = p.side === "Short" ? -1 : 1;
    const last = shares > 0 ? avgPrice + (openPnl / shares) * direction : avgPrice;
    const meta = feed.bridge.positions[p.symbol];
    return {
      id: p.positionId,
      symbol: p.symbol,
      side: p.side === "Short" ? "Short" : "Long",
      shares,
      avgPrice,
      last: Math.round(last * 10_000) / 10_000,
      openPnl,
      openPnlPct: pnlPercent(openPnl, avgPrice * shares),
      dayPnl: maybe(pnl?.dayPnl),
      exposure: round2(finite(pnl?.exposure) || last * shares),
      openedAt: meta?.openedAt ?? null,
      openedBy: meta ? (meta.openedBy === "bot" ? "Bot" : "Rob") : null,
    };
  });
  const sum = (pick: (p: DeskPosition) => number, rows = positions) => round2(rows.reduce((total, p) => total + pick(p), 0));
  const dayKnown = positions.filter((p) => p.dayPnl !== null);
  const openPnl = sum((p) => p.openPnl);
  const totals: DeskPositionTotals = {
    count: positions.length,
    openPnl,
    openPnlPct: pnlPercent(openPnl, positions.reduce((total, p) => total + p.avgPrice * p.shares, 0)),
    dayPnl: positions.length && !dayKnown.length ? null : sum((p) => p.dayPnl ?? 0, dayKnown),
    exposure: sum((p) => p.exposure),
  };
  const long = sum((p) => p.exposure, positions.filter((p) => p.side === "Long"));
  const short = sum((p) => p.exposure, positions.filter((p) => p.side === "Short"));
  const orders: DeskOrder[] = feed.orders.map((o) => {
    const qty = Math.abs(finite(o.orderQuantity));
    const remaining = Math.min(qty, Math.abs(finite(o.leavesQuantity)));
    return {
      id: o.clientOrderId,
      symbol: o.symbol,
      side: o.side ?? null,
      type: (o.orderType && ORDER_TYPES[o.orderType]) || null,
      tif: (o.timeInForce && TIFS[o.timeInForce]) || null,
      qty,
      filled: qty - remaining,
      remaining,
      price: orderPriceLabel(o),
      route: o.route,
      status: STATUSES[o.orderStatus] ?? "Working",
      placedAt: o.createdDate ?? null,
      placedBy: placedBy(o.clientOrderId),
    };
  });
  const dayPnl = maybe(feed.pnl.dayPnl);
  const dayUnrealized = maybe(feed.pnl.dayUnrealized);
  const automation = feed.bridge.automation;
  return {
    sample: feed.sample,
    accountType: feed.sample ? null : feed.account.accountType === "Paper" || feed.account.accountType === "Live" ? feed.account.accountType : null,
    updatedAt: feed.bridge.updatedAt,
    source: feed.bridge.source,
    automation: automation === "paused" || automation === "off" ? automation : "running",
    staleAfterMs: deskStaleAfterMs(feed.bridge.feed?.pollEveryMs),
    feedErrors: feed.bridge.feed?.errors ?? [],
    account: {
      equity: maybe(feed.account.equity),
      buyingPower: maybe(feed.account.buyingPower),
      dayPnl,
      dayRealized: dayPnl !== null && dayUnrealized !== null ? round2(dayPnl - dayUnrealized) : null,
      dayUnrealized,
      openPnl: maybe(feed.pnl.totalUnrealized) ?? openPnl,
      exposure: { gross: round2(finite(feed.pnl.exposure) || long + short), long, short },
    },
    positions,
    totals,
    orders,
    activity: [...feed.bridge.activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  };
}

/** Dollars: "$52,418.60"; with sign: "+$1,080.00" / "−$460.00" (a real minus sign). */
export function formatMoney(value: number, options: { sign?: boolean; cents?: boolean } = {}): string {
  const cents = options.cents ?? true;
  const body = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const rounded = Number(Math.abs(value).toFixed(cents ? 2 : 0));
  const sign = rounded === 0 ? "" : value < 0 ? "−" : options.sign ? "+" : "";
  return `${sign}$${body}`;
}

/** "+12.62%" / "−7.42%". */
export function formatPercent(value: number): string {
  const rounded = Number(Math.abs(value).toFixed(2));
  const sign = rounded === 0 ? "" : value < 0 ? "−" : "+";
  return `${sign}${rounded.toFixed(2)}%`;
}

export function formatShares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** "up", "down" or "flat", for colouring a P&L. */
export function tone(value: number): "up" | "down" | "flat" {
  const rounded = Math.round(value * 100);
  return rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
}

/** "09:41" in New York (24-hour, so the times line up); with the day ("Nov 18 15:31") when it isn't `now`'s New York day. */
export function deskClock(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "—";
  const zone = "America/New_York";
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: zone });
  const time = when.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: false });
  return day(when) === day(now) ? time : `${when.toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "numeric" })} ${time}`;
}

/** How fresh the data is: "Updated 3s ago from home computer", amber past `staleAfterMs` (DESK_STALE_AFTER_MS by default). */
export function deskFreshness(ageMs: number, source: string, staleAfterMs = DESK_STALE_AFTER_MS): { stale: boolean; label: string } {
  const age = Math.max(0, ageMs);
  const seconds = Math.floor(age / 1000);
  const ago =
    seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min` : seconds < 86_400 ? `${Math.floor(seconds / 3600)} h` : `${Math.floor(seconds / 86_400)} d`;
  return { stale: age > staleAfterMs, label: `Updated ${ago} ago from ${source}` };
}

/** "30 seconds", "2 minutes": the stale limit as the warning says it. */
export function staleLimitLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) return `${seconds} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}
