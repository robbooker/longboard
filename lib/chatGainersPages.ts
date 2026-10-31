// #340: the data behind one trading day's gainers page, and how it is checked on the way in. The job
// on Rob's computer (scripts/gainers-daily/run.py) builds it; /gainers/<day> renders it. Every text
// field ends up as React text, never as HTML.
export type GainersBar = [number, number, number, number, number, number];
export type GainersLine = [number, number];
export type GainersSession = "pre" | "day";
export type GainersFirstAlert = { ts: string; px: number; vol: number; sess: GainersSession };
export type GainersMissedPivot = { price: number; month: string };
export type GainersChartStock = {
  sym: string;
  country: string;
  peak: number;
  alertCount: number;
  first: GainersFirstAlert;
  lastCap: number;
  cmp: number | null;
  missed: GainersMissedPivot[];
  historyFrom: string | null;
  note: string | null;
  lo: number;
  hi: number;
  bars: GainersBar[];
  sma: GainersLine[];
  vwap: GainersLine[];
};
export type GainersTableStock = {
  sym: string;
  country: string;
  peak: number;
  first: GainersFirstAlert;
  lastCap: number;
};
export type GainersPageData = {
  day: string;
  total: number;
  top: GainersChartStock[];
  rest: GainersTableStock[];
};

const MAX_BARS = 1000;
const MAX_REST = 500;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= max;

/** A real calendar date written YYYY-MM-DD, or null. */
export function parseGainersDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function parseSymbol(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z. ]{0,11}$/.test(value) ? value : null;
}

function parseFirst(value: unknown): GainersFirstAlert | null {
  if (!isRecord(value)) return null;
  const { ts, px, vol, sess } = value;
  if (typeof ts !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(ts)) return null;
  if (Number.isNaN(Date.parse(ts)) || !finite(px) || px <= 0 || !finite(vol) || vol < 150000) return null;
  if (sess !== "pre" && sess !== "day") return null;
  return { ts, px, vol, sess };
}

function parseLine(value: unknown): GainersLine[] | null {
  if (!Array.isArray(value) || value.length > MAX_BARS) return null;
  for (const point of value)
    if (!Array.isArray(point) || point.length !== 2 || !finite(point[0]) || !finite(point[1])) return null;
  return value as GainersLine[];
}

function parseTableStock(value: unknown): GainersTableStock | null {
  if (!isRecord(value)) return null;
  const sym = parseSymbol(value.sym),
    first = parseFirst(value.first);
  if (!sym || !first || !text(value.country, 60) || !finite(value.peak) || !finite(value.lastCap)) return null;
  return { sym, country: value.country, peak: value.peak, first, lastCap: value.lastCap };
}

function parseChartStock(value: unknown): GainersChartStock | null {
  const base = parseTableStock(value);
  if (!base || !isRecord(value)) return null;
  const { alertCount, cmp, missed, historyFrom, note, lo, hi, bars } = value;
  if (!finite(alertCount) || alertCount < 1 || !finite(lo) || !finite(hi)) return null;
  if (cmp !== null && !finite(cmp)) return null;
  if (historyFrom !== null && !parseGainersDay(historyFrom)) return null;
  if (note !== null && !text(note, 300)) return null;
  if (!Array.isArray(missed) || missed.length > 200) return null;
  const pivots: GainersMissedPivot[] = [];
  for (const pivot of missed) {
    if (!isRecord(pivot) || !finite(pivot.price) || !text(pivot.month, 12)) return null;
    pivots.push({ price: pivot.price, month: pivot.month });
  }
  if (!Array.isArray(bars) || !bars.length || bars.length > MAX_BARS) return null;
  for (const bar of bars) if (!Array.isArray(bar) || bar.length !== 6 || !bar.every(finite)) return null;
  const sma = parseLine(value.sma),
    vwap = parseLine(value.vwap);
  if (!sma || !vwap) return null;
  return {
    ...base,
    alertCount,
    cmp: cmp as number | null,
    missed: pivots,
    historyFrom: historyFrom as string | null,
    note: note as string | null,
    lo,
    hi,
    bars: bars as GainersBar[],
    sma,
    vwap,
  };
}

