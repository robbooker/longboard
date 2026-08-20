import type { MorningEmailStock } from "@/lib/morning-email/types";

export type MorningReportVersionInput = {
  report_date: string | null;
  sent_date: string | null;
  stocks_json: MorningEmailStock[] | null;
  created_at: string;
};

export type MorningReportWeekDay = {
  reportDate: string;
  tickers: string[];
  appearances: number;
  averageMove: number;
};

export type MorningReportWeekSummary = {
  weekStart: string;
  weekEnd: string;
  daysReported: number;
  boardAppearances: number;
  uniqueTickers: number;
  topRunner: {
    ticker: string;
    changePct: number;
    reportDate: string;
  } | null;
  days: MorningReportWeekDay[];
};

function reportDateFor(row: MorningReportVersionInput): string | null {
  return row.report_date ?? row.sent_date;
}

function createdAtMs(row: MorningReportVersionInput): number {
  const parsed = Date.parse(row.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Summarize one report week without counting live-refresh archive versions as
 * additional boards. Only the newest saved version for each report date is
 * included in the totals.
 */
export function summarizeMorningReportWeek(
  rows: MorningReportVersionInput[],
  weekStart: string,
  weekEnd: string,
): MorningReportWeekSummary {
  const latestByDate = new Map<string, MorningReportVersionInput>();

  for (const row of rows) {
    const reportDate = reportDateFor(row);
    if (!reportDate || reportDate < weekStart || reportDate > weekEnd) continue;
    const existing = latestByDate.get(reportDate);
    if (!existing || createdAtMs(row) > createdAtMs(existing)) {
      latestByDate.set(reportDate, row);
    }
  }

  const uniqueTickers = new Set<string>();
  let topRunner: MorningReportWeekSummary["topRunner"] = null;

  const days = [...latestByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reportDate, row]) => {
      const stocks = Array.isArray(row.stocks_json)
        ? row.stocks_json.filter((stock) => stock?.ticker?.trim())
        : [];
      const tickers = stocks.map((stock) => stock.ticker.trim().toUpperCase());
      for (const ticker of tickers) uniqueTickers.add(ticker);

      for (const stock of stocks) {
        if (!Number.isFinite(stock.change_pct)) continue;
        if (!topRunner || stock.change_pct > topRunner.changePct) {
          topRunner = {
            ticker: stock.ticker.trim().toUpperCase(),
            changePct: stock.change_pct,
            reportDate,
          };
        }
      }

      const finiteMoves = stocks
        .map((stock) => stock.change_pct)
        .filter(Number.isFinite);
      const averageMove = finiteMoves.length > 0
        ? finiteMoves.reduce((sum, move) => sum + move, 0) / finiteMoves.length
        : 0;

      return {
        reportDate,
        tickers,
        appearances: stocks.length,
        averageMove,
      };
    });

  return {
    weekStart,
    weekEnd,
    daysReported: days.length,
    boardAppearances: days.reduce((sum, day) => sum + day.appearances, 0),
    uniqueTickers: uniqueTickers.size,
    topRunner,
    days,
  };
}
