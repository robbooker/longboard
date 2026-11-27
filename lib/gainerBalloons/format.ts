// #528 Gainer Balloons: how numbers read in the details, the list and the labels. A dash when missing.

export const DASH = "—";

export function formatCompactNumber(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return DASH;
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 10_000) return `${(val / 1_000).toFixed(1)}K`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  return Math.round(val).toLocaleString("en-US");
}

export function formatPrice(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return DASH;
  return val >= 1 ? `$${val.toFixed(2)}` : `$${val.toFixed(4)}`;
}

export function formatPct(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return DASH;
  return `${val > 0 ? "+" : ""}${val.toFixed(1)}%`;
}

/**
 * #533: the market cap at the time shown: the price on the card times the shares outstanding. Null
 * without both, so the card shows a dash.
 */
export function marketCapAt(price: number | null | undefined, sharesOutstanding: number | null | undefined): number | null {
  if (price == null || sharesOutstanding == null || !(price > 0) || !(sharesOutstanding > 0)) return null;
  const cap = price * sharesOutstanding;
  return Number.isFinite(cap) ? cap : null;
}

const CAP_UNITS: Array<[number, string]> = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];

/** "$1.3B", "$48.2M", "$940.0K"; a dash when the market cap isn't known. */
export function formatMarketCap(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val) || !(val > 0)) return DASH;
  for (let i = 0; i < CAP_UNITS.length; i++) {
    const [size, unit] = CAP_UNITS[i];
    // 999,960,000 would read "$1000.0M": the next unit up takes it ("$1.0B").
    if (val >= size) return `$${(val / size).toFixed(1)}${unit}`;
    const below = CAP_UNITS[i + 1];
    if (below && val < size && val / below[0] >= 999.95) return `$1.0${unit}`;
  }
  return `$${Math.round(val).toLocaleString("en-US")}`;
}

/** #533: institutional ownership: "12.4%", "0%"; a dash when it was never looked up. */
export function formatInstOwn(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val) || val < 0) return DASH;
  return `${Number(val.toFixed(1))}%`;
}

export function formatRatio(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return DASH;
  return val >= 10 ? `${val.toFixed(1)}×` : `${val.toFixed(2)}×`;
}

/** "Wed, Nov 25" from "2026-11-25" (a calendar day, so no time zone is involved). */
export function formatMarketDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export const SESSION_LABELS = { pre: "Pre-market", regular: "Regular hours", after: "After hours" } as const;
