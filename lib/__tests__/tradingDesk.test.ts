import { describe, expect, it } from "vitest";
import {
  DESK_STALE_AFTER_MS,
  deskClock,
  deskFreshness,
  deskFromTradeZero,
  formatMoney,
  formatPercent,
  formatPrice,
  orderPriceLabel,
  placedBy,
  pnlPercent,
} from "@/lib/tradingDesk";
import { SAMPLE_AGE_MS, sampleTradeZeroFeed } from "@/lib/tradingDeskSample";
import type { TradeZeroFeed, TzOrder } from "@/lib/tradeZeroFeed";

const NOW = new Date("2026-11-19T19:00:00Z"); // 2:00 PM in New York

const order = (extra: Partial<TzOrder>): TzOrder => ({
  clientOrderId: "bot-1",
  symbol: "ZZZZ",
  side: "Buy",
  orderQuantity: 100,
  orderStatus: "New",
  limitPrice: null,
  leavesQuantity: 100,
  priceAvg: 0,
  route: "SMART",
  orderType: "Limit",
  timeInForce: "Day",
  stopPrice: null,
  rangeLowPrice: null,
  rangeHighPrice: null,
  createdDate: NOW.toISOString(),
  ...extra,
});

/** A small hand-made feed in TradeZero's shape. */
function feed(): TradeZeroFeed {
  return {
    sample: false,
    account: { accountStatus: "Active", accountType: "Live", availableCash: 10_000, buyingPower: 80_000, equity: 25_000, leverage: 4, overnightBp: 50_000, totalLocateCosts: 0, sharesTraded: 0 },
    positions: [
      { positionId: "a", symbol: "AAAA", shares: 1_000, side: "Long", priceAvg: 2 },
      { positionId: "b", symbol: "BBBB", shares: 500, side: "Short", priceAvg: 10 },
    ],
    pnl: {
      accountValue: 25_000,
      exposure: 7_000,
      dayPnl: 900,
      dayUnrealized: 600,
      totalUnrealized: 750,
      pnl: [
        // Long 1,000 at 2.00, now 2.25: +250. Short 500 at 10.00, now 9.00: +500.
        { positionId: "a", unrealizedPnL: 250, exposure: 2_250, dayPnl: 250 },
        { positionId: "b", unrealizedPnL: 500, exposure: 4_500, dayPnl: 350 },
      ],
    },
    orders: [
      order({ clientOrderId: "bot-7", orderType: "Range", side: "Sell", rangeLowPrice: 2.7, rangeHighPrice: 1.98, timeInForce: "GTC" }),
      order({ clientOrderId: "TZ-1", orderType: "StopLimit", side: "Cover", stopPrice: 12.4, limitPrice: 12.55, orderQuantity: 300, leavesQuantity: 120, orderStatus: "PartiallyFilled", timeInForce: "GTC_Plus" }),
    ],
    bridge: {
      updatedAt: NOW.toISOString(),
      source: "home computer",
      automation: "paused",
      positions: { AAAA: { openedAt: NOW.toISOString(), openedBy: "rob" } },
      activity: [
        { at: "2026-11-19T15:00:00Z", kind: "fill", symbol: "AAAA", text: "older" },
        { at: "2026-11-19T18:00:00Z", kind: "cancel", symbol: "AAAA", text: "newer" },
      ],
    },
  };
}

describe("#468 adapter: TradeZero's shape to the desk's rows", () => {
  it("works out each position's last price and open P&L % (a short's gain is positive too)", () => {
    const desk = deskFromTradeZero(feed());
    const [long, short] = desk.positions;
    expect(long).toMatchObject({ symbol: "AAAA", side: "Long", shares: 1_000, avgPrice: 2, last: 2.25, openPnl: 250, openPnlPct: 12.5, dayPnl: 250, exposure: 2_250, openedBy: "Rob" });
    expect(short).toMatchObject({ symbol: "BBBB", side: "Short", last: 9, openPnl: 500, openPnlPct: 10, dayPnl: 350, openedBy: null, openedAt: null });
  });

  it("adds up the totals row and splits the day P&L and exposure", () => {
    const desk = deskFromTradeZero(feed());
    // 750 open on a cost of 2,000 + 5,000.
    expect(desk.totals).toEqual({ count: 2, openPnl: 750, openPnlPct: 10.71, dayPnl: 600, exposure: 6_750 });
    expect(desk.account).toMatchObject({ dayPnl: 900, dayUnrealized: 600, dayRealized: 300, openPnl: 750, equity: 25_000, buyingPower: 80_000 });
    expect(desk.account.exposure).toEqual({ gross: 7_000, long: 2_250, short: 4_500 });
    expect(desk.automation).toBe("paused");
  });

  it("maps orders: type, time in force, filled and left, status, who placed it", () => {
    const [range, stopLimit] = deskFromTradeZero(feed()).orders;
    expect(range).toMatchObject({ type: "Range", tif: "GTC", price: "1.98 – 2.70", placedBy: "Bot", status: "Working", filled: 0, remaining: 100 });
    expect(stopLimit).toMatchObject({ type: "Stop Limit", tif: "GTC+", price: "Stop 12.40 · Lmt 12.55", placedBy: "Rob", status: "Partially filled", qty: 300, filled: 180, remaining: 120 });
  });

  it("puts the activity newest first", () => {
    expect(deskFromTradeZero(feed()).activity.map((line) => line.text)).toEqual(["newer", "older"]);
  });
});

