// #469 Trading Desk: checks a snapshot the home computer sends (POST /api/chat/trading-desk/feed)
// before it is saved, and again when it is read back. Only the fields lib/tradeZeroFeed.ts names are
// kept (the object is rebuilt, so nothing extra is stored), every number must be finite and of a
// believable size, every text short, every list bounded. Anything else and the whole snapshot is refused.
import type {
  BridgeActivity,
  BridgeFeedStatus,
  TradeZeroFeed,
  TzAccount,
  TzOrder,
  TzOrderSide,
  TzOrderStatus,
  TzOrderType,
  TzPnl,
  TzPosition,
  TzPositionPnl,
  TzTimeInForce,
} from "./tradeZeroFeed";

/** #469: the home computer's token for the ingest route only (the same value is its feed.token). */
export const DESK_FEED_TOKEN_ENV = "CHAT_TRADING_DESK_FEED_TOKEN";

/** The largest body the ingest route reads. 300 orders at about 400 bytes each fit with room. */
export const DESK_FEED_MAX_BYTES = 196_608;
export const DESK_FEED_MAX_POSITIONS = 200;
export const DESK_FEED_MAX_ORDERS = 300;
const MAX_ACTIVITY = 200;
const MAX_ERRORS = 5;
const LIMIT = 1e12;
/** The home computer's clock may run a little ahead; a snapshot from further ahead is refused. */
const FUTURE_MS = 5 * 60_000;

class Invalid extends Error {}
const fail = (): never => {
  throw new Invalid();
};

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : fail());
const arr = (value: unknown, max: number): unknown[] => (Array.isArray(value) && value.length <= max ? value : fail());
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= LIMIT ? value : fail();
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));
const str = (value: unknown, max: number, pattern?: RegExp): string =>
  typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) && (!pattern || pattern.test(value))
    ? value
    : fail();
const strOrNull = (value: unknown, max: number): string | null => (value === null || value === undefined ? null : str(value, max));
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T =>
  options.includes(value as T) ? (value as T) : fail();
const oneOfOrNull = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  value === null || value === undefined ? null : oneOf(value, options);
const iso = (value: unknown): string => {
  const text = str(value, 40);
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : fail();
};
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));

const SYMBOL = /^[A-Z0-9][A-Z0-9.\-/ ]{0,15}$/;
/** Ids are TradeZero's own (any short printable text; control characters are refused by str). */
const ID = /^\S.{0,63}$/;

function account(value: unknown): TzAccount {
  const a = obj(value);
  return {
    accountStatus: strOrNull(a.accountStatus, 32),
    accountType: oneOfOrNull(a.accountType, ["Paper", "Live"] as const),
    availableCash: numOrNull(a.availableCash),
    buyingPower: numOrNull(a.buyingPower),
    equity: numOrNull(a.equity),
    leverage: numOrNull(a.leverage),
    overnightBp: numOrNull(a.overnightBp),
    totalLocateCosts: numOrNull(a.totalLocateCosts),
    sharesTraded: numOrNull(a.sharesTraded),
  };
}

function position(value: unknown): TzPosition {
  const p = obj(value);
  const shares = num(p.shares);
  return {
    positionId: str(p.positionId, 64, ID),
    symbol: str(p.symbol, 16, SYMBOL),
    shares: shares >= 0 ? shares : fail(),
    side: oneOf(p.side, ["Long", "Short"] as const),
    priceAvg: num(p.priceAvg),
  };
}

function positionPnl(value: unknown): TzPositionPnl {
  const r = obj(value);
  return { positionId: str(r.positionId, 64, ID), unrealizedPnL: num(r.unrealizedPnL), exposure: num(r.exposure), dayPnl: numOrNull(r.dayPnl) };
}

function pnl(value: unknown): TzPnl {
  const p = obj(value);
  return {
    accountValue: numOrNull(p.accountValue),
    exposure: numOrNull(p.exposure),
    dayPnl: numOrNull(p.dayPnl),
    dayUnrealized: numOrNull(p.dayUnrealized),
    totalUnrealized: numOrNull(p.totalUnrealized),
    pnl: arr(p.pnl, DESK_FEED_MAX_POSITIONS).map(positionPnl),
  };
}