/** Checks a whole day's data and returns only the known fields, or null when anything is off. */
export function parseGainersPage(value: unknown): GainersPageData | null {
  if (!isRecord(value)) return null;
  const day = parseGainersDay(value.day);
  const { total, top, rest } = value;
  if (!day || !finite(total) || total < 0 || !Array.isArray(top) || !Array.isArray(rest)) return null;
  if (!top.length || top.length > 6 || rest.length > MAX_REST) return null;
  const charts = top.map(parseChartStock),
    table = rest.map(parseTableStock);
  if (charts.some((stock) => !stock) || table.some((stock) => !stock)) return null;
  return { day, total, top: charts as GainersChartStock[], rest: table as GainersTableStock[] };
}

// --- Display. These match the approved page's Python formatting exactly, including how it rounds:
// an exact tie goes to the even digit (32.5 shows as 32), where JavaScript's toFixed would go up.
export function fixed(value: number, digits: number): string {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const tie = Number.isInteger(value * 2 ** (digits + 1)) && Math.abs(scaled % 1) === 0.5;
  if (!tie) return value.toFixed(digits);
  const lower = Math.floor(scaled);
  return ((lower % 2 === 0 ? lower : lower + 1) / scale).toFixed(digits);
}
const NY = "America/New_York";
export const ASIAN_COUNTRIES = new Set(["China", "Hong Kong", "Singapore", "Taiwan", "Japan", "Malaysia"]);
export const money = (value: number) =>
  value >= 10
    ? `$${Number(fixed(value, 2)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${fixed(value, 3)}`;
export const shares = (value: number) =>
  value >= 1e6 ? `${fixed(value / 1e6, 1)}M` : `${fixed(value / 1e3, 0)}K`;
export const marketCap = (value: number) =>
  value >= 1e9
    ? `$${fixed(value / 1e9, 1)}B`
    : value >= 1e6
      ? `$${fixed(value / 1e6, 1)}M`
      : `$${fixed(value / 1e3, 0)}K`;
export const easternTime = (ts: string) =>
  new Date(ts).toLocaleTimeString("en-US", { timeZone: NY, hour: "numeric", minute: "2-digit", hour12: true });
export const SESSION_LABEL: Record<GainersSession, string> = { pre: "pre-market", day: "regular hours" };

/** The signal candle: Eastern wall-clock time as if it were UTC, on the chart's 2-minute grid. */
export function signalCandleTime(ts: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const seconds = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) / 1000;
  return seconds - (seconds % 120);
}

const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);
const dayPart = (day: string, options: Intl.DateTimeFormatOptions) =>
  dayDate(day).toLocaleDateString("en-US", { timeZone: "UTC", ...options });
export const weekdayName = (day: string) => dayPart(day, { weekday: "long" });
export const monthShort = (day: string) => dayPart(day, { month: "short" });
export const niceDay = (day: string) => `${monthShort(day)} ${dayDate(day).getUTCDate()}`;

/** The pivots line under a chart's heading. */
export function levelsLine(stock: GainersChartStock, day: string): string {
  const off = (value: number) => (value > stock.hi ? " (above chart)" : value < stock.lo ? " (below chart)" : "");
  const month = monthShort(day);
  const first = dayDate(day);
  first.setUTCDate(0);
  const previous = first.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
  const pivot =
    stock.cmp !== null
      ? `${month} pivot ${money(stock.cmp)}${off(stock.cmp)}`
      : `${month} pivot: none, no ${previous} trading`;
  let note = stock.note;
  if (!note && stock.historyFrom) {
    const age = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${stock.historyFrom}T00:00:00Z`)) / 86400000;
    if (age < 92) note = `Market data starts ${stock.historyFrom}, so older missed pivots are not checked.`;
  }
  let missed: string;
  if (!stock.missed.length) missed = note ? "Missed pivots: none found" : "Missed pivots: none";
  else {
    missed =
      "Missed pivots: " +
      stock.missed
        .slice(0, 3)
        .map((item) => `${money(item.price)} ${item.month}${off(item.price)}`)
        .join(", ");
    if (stock.missed.length > 3) missed += `, ${stock.missed.length - 3} more higher`;
  }
  return `${pivot}. ${missed}.${note ? ` ${note}` : ""}`;
}
