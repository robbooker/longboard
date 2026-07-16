import { describe, expect, it } from "vitest";
import { nyClockToUtcMs } from "@/lib/polygon/client";
import type { Bar } from "@/lib/polygon/types";
import {
  buildReconciledDispatchRow,
  previousWeekdayEtDate,
  type QualifiedRvolDiagnostic,
} from "../rvolMorningReconciliation";

function bar(date: [number, number, number], hour: number, minute: number, close: number): Bar {
  return {
    time: Math.floor(nyClockToUtcMs(date[0], date[1], date[2], hour, minute) / 1000),
    open: close,
    high: close,
    low: close,
    close,
    volume: 100_000,
  };
}

const diagnostic: QualifiedRvolDiagnostic = {
  et_date: "2026-07-15",
  ticker: "TEST",
  best_bar_unix_seconds: Math.floor(nyClockToUtcMs(2026, 7, 15, 9, 35) / 1000),
  best_bar_time_et: "09:35",
  signal_rvol: 8.25,
  breakout_level: 2.4,
  breakout_mode: "premarketHigh",
  rvol_method: "sameDayRolling",
};

describe("rvol morning reconciliation", () => {
  it("selects the prior weekday in Eastern time", () => {
    expect(previousWeekdayEtDate(new Date("2026-07-16T13:00:00Z"))).toBe("2026-07-15");
    expect(previousWeekdayEtDate(new Date("2026-07-13T13:00:00Z"))).toBe("2026-07-10");
  });

  it("reconstructs a missing dispatch from a qualified diagnostic and Polygon bars", () => {
    const signalBar = bar([2026, 7, 15], 9, 35, 2.5);
    const row = buildReconciledDispatchRow(diagnostic, [signalBar], [
      bar([2026, 7, 14], 16, 0, 2),
      bar([2026, 7, 15], 16, 0, 2.75),
    ]);

    expect(row).toMatchObject({
      alert_key: `2026-07-15:5m:TEST:${signalBar.time}`,
      ticker: "TEST",
      signal_price: 2.5,
      change_pct: 25,
      signal_origin: "historical_backtest",
      status: "skipped",
    });
  });

  it("refuses to restore a row without its signal bar or previous close", () => {
    expect(buildReconciledDispatchRow(diagnostic, [], [bar([2026, 7, 14], 16, 0, 2)])).toBeNull();
    expect(buildReconciledDispatchRow(diagnostic, [bar([2026, 7, 15], 9, 35, 2.5)], [])).toBeNull();
  });
});
