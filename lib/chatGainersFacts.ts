// #371 Gainers Table: the company facts behind each row (country, cash left, institutional
// ownership), how a lookup's result is checked on the way in, which tickers still need a lookup,
// and how the table shows them. The lookup program on Rob's computer (scripts/gainers-lookup/)
// reads DilutionTracker and posts here; the table shows every value as React text.
import type { GainersBorrow } from "@/lib/chatGainersBorrow";
import type { GainersIb } from "@/lib/chatGainersIb";

/** Cash is looked up again once it is this old. The country never is. */
export const CASH_STALE_DAYS = 30;
/** A ticker DilutionTracker had no page for is tried again after this long. */
export const NOT_FOUND_RETRY_HOURS = 6;
const DAY_MS = 86_400_000;

/** One row of public.chat_gainers_table(day), as the database returns it. */
export type GainersTableDbRow = {
  ticker: string;
  last_alert_at: string;
  alerts: number;
  country: string | null;
  country_checked_at: string | null;
  cash_usd: number | string | null;
  cash_months_left: number | string | null;
  cash_flow_positive: boolean;
  cash_checked_at: string | null;
  inst_own_pct: number | string | null;
  inst_own_checked_at: string | null;
  not_found: boolean;
  checked_at: string | null;
};

/** One row as the table view gets it. A null *Checked means "not looked up yet". */
export type GainersTableRow = {
  sym: string;
  lastAlertAt: string;
  alerts: number;
  country: string | null;
  countryChecked: boolean;
  cashUsd: number | null;
  cashMonthsLeft: number | null;
  cashFlowPositive: boolean;
  cashChecked: boolean;
  instOwnPct: number | null;
  instOwnChecked: boolean;
  notFound: boolean;
  /** #372: price, % today and volume today from Polygon's snapshot; null when it couldn't be read. */
  quote?: GainersQuote | null;
  /** #373: today's TradeZero borrow check; null before the first one. */
  borrow?: GainersBorrow | null;
  /** #376: Interactive Brokers' borrow fee and shares to lend; null before the first file is read. */
  ib?: GainersIb | null;
};

/** #372: one ticker's snapshot as the table shows it. Any part may be missing. */
export type GainersQuote = { price: number | null; changePct: number | null; volume: number | null };

export type GainersTableData = { day: string; rows: GainersTableRow[] };

const num = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function tableRow(row: GainersTableDbRow): GainersTableRow {
  return {
    sym: row.ticker,
    lastAlertAt: new Date(row.last_alert_at).toISOString(),
    alerts: row.alerts,
    country: row.country,
    countryChecked: !!row.country_checked_at,
    cashUsd: num(row.cash_usd),
    cashMonthsLeft: num(row.cash_months_left),
    cashFlowPositive: !!row.cash_flow_positive,
    cashChecked: !!row.cash_checked_at,
    instOwnPct: num(row.inst_own_pct),
    instOwnChecked: !!row.inst_own_checked_at,
    notFound: !!row.not_found,
  };
}

/** What a ticker still needs looked up, or null when nothing. */
export function factsNeeded(row: GainersTableDbRow, now = Date.now()): string[] | null {
  if (row.not_found && !row.country_checked_at && !row.cash_checked_at && !row.inst_own_checked_at) {
    const at = row.checked_at ? Date.parse(row.checked_at) : 0;
    return now - at >= NOT_FOUND_RETRY_HOURS * 3_600_000 ? ["country", "cash", "instOwn"] : null;
  }
  const needs: string[] = [];
  if (!row.country_checked_at) needs.push("country");
  const cashAt = row.cash_checked_at ? Date.parse(row.cash_checked_at) : NaN;
  if (!Number.isFinite(cashAt) || now - cashAt > CASH_STALE_DAYS * DAY_MS) needs.push("cash");
  if (!row.inst_own_checked_at) needs.push("instOwn");
  return needs.length ? needs : null;
}

export type GainersFactsInput = {
  ticker: string;
  notFound: boolean;
  country: string | null;
  cashUsd: number | null;
  cashMonthsLeft: number | null;
  cashFlowPositive: boolean;
  instOwnPct: number | null;
};

const TICKER = /^[A-Z][A-Z. ]{0,11}$/;
const KEYS = ["ticker", "notFound", "country", "cashUsd", "cashMonthsLeft", "cashFlowPositive", "instOwnPct"];
const within = (value: unknown, max: number): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max);

