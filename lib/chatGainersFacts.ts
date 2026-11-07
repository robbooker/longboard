// #371 Gainers Table: the company facts behind each row (country, cash left, institutional
// ownership), how a lookup's result is checked on the way in, which tickers still need a lookup,
// and how the table shows them. The lookup program on Rob's computer (scripts/gainers-lookup/)
// reads DilutionTracker and posts here; the table shows every value as React text.

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
};

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
