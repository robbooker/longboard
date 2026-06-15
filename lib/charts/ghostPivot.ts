import { fetchDailyBarsEndingOn } from "@/lib/polygon/bars";
import type { Bar } from "@/lib/polygon/types";

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

export type GhostPivot = {
  price: number;
  sourceMonth: string;
  sourceMonthLabel: string;
  activeMonth: string;
  activeMonthLabel: string;
  high: number;
  low: number;
  close: number;
  lastCheckedDate: string;
};

function parseEtDateIso(etDateIso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etDateIso);
  if (!match) {
    throw new Error(`Invalid ET date "${etDateIso}", expected YYYY-MM-DD`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function etDateOf(unixSeconds: number): string {
  return ET_DATE_FMT.format(new Date(unixSeconds * 1000));
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL_FMT.format(new Date(Date.UTC(year, month - 1, 1)));
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function computeGhostPivotFromDailyBars(bars: Bar[], throughEtDate: string): GhostPivot | null {
  const { year, month } = parseEtDateIso(throughEtDate);
  const sourceMonth = monthKey(year, month);
  const monthBars = bars
    .filter((bar) => {
      const etDate = etDateOf(bar.time);
      return etDate <= throughEtDate && etDate.startsWith(`${sourceMonth}-`);
    })
    .sort((a, b) => a.time - b.time);

  if (monthBars.length === 0) return null;

  const high = Math.max(...monthBars.map((bar) => bar.high));
  const low = Math.min(...monthBars.map((bar) => bar.low));
  const close = monthBars[monthBars.length - 1].close;
  const active = addMonths(year, month, 1);
  const activeMonth = monthKey(active.year, active.month);

  return {
    price: (high + low + close) / 3,
    sourceMonth,
    sourceMonthLabel: monthLabel(sourceMonth),
    activeMonth,
    activeMonthLabel: monthLabel(activeMonth),
    high,
    low,
    close,
    lastCheckedDate: throughEtDate,
  };
}

export async function fetchGhostPivot(ticker: string, throughEtDate: string): Promise<GhostPivot | null> {
  const dailyBars = await fetchDailyBarsEndingOn(ticker, throughEtDate);
  return computeGhostPivotFromDailyBars(dailyBars, throughEtDate);
}