/** Checks one lookup's result; returns only the known fields, or null when anything is off. */
export function parseGainersFacts(value: unknown): GainersFactsInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => !KEYS.includes(key)) || KEYS.some((key) => !(key in p))) return null;
  if (typeof p.ticker !== "string" || !TICKER.test(p.ticker)) return null;
  if (typeof p.notFound !== "boolean" || typeof p.cashFlowPositive !== "boolean") return null;
  if (p.country !== null && (typeof p.country !== "string" || !/^[^\0<>]{1,60}$/.test(p.country) || !p.country.trim()))
    return null;
  if (!within(p.cashUsd, 1e13) || !within(p.cashMonthsLeft, 1e6) || !within(p.instOwnPct, 1000)) return null;
  return {
    ticker: p.ticker,
    notFound: p.notFound,
    country: p.notFound || p.country === null ? null : p.country.trim(),
    cashUsd: p.notFound ? null : p.cashUsd,
    cashMonthsLeft: p.notFound ? null : p.cashMonthsLeft,
    cashFlowPositive: !p.notFound && p.cashFlowPositive,
    instOwnPct: p.notFound ? null : p.instOwnPct,
  };
}

/** Today's date in New York, YYYY-MM-DD: the gainers room's trading day. */
export function easternDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

// --- Display.
const LOOKING_UP = "looking up…";
const NONE = "—";

/** "$31.5M", "$1.2B", "$850K". */
export function cashAmount(value: number) {
  const [scaled, unit] = value >= 1e9 ? [value / 1e9, "B"] : value >= 1e6 ? [value / 1e6, "M"] : [value / 1e3, "K"];
  return `$${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1))}${unit}`;
}

/** "$31.5M · 304 mo" (whole months, rounded down, as Rob wrote it), "Cash flow positive", "—",
 * or "looking up…" until the lookup has been. */
export function cashLabel(row: GainersTableRow) {
  if (row.cashFlowPositive) return row.cashUsd !== null ? `${cashAmount(row.cashUsd)} · cash flow positive` : "Cash flow positive";
  if (row.cashUsd !== null) {
    const months = row.cashMonthsLeft === null ? null : Math.floor(row.cashMonthsLeft);
    return months === null ? cashAmount(row.cashUsd) : `${cashAmount(row.cashUsd)} · ${months.toLocaleString("en-US")} mo`;
  }
  return row.cashChecked || row.notFound ? NONE : LOOKING_UP;
}

export function countryLabel(row: GainersTableRow) {
  if (row.country) return row.country;
  return row.countryChecked || row.notFound ? NONE : LOOKING_UP;
}

export function instOwnLabel(row: GainersTableRow) {
  if (row.instOwnPct !== null) return `${Number(row.instOwnPct.toFixed(1))}%`;
  return row.instOwnChecked || row.notFound ? NONE : LOOKING_UP;
}

/** Whole minutes since the most recent alert (never below 0). */
export function minutesSince(at: string, now: number) {
  return Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
}

export const isLookingUp = (label: string) => label === LOOKING_UP;

// --- #372: price, % today and volume today.

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** "$1.23", "$1,234.50"; four decimals under $1 ("$0.4512"); "—" without a price. */
export function priceLabel(quote: GainersQuote | null | undefined) {
  const price = quote?.price;
  if (!finite(price) || price <= 0) return NONE;
  const digits = price < 1 ? 4 : 2;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

// Halves round away from zero both ways, so -5.25 shows as -5.3% like +5.25 shows +5.3%.
const tenths = (pct: number) => (Math.sign(pct) * Math.round(Math.abs(pct) * 10)) / 10 || 0;

/** "+123.4%", "-5.2%", "0.0%"; "—" without a change. */
export function changeLabel(quote: GainersQuote | null | undefined) {
  const pct = quote?.changePct;
  if (!finite(pct)) return NONE;
  const rounded = tenths(pct);
  if (rounded === 0) return "0.0%";
  const text = Math.abs(rounded).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${rounded > 0 ? "+" : "-"}${text}%`;
}

/** "up" or "down" for the colour of the % today; null when flat or unknown. */
export function changeTone(quote: GainersQuote | null | undefined): "up" | "down" | null {
  const pct = quote?.changePct;
  if (!finite(pct)) return null;
  const rounded = tenths(pct);
  return rounded > 0 ? "up" : rounded < 0 ? "down" : null;
}

const VOLUME_UNITS: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"], [1, ""]];

/** "12.3M", "850K", "1.2B", "940"; "—" without a volume. */
export function volumeLabel(quote: GainersQuote | null | undefined) {
  const volume = quote?.volume;
  if (!finite(volume) || volume < 0) return NONE;
  return shortCount(volume);
}

/** "12.3M", "850K", "1.2B", "940": a share count, short (#376: also IB's shares to lend). */
export function shortCount(count: number) {
  const short = (scaled: number) => (scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10);
  const found = VOLUME_UNITS.findIndex(([size]) => count >= size);
  const i = found === -1 ? VOLUME_UNITS.length - 1 : found;
  const [size, unit] = VOLUME_UNITS[i];
  const scaled = unit ? short(count / size) : Math.round(count);
  // 999,960 would round to "1000K": show "1M" instead.
  if (scaled >= 1000 && i > 0) return `1${VOLUME_UNITS[i - 1][1]}`;
  return `${scaled}${unit}`;
}
