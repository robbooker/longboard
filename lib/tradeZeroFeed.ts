// #468 Trading Desk: the shape of what the home computer will send, read-only. Field names mirror
// TradeZero's web API (REST /v1/api/... and the /stream/pnl and /stream/portfolio WebSockets) so
// wiring the real feed later only swaps the data source; lib/tradingDesk.ts turns it into rows.
//
// Fields marked "assumed" are not in what we have seen of TradeZero's replies yet (order type, time
// in force, stop and range prices, times); check them against the live feed when it is wired.
// The `bridge` part is not TradeZero's: it is what the home computer adds (when it last heard from
// TradeZero, the bot's state, who opened what, the bot's activity log).
//
// Nothing here calls TradeZero, holds a key or can place, change or cancel anything.

/** GET /v1/api/accounts (and /v1/api/account/{accountId}). No account number is ever kept here. */
export type TzAccount = {
  accountStatus: string;
  accountType: "Paper" | "Live";
  availableCash: number;
  buyingPower: number;
  equity: number;
  leverage: number;
  overnightBp: number;
  totalLocateCosts: number;
  sharesTraded: number;
};

/** GET /v1/api/accounts/{accountId}/positions: no market value or P&L here (that is /pnl). */
export type TzPosition = {
  /** Assumed: ties a position to its row in /pnl's pnl[]. */
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
  dayPnl: number;
};

/** GET /v1/api/accounts/{accountId}/pnl (and /stream/pnl). */
export type TzPnl = {
  accountValue: number;
  /** Gross: long market value plus short market value. */
  exposure: number;
  /** Realized plus unrealized, today. */
  dayPnl: number;
  dayUnrealized: number;
  totalUnrealized: number;
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
  side: TzOrderSide;
  orderQuantity: number;
  orderStatus: TzOrderStatus;
  /** Null for Market, Stop and Range orders. */
  limitPrice: number | null;
  leavesQuantity: number;
  /** Average fill price so far (0 before any fill). */
  priceAvg: number;
  route: string;
  /** Assumed. */
  orderType: TzOrderType;
  /** Assumed. */
  timeInForce: TzTimeInForce;
  /** Assumed: Stop and StopLimit orders. */
  stopPrice: number | null;
  /** Assumed: a Range order's two exits. */
  rangeLowPrice: number | null;
  rangeHighPrice: number | null;
  /** Assumed: when it was placed (ISO time). */
  createdDate: string;
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
  automation: "running" | "paused";
  /** Who opened each position and when (TradeZero's positions say neither). Keyed by symbol. */
  positions: Record<string, { openedAt: string; openedBy: "bot" | "rob" }>;
  /** Newest first or not: the desk sorts it. */
  activity: BridgeActivity[];
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
