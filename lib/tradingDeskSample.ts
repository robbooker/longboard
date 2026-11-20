// #468 Trading Desk mock-up: made-up numbers in TradeZero's shape (lib/tradeZeroFeed.ts), so Rob can
// judge the design. The tickers are invented (no listed stock uses them) so nobody takes this for real
// holdings, and the page marks it "Sample data". Swapping in the home computer's feed later replaces
// sampleTradeZeroFeed() and nothing else.
import type { BridgeActivity, TradeZeroFeed, TzOrder, TzPosition, TzPositionPnl } from "./tradeZeroFeed";

/** The home computer last heard from TradeZero this long before `now`. */
export const SAMPLE_AGE_MS = 3_000;

type SamplePosition = {
  symbol: string;
  side: "Long" | "Short";
  shares: number;
  priceAvg: number;
  last: number;
  /** Yesterday's close, for a position held overnight (its day P&L starts there). */
  prevClose?: number;
  opened: string;
  openedBy: "bot" | "rob";
};

// "Y" marks a clock time yesterday; everything else is today, Eastern time.
const POSITIONS: SamplePosition[] = [
  { symbol: "ZQXA", side: "Long", shares: 4_000, priceAvg: 2.14, last: 2.41, opened: "09:41", openedBy: "bot" },
  { symbol: "QJVK", side: "Short", shares: 2_500, priceAvg: 7.85, last: 7.32, opened: "10:06", openedBy: "bot" },
  { symbol: "XQZM", side: "Long", shares: 10_000, priceAvg: 0.62, last: 0.574, opened: "10:52", openedBy: "rob" },
  { symbol: "KZQW", side: "Short", shares: 1_200, priceAvg: 11.4, last: 12.05, prevClose: 11.88, opened: "Y15:31", openedBy: "bot" },
  { symbol: "VQZB", side: "Short", shares: 1_200, priceAvg: 6.2, last: 6.14, opened: "12:58", openedBy: "bot" },
  { symbol: "JQXT", side: "Long", shares: 3_000, priceAvg: 4.36, last: 4.52, opened: "13:18", openedBy: "bot" },
];

type SampleOrder = Omit<TzOrder, "createdDate" | "priceAvg" | "limitPrice" | "stopPrice" | "rangeLowPrice" | "rangeHighPrice"> &
  Partial<Pick<TzOrder, "limitPrice" | "stopPrice" | "rangeLowPrice" | "rangeHighPrice" | "priceAvg">> & { placed: string };

// At least one of every order type and time in force.
const ORDERS: SampleOrder[] = [
  { clientOrderId: "bot-0007", symbol: "ZQXA", side: "Sell", orderType: "Range", timeInForce: "GTC", orderQuantity: 4_000, leavesQuantity: 4_000, rangeLowPrice: 1.98, rangeHighPrice: 2.7, route: "SMART", orderStatus: "New", placed: "11:48" },
  { clientOrderId: "bot-0004", symbol: "QJVK", side: "Cover", orderType: "Stop", timeInForce: "Day_Plus", orderQuantity: 2_500, leavesQuantity: 2_500, stopPrice: 8.25, route: "SMART", orderStatus: "New", placed: "10:07" },
  { clientOrderId: "TZ-58213", symbol: "XQZM", side: "Sell", orderType: "Limit", timeInForce: "Day", orderQuantity: 10_000, leavesQuantity: 10_000, limitPrice: 0.7, route: "ARCA", orderStatus: "New", placed: "10:53" },
  { clientOrderId: "bot-0001", symbol: "KZQW", side: "Cover", orderType: "StopLimit", timeInForce: "GTC", orderQuantity: 1_200, leavesQuantity: 1_200, stopPrice: 12.4, limitPrice: 12.55, route: "EDGX", orderStatus: "New", placed: "Y15:32" },
  { clientOrderId: "bot-0009", symbol: "VQZB", side: "Short", orderType: "Limit", timeInForce: "Day", orderQuantity: 3_000, leavesQuantity: 1_800, limitPrice: 6.2, priceAvg: 6.2, route: "NSDQ", orderStatus: "PartiallyFilled", placed: "12:55" },
  { clientOrderId: "bot-0011", symbol: "JQXT", side: "Sell", orderType: "Stop", timeInForce: "GTC_Plus", orderQuantity: 3_000, leavesQuantity: 3_000, stopPrice: 4.05, route: "SMART", orderStatus: "New", placed: "13:18" },
  { clientOrderId: "bot-0013", symbol: "WQXJ", side: "Buy", orderType: "Limit", timeInForce: "Day_Plus", orderQuantity: 6_000, leavesQuantity: 6_000, limitPrice: 1.18, route: "ARCA", orderStatus: "PendingNew", placed: "13:51" },
  { clientOrderId: "TZ-58377", symbol: "QXZP", side: "Buy", orderType: "Market", timeInForce: "Day", orderQuantity: 2_000, leavesQuantity: 2_000, route: "SMART", orderStatus: "PendingNew", placed: "13:55" },
];

