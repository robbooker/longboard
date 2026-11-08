import { describe, expect, it } from "vitest";
import {
  ibAvailLabel,
  ibFeeLabel,
  ibFromDb,
  ibNoneToLend,
  ibTitle,
  parseGainersIb,
  type GainersIb,
} from "@/lib/chatGainersIb";

// #376: Interactive Brokers' fee and shares available: how a post is checked and how the table shows it.
const NOW = Date.parse("2026-11-09T15:00:00Z");
const row = { ticker: "HOTT", feePct: 1390.3435, rebatePct: -1386.4635, available: 70_000, availableMore: false };
const body = (extra: Record<string, unknown> = {}) => ({ kind: "ib", fileTime: "2026-11-09T14:42:10.000Z", rows: [row], ...extra });
const ib = (extra: Partial<GainersIb> = {}): GainersIb => ({
  feePct: 8.88,
  rebatePct: -5,
  available: 70_000,
  availableMore: false,
  fileTime: "2026-11-09T14:42:10.000Z",
  ...extra,
});

describe("parseGainersIb", () => {
  it("accepts a good post", () => {
    expect(parseGainersIb(body(), NOW)).toEqual({ fileTime: "2026-11-09T14:42:10.000Z", rows: [row] });
    const more = { ticker: "AAPL", feePct: 0.43, rebatePct: null, available: 10_000_000, availableMore: true };
    expect(parseGainersIb(body({ rows: [row, more, { ...row, ticker: "ABR PRD", feePct: null, available: null }] }), NOW)?.rows).toHaveLength(3);
  });
  it("refuses anything off", () => {
    const bad = [
      null,
      [],
      { ...body(), extra: 1 },
      body({ kind: "borrow" }),
      body({ fileTime: "2026-11-09 14:42" }),
      body({ fileTime: "2026-11-09T17:00:00Z" }), // two hours ahead
      body({ fileTime: "2019-01-01T00:00:00Z" }),
      body({ rows: [] }),
      body({ rows: Array.from({ length: 201 }, (_, i) => ({ ...row, ticker: `T${"ABCDEFGHIJ"[i % 10]}${"ABCDEFGHIJKLMNOPQRSTU"[Math.floor(i / 10)]}` })) }),
      body({ rows: [row, row] }),
      body({ rows: [{ ...row, ticker: "lower" }] }),
      body({ rows: [{ ...row, feePct: "1" }] }),
      body({ rows: [{ ...row, feePct: 1e9 }] }),
      body({ rows: [{ ...row, available: -1 }] }),
      body({ rows: [{ ...row, available: 1.5 }] }),
      body({ rows: [{ ...row, available: null, availableMore: true }] }),
      body({ rows: [{ ...row, extra: 1 }] }),
      body({ rows: ["HOTT"] }),
    ];
    for (const value of bad) expect(parseGainersIb(value, NOW)).toBeNull();
  });
  it("reads database rows", () => {
    expect(
      ibFromDb({ ticker: "X", fee_pct: "8.8800", rebate_pct: null, available: "70000", available_more: false, file_time: "2026-11-09T14:42:10+00:00", updated_at: "x" }),
    ).toEqual({ feePct: 8.88, rebatePct: null, available: 70_000, availableMore: false, fileTime: "2026-11-09T14:42:10.000Z" });
  });
});

describe("IB display", () => {
  it("shows the fee as % a year", () => {
    expect(ibFeeLabel(ib({ feePct: 1390.3435 }))).toBe("1,390%");
    expect(ibFeeLabel(ib({ feePct: 8.88 }))).toBe("8.9%");
    expect(ibFeeLabel(ib({ feePct: 0.25 }))).toBe("0.25%");
    expect(ibFeeLabel(ib({ feePct: null }))).toBe("—");
    expect(ibFeeLabel(null)).toBe("—");
  });
  it("shows shares available short, > when IB has more", () => {
    expect(ibAvailLabel(ib({ available: 70_000 }))).toBe("70K");
    expect(ibAvailLabel(ib({ available: 2_800_000 }))).toBe("2.8M");
    expect(ibAvailLabel(ib({ available: 10_000_000, availableMore: true }))).toBe(">10M");
    expect(ibAvailLabel(ib({ available: 100 }))).toBe("100");
    expect(ibAvailLabel(ib({ available: 0 }))).toBe("0");
    expect(ibAvailLabel(ib({ available: null }))).toBe("—");
    expect(ibAvailLabel(undefined)).toBe("—");
    expect(ibNoneToLend(ib({ available: 0 }))).toBe(true);
    expect(ibNoneToLend(ib({ available: 70_000 }))).toBe(false);
    expect(ibNoneToLend(null)).toBe(false);
  });
  it("says when IB wrote the file, in New York time", () => {
    expect(ibTitle(ib(), NOW)).toBe("Interactive Brokers indicative rate, updated 9:42 ET");
    expect(ibTitle(ib({ fileTime: "2026-11-06T20:58:00.000Z" }), NOW)).toBe("Interactive Brokers indicative rate, updated Nov 6, 3:58 ET");
    expect(ibTitle(null, NOW)).toBe("No Interactive Brokers rate yet");
  });
});