describe("#468 price column and formats", () => {
  it("formats each order type's price", () => {
    expect(orderPriceLabel(order({ orderType: "Market" }))).toBe("MKT");
    expect(orderPriceLabel(order({ orderType: "Limit", limitPrice: 0.7 }))).toBe("0.7000");
    expect(orderPriceLabel(order({ orderType: "Limit", limitPrice: 6.2 }))).toBe("6.20");
    expect(orderPriceLabel(order({ orderType: "Stop", stopPrice: 8.25 }))).toBe("Stop 8.25");
    expect(orderPriceLabel(order({ orderType: "StopLimit", stopPrice: 12.4, limitPrice: 12.55 }))).toBe("Stop 12.40 · Lmt 12.55");
    // A range shows its low first, whichever way round the two came.
    expect(orderPriceLabel(order({ orderType: "Range", rangeLowPrice: 1.98, rangeHighPrice: 2.7 }))).toBe("1.98 – 2.70");
    expect(orderPriceLabel(order({ orderType: "Range", rangeLowPrice: 2.7, rangeHighPrice: 1.98 }))).toBe("1.98 – 2.70");
    expect(orderPriceLabel(order({ orderType: "Range", rangeLowPrice: 0.45, rangeHighPrice: 1.1 }))).toBe("0.4500 – 1.10");
    expect(orderPriceLabel(order({ orderType: "Range", rangeLowPrice: null, rangeHighPrice: 2 }))).toBe("— – 2.00");
  });

  it("formats money, percents and prices", () => {
    expect(formatMoney(52_418.6)).toBe("$52,418.60");
    expect(formatMoney(1_080, { sign: true })).toBe("+$1,080.00");
    expect(formatMoney(-460, { sign: true })).toBe("−$460.00");
    expect(formatMoney(-0.001, { sign: true })).toBe("$0.00");
    expect(formatMoney(41_234.4, { cents: false })).toBe("$41,234");
    expect(formatPercent(12.6168)).toBe("+12.62%");
    expect(formatPercent(-7.42)).toBe("−7.42%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPrice(0.574)).toBe("0.5740");
    expect(formatPrice(11.4)).toBe("11.40");
    expect(pnlPercent(10, 0)).toBe(0);
    expect(placedBy("bot-0001")).toBe("Bot");
    expect(placedBy("TZ-58213")).toBe("Rob");
  });

  it("says how fresh the numbers are, and turns stale after 30 seconds", () => {
    expect(deskFreshness(3_400, "home computer")).toEqual({ stale: false, label: "Updated 3s ago from home computer" });
    expect(deskFreshness(DESK_STALE_AFTER_MS, "home computer").stale).toBe(false);
    expect(deskFreshness(DESK_STALE_AFTER_MS + 1, "home computer").stale).toBe(true);
    expect(deskFreshness(125_000, "home computer")).toEqual({ stale: true, label: "Updated 2 min ago from home computer" });
    expect(deskFreshness(-500, "x").label).toBe("Updated 0s ago from x");
  });

  it("shows New York times, with the day when it isn't today", () => {
    expect(deskClock("2026-11-19T14:41:00Z", NOW)).toBe("09:41");
    expect(deskClock("2026-11-18T20:31:00Z", NOW)).toBe("Nov 18 15:31");
    expect(deskClock(null, NOW)).toBe("—");
  });
});

describe("#468 sample data", () => {
  const sample = sampleTradeZeroFeed(NOW);
  const desk = deskFromTradeZero(sample);

  it("is marked sample, a few seconds old, with the bot running", () => {
    expect(sample.sample).toBe(true);
    expect(NOW.getTime() - Date.parse(sample.bridge.updatedAt)).toBe(SAMPLE_AGE_MS);
    expect(desk.automation).toBe("running");
  });

  it("has a mix of long and short winners and losers at small-cap prices", () => {
    expect(desk.positions.length).toBeGreaterThanOrEqual(5);
    expect(new Set(desk.positions.map((p) => p.side))).toEqual(new Set(["Long", "Short"]));
    expect(desk.positions.some((p) => p.openPnl > 0) && desk.positions.some((p) => p.openPnl < 0)).toBe(true);
    for (const p of desk.positions) {
      expect(p.last).toBeGreaterThanOrEqual(0.4);
      expect(p.last).toBeLessThanOrEqual(15);
    }
    // The pieces agree with each other: the totals are TradeZero's own totals.
    expect(desk.totals.openPnl).toBeCloseTo(sample.pnl.totalUnrealized ?? NaN, 2);
    expect(desk.totals.dayPnl).toBeCloseTo(sample.pnl.dayUnrealized ?? NaN, 2);
    expect(desk.account.exposure.long + desk.account.exposure.short).toBeCloseTo(desk.account.exposure.gross, 2);
  });

  it("has every order type and time in force, and ten activity lines", () => {
    expect(new Set(desk.orders.map((o) => o.type))).toEqual(new Set(["Market", "Limit", "Stop", "Stop Limit", "Range"]));
    expect(new Set(desk.orders.map((o) => o.tif))).toEqual(new Set(["Day", "Day+", "GTC", "GTC+"]));
    expect(new Set(desk.orders.map((o) => o.status))).toEqual(new Set(["Working", "Partially filled", "Pending"]));
    expect(desk.orders.length).toBeGreaterThanOrEqual(7);
    expect(desk.activity).toHaveLength(10);
    expect(new Set(desk.activity.map((a) => a.kind))).toEqual(new Set(["fill", "cancel", "placed", "stop-moved"]));
  });

  it("uses only made-up tickers and no account number", () => {
    const text = JSON.stringify(sample);
    for (const symbol of new Set(desk.positions.map((p) => p.symbol).concat(desk.orders.map((o) => o.symbol)))) expect(symbol).toMatch(/^[A-Z]*[QXZ][A-Z]*$/);
    expect(sample.account).not.toHaveProperty("account");
    expect(text).not.toMatch(/\b\d[A-Z]{2}\d{5}\b/);
  });
});
