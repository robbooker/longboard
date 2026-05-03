import { describe, it, expect } from "vitest";
import type { GapEvent } from "../types";
import {
  buildDayTabs,
  dayTabLabel,
  filterByDay,
  sortEvents,
  nextSort,
  formatGapPct,
  formatVolume,
  formatLongScore,
  DEFAULT_SORT,
} from "../sort";

const ev = (overrides: Partial<GapEvent> = {}): GapEvent => ({
  ticker: "TEST",
  gap_date: "2026-04-27",
  prev_date: "2026-04-24",
  gap_pct: 25,
  ah_price: 5,
  price_830am: 6,
  rough_gap_pct: 24,
  volume: 1_000_000,
  ...overrides,
});

describe("dayTabLabel", () => {
  it("formats a Monday correctly", () => {
    expect(dayTabLabel("2026-04-27")).toBe("Mon Apr 27");
  });
  it("formats a Friday correctly", () => {
    expect(dayTabLabel("2026-05-01")).toBe("Fri May 1");
  });
  it("returns input on malformed iso", () => {
    expect(dayTabLabel("not-a-date")).toBe("not-a-date");
  });
});

describe("buildDayTabs", () => {
  it("prepends an All tab and orders days chronologically", () => {
    const events = [
      ev({ gap_date: "2026-05-01" }),
      ev({ gap_date: "2026-04-27" }),
      ev({ gap_date: "2026-04-27" }),
      ev({ gap_date: "2026-04-29" }),
    ];
    const tabs = buildDayTabs(events);
    expect(tabs.map((t) => t.key)).toEqual([
      "all",
      "2026-04-27",
      "2026-04-29",
      "2026-05-01",
    ]);
    expect(tabs[0].count).toBe(4);
    expect(tabs[1].count).toBe(2);
  });

  it("handles empty events", () => {
    const tabs = buildDayTabs([]);
    expect(tabs).toEqual([{ key: "all", label: "All", count: 0 }]);
  });
});

describe("filterByDay", () => {
  it("passes through on 'all'", () => {
    const events = [ev({ ticker: "A" }), ev({ ticker: "B" })];
    expect(filterByDay(events, "all")).toEqual(events);
  });
  it("filters to a specific gap_date", () => {
    const events = [
      ev({ ticker: "A", gap_date: "2026-04-27" }),
      ev({ ticker: "B", gap_date: "2026-04-28" }),
      ev({ ticker: "C", gap_date: "2026-04-27" }),
    ];
    const f = filterByDay(events, "2026-04-27");
    expect(f.map((e) => e.ticker)).toEqual(["A", "C"]);
  });
});

describe("sortEvents", () => {
  it("sorts symbol asc alphabetically", () => {
    const events = [
      ev({ ticker: "RDAC" }),
      ev({ ticker: "AKAN" }),
      ev({ ticker: "HTCO" }),
    ];
    const out = sortEvents(events, "symbol", "asc");
    expect(out.map((e) => e.ticker)).toEqual(["AKAN", "HTCO", "RDAC"]);
  });

  it("sorts gap_pct desc", () => {
    const events = [
      ev({ ticker: "A", gap_pct: 12 }),
      ev({ ticker: "B", gap_pct: 195 }),
      ev({ ticker: "C", gap_pct: 38 }),
    ];
    const out = sortEvents(events, "gap_pct", "desc");
    expect(out.map((e) => e.ticker)).toEqual(["B", "C", "A"]);
  });

  it("sorts volume desc with correct ordering on big numbers", () => {
    const events = [
      ev({ ticker: "A", volume: 50_000 }),
      ev({ ticker: "B", volume: 12_000_000 }),
      ev({ ticker: "C", volume: 800_000 }),
    ];
    const out = sortEvents(events, "volume", "desc");
    expect(out.map((e) => e.ticker)).toEqual(["B", "C", "A"]);
  });

  it("sorts long_score with missing values pushed to bottom regardless of dir", () => {
    const events = [
      ev({ ticker: "A", long_score: 50 }),
      ev({ ticker: "B" }), // no long_score
      ev({ ticker: "C", long_score: 97 }),
    ];
    const desc = sortEvents(events, "long_score", "desc");
    expect(desc.map((e) => e.ticker)).toEqual(["C", "A", "B"]);
    const asc = sortEvents(events, "long_score", "asc");
    // B (undefined) still last, A (50) before C (97) for asc
    expect(asc.map((e) => e.ticker)).toEqual(["A", "C", "B"]);
  });

  it("does not mutate input array", () => {
    const events = [
      ev({ ticker: "Z" }),
      ev({ ticker: "A" }),
    ];
    const snapshot = events.map((e) => e.ticker);
    sortEvents(events, "symbol", "asc");
    expect(events.map((e) => e.ticker)).toEqual(snapshot);
  });
});

describe("nextSort", () => {
  it("first click on a numeric column defaults to desc", () => {
    expect(nextSort({ key: "symbol", dir: "asc" }, "gap_pct")).toEqual({
      key: "gap_pct",
      dir: "desc",
    });
  });
  it("first click on symbol defaults to asc", () => {
    expect(nextSort({ key: "gap_pct", dir: "desc" }, "symbol")).toEqual({
      key: "symbol",
      dir: "asc",
    });
  });
  it("second click on same column flips direction", () => {
    expect(nextSort({ key: "gap_pct", dir: "desc" }, "gap_pct")).toEqual({
      key: "gap_pct",
      dir: "asc",
    });
    expect(nextSort({ key: "gap_pct", dir: "asc" }, "gap_pct")).toEqual({
      key: "gap_pct",
      dir: "desc",
    });
  });
});

describe("formatters", () => {
  it("formatGapPct adds + sign on positive", () => {
    expect(formatGapPct(195)).toBe("+195.0%");
    expect(formatGapPct(-32)).toBe("-32.0%");
    expect(formatGapPct(0)).toBe("+0.0%");
  });

  it("formatVolume scales correctly", () => {
    expect(formatVolume(500)).toBe("500");
    expect(formatVolume(50_000)).toBe("50K");
    expect(formatVolume(12_000_000)).toBe("12.0M");
    expect(formatVolume(2_500_000_000)).toBe("2.5B");
  });

  it("formatLongScore handles undefined", () => {
    expect(formatLongScore(undefined)).toBe("—");
    expect(formatLongScore(97.4)).toBe("97.4");
  });
});

describe("DEFAULT_SORT", () => {
  it("is long_score desc — top actionable row first", () => {
    expect(DEFAULT_SORT).toEqual({ key: "long_score", dir: "desc" });
  });
});
