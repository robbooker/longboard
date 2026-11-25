import { describe, expect, it } from "vitest";
import {
  STAGE_SAMPLE_STOCKS,
  stageElapsed,
  stageHref,
  stageModeAllowed,
  stageRequested,
  stageStockFromRow,
  stagePanelView,
  parseStageLookup,
  STAGE_CHIP_LIMIT,
  STAGE_LOOKUP_KEYS,
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
  it("falls back to the marked sample for an admin when the table has no rows; a member gets nothing", () => {
    for (const rows of [null, []]) {
      const admin = stagePanelView({ rows, now, host: null, picked: null, samples: true, lookup: null });
      expect(admin.chips).toBe(STAGE_SAMPLE_STOCKS);
      expect(admin.stock).toBe(STAGE_SAMPLE_STOCKS[0]);
      expect(stagePanelView({ rows, now, host: null, picked: null, samples: false, lookup: null })).toEqual({ chips: [], stock: null, following: true, lookup: false });
    }
    expect(STAGE_SAMPLE_STOCKS[0].sym).toBe("APUS");
    expect(STAGE_SAMPLE_STOCKS[0].source).toBe("sample");
    // Made-up tickers never get invented numbers.
    for (const stock of STAGE_SAMPLE_STOCKS.slice(1)) {
      expect(stock.source).toBe("placeholder");
      expect(new Set(stock.stats.map((stat) => stat.value))).toEqual(new Set(["—"]));
    }
  });
  it("lists today's stocks, newest first, up to the chip limit", () => {
    const rows = Array.from({ length: STAGE_CHIP_LIMIT + 3 }, (_, index) => row(`S${String.fromCharCode(65 + index)}`));
    const view = stagePanelView({ rows, now, host: null, picked: null, samples: false, lookup: null });
    expect(view.chips.map((stock) => stock.sym)).toEqual(rows.slice(0, STAGE_CHIP_LIMIT).map((r) => r.sym));
    expect(view.stock?.sym).toBe("SA");
  });
  it("with nothing set by the host: the viewer's own chip while it is listed, otherwise the first", () => {
    const rows = [row("A"), row("B")];
    const shown = (picked: string | null) => stagePanelView({ rows, now, host: null, picked, samples: false, lookup: null });
    expect(shown("B")).toMatchObject({ stock: { sym: "B" }, following: true, lookup: false });
    expect(shown("GONE").stock?.sym).toBe("A");
    expect(shown(null).stock?.sym).toBe("A");
  });
  describe("#507: the stock the host put on screen", () => {
    const rows = [row("A"), row("B"), row("C")];
    const shown = (host: string | null, picked: string | null, lookup: Parameters<typeof stagePanelView>[0]["lookup"] = null, samples = false, table: typeof rows | null = rows) =>
      stagePanelView({ rows: table, now, host, picked, samples, lookup });
    it("is shown to everyone following, from its Gainers Table row", () => {
      const view = shown("B", null);
      expect(view).toMatchObject({ stock: { sym: "B", source: "table" }, following: true, lookup: false });
      expect(view.chips.map((stock) => stock.sym)).toEqual(["A", "B", "C"]);
    });
    it("is found on the table even when it is past the chips", () => {
      const many = Array.from({ length: STAGE_CHIP_LIMIT + 2 }, (_, index) => row(`S${String.fromCharCode(65 + index)}`));
      const last = many[many.length - 1].sym;
      const view = stagePanelView({ rows: many, now, host: last, picked: null, samples: false, lookup: null });
      expect(view).toMatchObject({ stock: { sym: last, source: "table" }, lookup: false });
      expect(view.chips.some((stock) => stock.sym === last)).toBe(false);
    });
    it("leaves a viewer on the chip they chose, no longer following; the host's own stock is following", () => {
      expect(shown("B", "C")).toMatchObject({ stock: { sym: "C" }, following: false });
      expect(shown("B", "B")).toMatchObject({ stock: { sym: "B" }, following: true });
      // A chip that has left the table: back to the host's stock.
      expect(shown("B", "GONE")).toMatchObject({ stock: { sym: "B" }, following: true });
    });
    it("not on today's table: only what the lookup really has, dashes for the rest, nothing invented", () => {
      const waiting = shown("ZZZT", null);
      expect(waiting).toMatchObject({ stock: { sym: "ZZZT", source: "lookup", market: null }, following: true, lookup: true });
      expect(new Set(waiting.stock!.stats.map((stat) => stat.value))).toEqual(new Set(["—"]));
      const found = shown("ZZZT", null, { quote: { price: 10, changePct: 100, volume: 12_345_678 }, sharesOutstanding: 120_000_000 });
      const value = Object.fromEntries(found.stock!.stats.map((stat) => [stat.key, stat.value]));
      expect(value).toEqual({ price: "$10.00", change: "+100.0%", volume: "12.3M", marketCap: "$1.2B", borrow: "—", float: "—", cash: "—", instOwn: "—", minutes: "—", updated: "—" });
      expect(found.stock!.stats.find((stat) => stat.key === "change")?.tone).toBe("up");
      expect(Object.keys(value).filter((key) => value[key] !== "—")).toEqual([...STAGE_LOOKUP_KEYS]);
      // A price without a share count: no market cap is worked out.
      const partial = shown("ZZZT", null, { quote: { price: 10, changePct: null, volume: null }, sharesOutstanding: null });
      expect(Object.fromEntries(partial.stock!.stats.map((stat) => [stat.key, stat.value]))).toMatchObject({ price: "$10.00", change: "—", volume: "—", marketCap: "—" });
    });
    it("never borrows a sample row's numbers, even for an admin with an empty table", () => {
      const view = shown("APUS", null, null, true, []);
      expect(view).toMatchObject({ stock: { sym: "APUS", source: "lookup" }, lookup: true });
      expect(new Set(view.stock!.stats.map((stat) => stat.value))).toEqual(new Set(["—"]));
      // A member with an empty table still sees the host's stock, with no chips.
      expect(shown("APUS", null, null, false, null)).toMatchObject({ chips: [], stock: { sym: "APUS", source: "lookup" } });
    });
    it("reads the lookup's answer strictly", () => {
      expect(parseStageLookup({ ticker: "FRSH", quote: { price: 10, changePct: 100, volume: 5 }, sharesOutstanding: 7 }, "FRSH")).toEqual({ quote: { price: 10, changePct: 100, volume: 5 }, sharesOutstanding: 7 });
      expect(parseStageLookup({ ticker: "FRSH", quote: null, sharesOutstanding: "7" }, "FRSH")).toEqual({ quote: null, sharesOutstanding: null });
      expect(parseStageLookup({ ticker: "FRSH", quote: { price: "10", changePct: NaN } }, "FRSH")).toEqual({ quote: { price: null, changePct: null, volume: null }, sharesOutstanding: null });
      for (const bad of [null, "x", { ticker: "OTHER", quote: { price: 1 } }, { error: "room_access_required" }]) expect(parseStageLookup(bad, "FRSH")).toBeNull();
    });
  });
  it("formats the timer", () => {
    expect(stageElapsed(0)).toBe("00:00:00");
    expect(stageElapsed((34 * 60 + 12) * 1000)).toBe("00:34:12");
    expect(stageElapsed(3_723_000)).toBe("01:02:03");
  });
});
