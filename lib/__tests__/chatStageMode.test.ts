import { describe, expect, it } from "vitest";
import {
  STAGE_SAMPLE_STOCKS,
  stageElapsed,
  stageHref,
  stageModeAllowed,
  stageOnScreen,
  stageRequested,
  stageStockFromRow,
  stageStocks,
} from "@/lib/chatStageMode";
import type { GainersTableRow } from "@/lib/chatGainersFacts";

const row = (sym: string, extra: Partial<GainersTableRow> = {}): GainersTableRow => ({
  sym,
  lastAlertAt: "2026-11-25T14:25:00.000Z",
  alerts: 1,
  country: "China",
  countryChecked: true,
  cashUsd: 31_500_000,
  cashMonthsLeft: 12,
  cashFlowPositive: false,
  cashChecked: true,
  instOwnPct: 3.9,
  instOwnChecked: true,
  notFound: false,
  quote: { price: 3.14, changePct: 35.8, volume: 7_300_000 },
  sharesOutstanding: 1_850_000,
  floatShares: 1_200_000,
  ...extra,
});

describe("stage mode gate (#501)", () => {
  it("is for chat admins only", () => {
    expect(stageModeAllowed(true, undefined)).toBe(true);
    expect(stageModeAllowed(false, undefined)).toBe(false);
    expect(stageModeAllowed(false, "on")).toBe(false);
  });
  it("can be switched off for admins too", () => {
    expect(stageModeAllowed(true, "off")).toBe(false);
    expect(stageModeAllowed(true, " OFF ")).toBe(false);
    expect(stageModeAllowed(true, "on")).toBe(true);
  });
  it("reads and writes the address", () => {
    expect(stageRequested("?room=main&stage=1")).toBe(true);
    expect(stageRequested("?room=main&stage=0")).toBe(false);
    expect(stageRequested("?room=main")).toBe(false);
    expect(stageHref("https://chat.example/chat?room=main", true)).toBe("https://chat.example/chat?room=main&stage=1");
    expect(stageHref("https://chat.example/chat?room=main&stage=1&thread=x", false)).toBe(
      "https://chat.example/chat?room=main&thread=x",
    );
  });
});

describe("stage mode stock panel (#501)", () => {
  const now = Date.parse("2026-11-25T14:32:10.000Z");
  it("shows a Gainers Table row in the table's order and wording", () => {
    const stock = stageStockFromRow(row("AEHL"), now);
    expect(stock.source).toBe("table");
    expect(stock.market).toBe("CN");
    expect(stock.stats.map((stat) => stat.name)).toEqual([
      "Price", "% today", "Volume", "Borrow at TZ", "Mkt cap", "Float", "Cash left", "Inst %", "Min", "Time",
    ]);
    const value = Object.fromEntries(stock.stats.map((stat) => [stat.key, stat.value]));
    expect(value.price).toBe("$3.14");
    expect(value.change).toBe("+35.8%");
    expect(value.volume).toBe("7.3M");
    expect(value.float).toBe("1.2M");
    expect(value.minutes).toBe("7");
    expect(stock.stats.find((stat) => stat.key === "change")?.tone).toBe("up");
  });
  it("falls back to the marked sample when the table has no rows", () => {
    expect(stageStocks(null, now)).toBe(STAGE_SAMPLE_STOCKS);
    expect(stageStocks([], now)).toBe(STAGE_SAMPLE_STOCKS);
    expect(STAGE_SAMPLE_STOCKS[0].sym).toBe("APUS");
    expect(STAGE_SAMPLE_STOCKS[0].source).toBe("sample");
    // Made-up tickers never get invented numbers.
    for (const stock of STAGE_SAMPLE_STOCKS.slice(1)) {
      expect(stock.source).toBe("placeholder");
      expect(new Set(stock.stats.map((stat) => stat.value))).toEqual(new Set(["—"]));
    }
  });
  it("lists today's stocks, newest first, six at most", () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G"].map((sym) => row(sym));
    expect(stageStocks(rows, now).map((stock) => stock.sym)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
  it("keeps the chosen stock on screen while it is listed", () => {
    const stocks = stageStocks([row("A"), row("B")], now);
    expect(stageOnScreen(stocks, "B").sym).toBe("B");
    expect(stageOnScreen(stocks, "GONE").sym).toBe("A");
    expect(stageOnScreen(stocks, null).sym).toBe("A");
  });
  it("formats the timer", () => {
    expect(stageElapsed(0)).toBe("00:00:00");
    expect(stageElapsed((34 * 60 + 12) * 1000)).toBe("00:34:12");
    expect(stageElapsed(3_723_000)).toBe("01:02:03");
  });
});
