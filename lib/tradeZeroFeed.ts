// #468 Trading Desk: the shape of what the home computer will send, read-only. Field names mirror
// TradeZero's web API (REST /v1/api/... and the /stream/pnl and /stream/portfolio WebSockets) so
// wiring the real feed later only swaps the data source; lib/tradingDesk.ts turns it into rows.
//
// Fields marked "assumed" are not in what we have seen of TradeZero's replies yet (order type, time
// in force, stop and range prices, times). #469: the real feed (scripts/trading-desk-feed) sends null
// for any of them TradeZero leaves out, and the desk shows "—" there instead of guessing.
// The `bridge` part is not TradeZero's: it is what the home computer adds (when it last heard from
// TradeZero, the bot's state, who opened what, the bot's activity log).
//
// Nothing here calls TradeZero, holds a key or can place, change or cancel anything.

/** GET /v1/api/accounts (and /v1/api/account/{accountId}). No account number is ever kept here. */
export type TzAccount = {
  accountStatus: string | null;
  /** Null when TradeZero doesn't say; the desk then shows no Paper/Live badge. */
  accountType: "Paper" | "Live" | null;
  availableCash: number | null;
  buyingPower: number | null;
  equity: number | null;
  leverage: number | null;
  overnightBp: number | null;
  totalLocateCosts: number | null;
  sharesTraded: number | null;
};

/** GET /v1/api/accounts/{accountId}/positions: no market value or P&L here (that is /pnl). */
export type TzPosition = {
  /** Assumed: ties a position to its row in /pnl's pnl[]. The real feed uses the symbol when absent. */
  positionId: string;
  symbol: string;
  /** Always positive; side says which way. */
  shares: number;
  side: "Long" | "Short";
  priceAvg: number;
};

/** One entry of /pnl's pnl[] (and /stream/pnl's per-position updates). */
export type TzPositionPnl = {
  positionId: string;
  unrealizedPnL: number;
  /** Market value of the position, always positive. */
  exposure: number;
  /** Assumed: today's P&L for the position (equal to unrealizedPnL for a position opened today). */
  dayPnl: number | null;
};

/** GET /v1/api/accounts/{accountId}/pnl (and /stream/pnl). */
export type TzPnl = {
  accountValue: number | null;
  /** Gross: long market value plus short market value. */
  exposure: number | null;
  /** Realized plus unrealized, today. */
  dayPnl: number | null;
  dayUnrealized: number | null;
  totalUnrealized: number | null;
  pnl: TzPositionPnl[];
};

export type TzOrderSide = "Buy" | "Sell" | "Short" | "Cover";
/** Assumed spellings. A Range order exits at whichever of its high or low trades first. */
export type TzOrderType = "Market" | "Limit" | "Stop" | "StopLimit" | "Range";
/** Assumed spellings: Day, Day+ (extended hours), GTC, GTC+ (GTC with extended hours). */
export type TzTimeInForce = "Day" | "Day_Plus" | "GTC" | "GTC_Plus";
/** Assumed spellings (FIX style). Only working orders reach the desk. */
export type TzOrderStatus = "New" | "PendingNew" | "PartiallyFilled";

/** GET /v1/api/accounts/{accountId}/orders (and /stream/portfolio "Order" updates). */
export type TzOrder = {
  /** The bot's orders start with "bot-" (the home computer sets the id); anything else is Rob's. */
  clientOrderId: string;
  symbol: string;
  /** Null when TradeZero's spelling isn't one of these. */
  side: TzOrderSide | null;
  orderQuantity: number;
  orderStatus: TzOrderStatus;
  /** Null for Market, Stop and Range orders. */
  limitPrice: number | null;
  leavesQuantity: number;
  /** Average fill price so far (0 before any fill). */
  priceAvg: number;
  route: string;
  /** Assumed. */
  orderType: TzOrderType | null;
  /** Assumed. */
  timeInForce: TzTimeInForce | null;
  /** Assumed: Stop and StopLimit orders. */
  stopPrice: number | null;
  /** Assumed: a Range order's two exits. */
  rangeLowPrice: number | null;
  rangeHighPrice: number | null;
  /** Assumed: when it was placed (ISO time). */
  createdDate: string | null;
};

export type BridgeActivityKind = "fill" | "cancel" | "placed" | "stop-moved";

/** One line of the bot's log for today. */
export type BridgeActivity = {
  at: string;
  kind: BridgeActivityKind;
  symbol: string;
  /** Plain English, written by the home computer: "Bought 4,000 ZQXA at $2.14". */
  text: string;
};

/** What the home computer adds to TradeZero's data. */
export type BridgeInfo = {
  /** When the home computer last heard from TradeZero (ISO time). */
  updatedAt: string;
  /** Shown as "from <source>". */
  source: string;
  /** "off": no bot runs yet (the real feed only reads). */
  automation: "running" | "paused" | "off";
  /** Who opened each position and when (TradeZero's positions say neither). Keyed by symbol. */
  positions: Record<string, { openedAt: string; openedBy: "bot" | "rob" }>;
  /** Newest first or not: the desk sorts it. */
  activity: BridgeActivity[];
  /** #469: how the home computer's feed is doing. Absent in the sample. */
  feed?: BridgeFeedStatus;
};

/** #469: the home computer's own state, sent with every snapshot. */
export type BridgeFeedStatus = {
  /** "ok": the last read of TradeZero worked; "error": it didn't (the numbers are from the last one that did). */
  state: "ok" | "error";
  /** The P&L stream: connected, trying to connect, or off (outside market hours). */
  stream: "connected" | "connecting" | "off";
  /** How often it reads TradeZero now (5 s in market hours, 60 s otherwise). The desk's stale warning follows it. */
  pollEveryMs: number;
  /** Short plain-English problems (never a key, a secret or the account number). */
  errors: string[];
};

/** Everything the desk shows, in one message. */
export type TradeZeroFeed = {
  /** True for the mock-up's made-up numbers; the page says "Sample data". */
  sample: boolean;
  account: TzAccount;
  positions: TzPosition[];
  pnl: TzPnl;
  orders: TzOrder[];
  bridge: BridgeInfo;
};