const SIDES: readonly TzOrderSide[] = ["Buy", "Sell", "Short", "Cover"];
const STATUSES: readonly TzOrderStatus[] = ["New", "PendingNew", "PartiallyFilled"];
const TYPES: readonly TzOrderType[] = ["Market", "Limit", "Stop", "StopLimit", "Range"];
const TIFS: readonly TzTimeInForce[] = ["Day", "Day_Plus", "GTC", "GTC_Plus"];

function order(value: unknown): TzOrder {
  const o = obj(value);
  return {
    clientOrderId: str(o.clientOrderId, 64, ID),
    symbol: str(o.symbol, 16, SYMBOL),
    side: oneOfOrNull(o.side, SIDES),
    orderQuantity: num(o.orderQuantity),
    orderStatus: oneOf(o.orderStatus, STATUSES),
    limitPrice: numOrNull(o.limitPrice),
    leavesQuantity: num(o.leavesQuantity),
    priceAvg: num(o.priceAvg),
    route: str(o.route, 16),
    orderType: oneOfOrNull(o.orderType, TYPES),
    timeInForce: oneOfOrNull(o.timeInForce, TIFS),
    stopPrice: numOrNull(o.stopPrice),
    rangeLowPrice: numOrNull(o.rangeLowPrice),
    rangeHighPrice: numOrNull(o.rangeHighPrice),
    createdDate: isoOrNull(o.createdDate),
  };
}

function activity(value: unknown): BridgeActivity {
  const a = obj(value);
  return {
    at: iso(a.at),
    kind: oneOf(a.kind, ["fill", "cancel", "placed", "stop-moved"] as const),
    symbol: str(a.symbol, 16, SYMBOL),
    text: str(a.text, 200),
  };
}

function feedStatus(value: unknown): BridgeFeedStatus {
  const f = obj(value);
  const pollEveryMs = num(f.pollEveryMs);
  return {
    state: oneOf(f.state, ["ok", "error"] as const),
    stream: oneOf(f.stream, ["connected", "connecting", "off"] as const),
    pollEveryMs: pollEveryMs >= 1_000 && pollEveryMs <= 3_600_000 ? pollEveryMs : fail(),
    errors: arr(f.errors, MAX_ERRORS).map((e) => str(e, 200)),
  };
}

/**
 * The snapshot as the desk will read it, or null when anything in it is off. Always `sample: false`
 * (a snapshot that says it is sample data is refused: the sample never comes from outside).
 */
export function parseTradingDeskSnapshot(value: unknown, now = Date.now()): TradeZeroFeed | null {
  try {
    const v = obj(value);
    if (v.sample !== false && v.sample !== undefined) return null;
    const b = obj(v.bridge);
    const updatedAt = iso(b.updatedAt);
    if (Date.parse(updatedAt) > now + FUTURE_MS) return null;
    const opened = obj(b.positions);
    const openedEntries = Object.entries(opened);
    if (openedEntries.length > DESK_FEED_MAX_POSITIONS) return null;
    return {
      sample: false,
      account: account(v.account),
      positions: arr(v.positions, DESK_FEED_MAX_POSITIONS).map(position),
      pnl: pnl(v.pnl),
      orders: arr(v.orders, DESK_FEED_MAX_ORDERS).map(order),
      bridge: {
        updatedAt,
        source: str(b.source, 40),
        automation: oneOf(b.automation, ["running", "paused", "off"] as const),
        positions: Object.fromEntries(
          openedEntries.map(([symbol, meta]) => {
            const m = obj(meta);
            return [str(symbol, 16, SYMBOL), { openedAt: iso(m.openedAt), openedBy: oneOf(m.openedBy, ["bot", "rob"] as const) }];
          }),
        ),
        activity: arr(b.activity, MAX_ACTIVITY).map(activity),
        ...(b.feed === undefined ? {} : { feed: feedStatus(b.feed) }),
      },
    };
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}
