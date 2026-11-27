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