const ACTIVITY: (Omit<BridgeActivity, "at"> & { clock: string })[] = [
  { clock: "13:42", kind: "stop-moved", symbol: "JQXT", text: "Raised the stop on JQXT from $3.90 to $4.05" },
  { clock: "13:18", kind: "fill", symbol: "JQXT", text: "Bought 3,000 JQXT at $4.36" },
  { clock: "12:58", kind: "fill", symbol: "VQZB", text: "Shorted 1,200 VQZB at $6.20; 1,800 more still working" },
  { clock: "12:31", kind: "cancel", symbol: "WQXJ", text: "Canceled the buy limit on WQXJ at $1.24: not filled in 15 minutes" },
  { clock: "11:48", kind: "placed", symbol: "ZQXA", text: "Placed a range exit on the other 4,000 ZQXA: $1.98 low, $2.70 high" },
  { clock: "11:47", kind: "fill", symbol: "ZQXA", text: "Sold 2,500 ZQXA at $2.52, $950.00 on the trade" },
  { clock: "11:20", kind: "stop-moved", symbol: "QJVK", text: "Lowered the cover stop on QJVK from $8.40 to $8.25" },
  { clock: "10:07", kind: "placed", symbol: "QJVK", text: "Placed a cover stop for 2,500 QJVK at $8.40" },
  { clock: "10:06", kind: "fill", symbol: "QJVK", text: "Shorted 2,500 QJVK at $7.85" },
  { clock: "09:41", kind: "fill", symbol: "ZQXA", text: "Bought 6,500 ZQXA at $2.14" },
];

const SAMPLE_EQUITY = 52_418.6;
const SAMPLE_LEVERAGE = 4;
const SAMPLE_REALIZED = 1_842.5;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** "YYYY-MM-DD" in New York for `now`, and New York's UTC offset then ("-05:00"). */
function newYorkDay(now: Date): { day: string; offset: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", timeZoneName: "shortOffset" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(parts.timeZoneName ?? "");
  const offset = match ? `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}` : "-05:00";
  return { day: `${parts.year}-${parts.month}-${parts.day}`, offset };
}

/** A sample clock time ("13:42", or "Y15:31" for yesterday) as an ISO time on `now`'s New York day. */
function at(clock: string, now: Date): string {
  const { day, offset } = newYorkDay(now);
  const yesterday = clock.startsWith("Y");
  const local = new Date(`${day}T${clock.replace("Y", "")}:00${offset}`);
  if (yesterday) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString();
}

/** The mock-up's feed as of `now`: TradeZero-shaped, made up, marked sample. */
export function sampleTradeZeroFeed(now: Date = new Date()): TradeZeroFeed {
  const positions: TzPosition[] = POSITIONS.map((p, i) => ({
    positionId: `pos-${i + 1}`,
    symbol: p.symbol,
    shares: p.shares,
    side: p.side,
    priceAvg: p.priceAvg,
  }));
  const direction = (p: SamplePosition) => (p.side === "Long" ? 1 : -1);
  const perPosition: TzPositionPnl[] = POSITIONS.map((p, i) => {
    const unrealizedPnL = round2((p.last - p.priceAvg) * p.shares * direction(p));
    return {
      positionId: `pos-${i + 1}`,
      unrealizedPnL,
      exposure: round2(p.last * p.shares),
      dayPnl: p.prevClose === undefined ? unrealizedPnL : round2((p.last - p.prevClose) * p.shares * direction(p)),
    };
  });
  const sum = (values: number[]) => round2(values.reduce((total, value) => total + value, 0));
  const exposure = sum(perPosition.map((p) => p.exposure));
  const dayUnrealized = sum(perPosition.map((p) => p.dayPnl ?? 0));
  return {
    sample: true,
    account: {
      accountStatus: "Active",
      accountType: "Live",
      availableCash: round2(SAMPLE_EQUITY - sum(POSITIONS.filter((p) => p.side === "Long").map((p) => p.priceAvg * p.shares))),
      buyingPower: round2(SAMPLE_EQUITY * SAMPLE_LEVERAGE - exposure),
      equity: SAMPLE_EQUITY,
      leverage: SAMPLE_LEVERAGE,
      overnightBp: round2(SAMPLE_EQUITY * 2),
      totalLocateCosts: 38.4,
      sharesTraded: 31_400,
    },
    positions,
    pnl: {
      accountValue: SAMPLE_EQUITY,
      exposure,
      dayPnl: round2(SAMPLE_REALIZED + dayUnrealized),
      dayUnrealized,
      totalUnrealized: sum(perPosition.map((p) => p.unrealizedPnL)),
      pnl: perPosition,
    },
    orders: ORDERS.map(({ placed, ...order }) => ({
      limitPrice: null,
      stopPrice: null,
      rangeLowPrice: null,
      rangeHighPrice: null,
      priceAvg: 0,
      ...order,
      createdDate: at(placed, now),
    })),
    bridge: {
      updatedAt: new Date(now.getTime() - SAMPLE_AGE_MS).toISOString(),
      source: "home computer",
      automation: "running",
      positions: Object.fromEntries(POSITIONS.map((p) => [p.symbol, { openedAt: at(p.opened, now), openedBy: p.openedBy }])),
      activity: ACTIVITY.map(({ clock, ...line }) => ({ ...line, at: at(clock, now) })),
    },
  };
}
