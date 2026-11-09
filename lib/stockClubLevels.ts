// #386 Booker Stock Club: the price levels above the #1 stock of the day. The monthly pivots are a
// port of scripts/gainers-daily/run.py (chart_stock), the nightly gainers page's math, so a level
// here is the same number as on that page:
//  - each month's pivot is (high + low + close) / 3 of that month's 60-minute extended-hours bars,
//    and becomes the pivot of the month after it;
//  - the current monthly pivot (CMP) is last month's;
//  - a missed pivot is an older month's pivot that no hour bar touched (low <= pivot <= high) from
//    the month it became active up to the day before the chart day.
// The daily 200 SMA is the average of the last 200 daily closes before the day.
// Pure functions only (unit tested against run.py's own output in lib/__tests__/stockClubLevels.test.ts).

/** One Polygon aggregate bar: t in milliseconds (UTC), as Polygon sends it. */
export type AggBar = { t: number; h: number; l: number; c: number };

export type MissedPivot = { price: number; month: string };
export type MonthlyPivots = { cmp: number | null; missed: MissedPivot[] };

export type StockClubLevels = MonthlyPivots & { sma200: number | null };
export type LevelKind = "missed" | "cmp" | "sma200";
export type LevelAbove = { kind: LevelKind; price: number; label: string };

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-06": the New York date of a bar. */
export const etDay = (ms: number) => ET_DAY.format(new Date(ms));

function nextMonth(key: string) {
  let [y, m] = key.split("-").map(Number);
  m += 1;
  if (m > 12) [y, m] = [y + 1, 1];
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** "Aug 26", like run.py's strftime("%b %y"). */
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

/** The current monthly pivot and the missed pivots for `day` (YYYY-MM-DD), from hour bars in time order. */
export function monthlyPivots(hours: AggBar[], day: string): MonthlyPivots {
  const dates = hours.map((bar) => etDay(bar.t));
  const months = new Map<string, { h: number; l: number; c: number }>();
  hours.forEach((bar, i) => {
    const key = dates[i].slice(0, 7);
    const m = months.get(key);
    if (!m) months.set(key, { h: bar.h, l: bar.l, c: bar.c });
    else {
      m.h = Math.max(m.h, bar.h);
      m.l = Math.min(m.l, bar.l);
      m.c = bar.c;
    }
  });
  const current = day.slice(0, 7);
  let cmp: number | null = null;
  const missed: MissedPivot[] = [];
  for (const key of [...months.keys()].sort()) {
    const m = months.get(key)!;
    const active = nextMonth(key);
    if (active > current) continue;
    const pivot = (m.h + m.l + m.c) / 3;
    if (active === current) {
      cmp = pivot;
      continue;
    }
    const touched = hours.some((bar, i) => dates[i].slice(0, 7) >= active && dates[i] < day && bar.l <= pivot && pivot <= bar.h);
    if (!touched) missed.push({ price: pivot, month: monthLabel(active) });
  }
  missed.sort((a, b) => a.price - b.price);
  return { cmp, missed };
}

/** The average of the last 200 daily closes before `day`; null with fewer than 200. Rounded like run.py's SMA. */
export function dailySma200(daily: AggBar[], day: string): number | null {
  const closes = daily.filter((bar) => etDay(bar.t) < day).map((bar) => bar.c);
  if (closes.length < 200) return null;
  const last = closes.slice(-200);
  return Math.round((last.reduce((sum, c) => sum + c, 0) / 200) * 10_000) / 10_000;
}

/** The levels above `price`, nearest first: every missed pivot, the CMP and the daily 200 SMA. */
export function levelsAbove(levels: StockClubLevels, price: number): LevelAbove[] {
  const out: LevelAbove[] = levels.missed.map((m) => ({ kind: "missed", price: m.price, label: `Missed pivot · ${m.month}` }));
  if (levels.cmp !== null) out.push({ kind: "cmp", price: levels.cmp, label: "Monthly pivot (CMP)" });
  if (levels.sma200 !== null) out.push({ kind: "sma200", price: levels.sma200, label: "Daily 200 SMA" });
  return out.filter((level) => Number.isFinite(level.price) && level.price > price).sort((a, b) => a.price - b.price);
}
