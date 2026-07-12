import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/polygon/types";
import { addIsoDays, calculateLongingSignal, mondayForEtDate, summarizeLongingSignals } from "../calculate";

const baseTime = Date.parse("2026-07-10T13:30:00Z") / 1000;
const bars: Bar[] = [
  { time: baseTime, open: 10, high: 10.2, low: 9.9, close: 10, volume: 100 },
  { time: Date.parse("2026-07-10T19:55:00Z") / 1000, open: 11, high: 12.1, low: 9, close: 11, volume: 400 },
  { time: Date.parse("2026-07-10T23:55:00Z") / 1000, open: 11, high: 11.5, low: 10.5, close: 11.5, volume: 500 },
];

const row = {
  alert_key: "2026-07-10:5m:TEST:1",
  et_date: "2026-07-10",
  ticker: "TEST",
  signal_unix_seconds: baseTime,
  signal_time_et: "09:30",
  signal_rvol: 8,
  signal_price: 10,
  change_pct: 25,
  status: "sent" as const,
  error: null,
  created_at: "2026-07-10T13:35:00Z",
};

describe("calculateLongingSignal", () => {
  it("computes extended-session volume, exits, excursions, and the 20% target", () => {
    const result = calculateLongingSignal(row, bars);
    expect(result).not.toBeNull();
    expect(result?.dayVolume).toBe(1_000);
    expect(result?.return4pmPct).toBe(10);
    expect(result?.return8pmPct).toBe(15);
    expect(result?.dayMove8pmPct).toBe(43.75);
    expect(result?.maxFavorablePct).toBe(21);
    expect(result?.maxAdversePct).toBe(-10);
    expect(result?.target20Hit).toBe(true);
    expect(result?.pnlTargetOr8pm).toBe(200);
    expect(result?.stale).toBe(false);
  });

  it("marks delayed discoveries as stale", () => {
    const result = calculateLongingSignal({ ...row, created_at: "2026-07-10T15:30:00Z" }, bars);
    expect(result?.stale).toBe(true);
    expect(result?.detectionDelayMinutes).toBe(120);
  });
});

describe("summarizeLongingSignals", () => {
  it("reports theoretical portfolio returns for $1,000 per signal", () => {
    const first = calculateLongingSignal(row, bars);
    const second = first && { ...first, return4pmPct: -5, pnl4pm: -50, target20Hit: false, pnlTargetOr8pm: 150 };
    const summary = summarizeLongingSignals(first && second ? [first, second] : []);
    expect(summary.capitalDeployed).toBe(2_000);
    expect(summary.average4pmPct).toBe(2.5);
    expect(summary.median4pmPct).toBe(2.5);
    expect(summary.winRate4pmPct).toBe(50);
    expect(summary.pnl4pm).toBe(50);
    expect(summary.returnOnCapital4pmPct).toBe(2.5);
    expect(summary.target20HitRatePct).toBe(50);
  });
});

describe("week helpers", () => {
  it("uses the Monday through Friday containing a Sunday ET date", () => {
    expect(mondayForEtDate(new Date("2026-07-12T17:00:00Z"))).toBe("2026-07-06");
    expect(addIsoDays("2026-07-06", 4)).toBe("2026-07-10");
  });
});
