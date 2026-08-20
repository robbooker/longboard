import { describe, expect, it } from "vitest";
import { emptyStock, type MorningEmailStock } from "@/lib/morning-email/types";
import { summarizeMorningReportWeek } from "@/lib/morning-report/weekSummary";

function stock(ticker: string, changePct: number): MorningEmailStock {
  return {
    ...emptyStock(),
    ticker,
    name: ticker,
    change_pct: changePct,
  };
}

describe("morning report week summary", () => {
  it("uses only the latest saved version for each report date", () => {
    const summary = summarizeMorningReportWeek([
      {
        report_date: "2026-08-17",
        sent_date: "2026-08-17",
        created_at: "2026-08-17T11:00:00.000Z",
        stocks_json: [stock("OLD", 4)],
      },
      {
        report_date: "2026-08-17",
        sent_date: "2026-08-17",
        created_at: "2026-08-17T20:00:00.000Z",
        stocks_json: [stock("NEW", 12), stock("KEEP", 8)],
      },
      {
        report_date: "2026-08-18",
        sent_date: "2026-08-18",
        created_at: "2026-08-18T20:00:00.000Z",
        stocks_json: [stock("KEEP", 18), stock("THIRD", -2)],
      },
    ], "2026-08-17", "2026-08-21");

    expect(summary.daysReported).toBe(2);
    expect(summary.boardAppearances).toBe(4);
    expect(summary.uniqueTickers).toBe(3);
    expect(summary.days[0]?.tickers).toEqual(["NEW", "KEEP"]);
    expect(summary.topRunner).toEqual({
      ticker: "KEEP",
      changePct: 18,
      reportDate: "2026-08-18",
    });
  });

  it("ignores rows outside the requested Monday-through-Friday range", () => {
    const summary = summarizeMorningReportWeek([
      {
        report_date: "2026-08-16",
        sent_date: "2026-08-16",
        created_at: "2026-08-16T20:00:00.000Z",
        stocks_json: [stock("SUNDAY", 99)],
      },
      {
        report_date: "2026-08-22",
        sent_date: "2026-08-22",
        created_at: "2026-08-22T20:00:00.000Z",
        stocks_json: [stock("SATURDAY", 88)],
      },
    ], "2026-08-17", "2026-08-21");

    expect(summary.daysReported).toBe(0);
    expect(summary.topRunner).toBeNull();
  });
});
