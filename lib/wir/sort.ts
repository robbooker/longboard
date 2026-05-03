import type { GapEvent, WIRSortKey, SortDir } from "./types";

/**
 * Pure helpers for the WIR watchlist UI. No DOM, no fetch — every function
 * here is deterministic and unit-testable from vitest.
 */

/** Tab metadata: one per unique gap_date in the dataset, plus an "All" tab. */
export type DayTab = {
  /** "all" sentinel or YYYY-MM-DD */
  key: "all" | string;
  /** Short label, e.g. "Mon Apr 27" or "All" */
  label: string;
  /** Number of events on that day (or total for "all") */
  count: number;
};

/**
 * Group events into day tabs, ordered chronologically. Always prepends an
 * "All" tab as the default selection.
 */
export function buildDayTabs(events: GapEvent[]): DayTab[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.gap_date, (counts.get(e.gap_date) ?? 0) + 1);
  }
  const days = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map<DayTab>(([date, count]) => ({
      key: date,
      label: dayTabLabel(date),
      count,
    }));
  return [{ key: "all", label: "All", count: events.length }, ...days];
}

/** "2026-04-27" -> "Mon Apr 27". ET-implicit (we treat gap_date as already ET). */
export function dayTabLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Build a UTC Date and read its UTC weekday so we don't drift by tz.
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${wk} ${months[m - 1]} ${d}`;
}

/** Filter events to a specific day, or pass through for "all". */
export function filterByDay(
  events: GapEvent[],
  dayKey: "all" | string
): GapEvent[] {
  if (dayKey === "all") return events;
  return events.filter((e) => e.gap_date === dayKey);
}

/**
 * Sort events by the chosen column. Returns a new array; never mutates input.
 *
 * Missing values (long_score on older shards) sort last regardless of dir.
 */
export function sortEvents(
  events: GapEvent[],
  key: WIRSortKey,
  dir: SortDir
): GapEvent[] {
  const mul = dir === "asc" ? 1 : -1;
  const out = [...events];
  out.sort((a, b) => {
    const av = extract(a, key);
    const bv = extract(b, key);
    // Strings (symbol) — straight locale compare.
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * mul;
    }
    // Numerics — push undefined to the bottom regardless of direction.
    const an = av as number | undefined;
    const bn = bv as number | undefined;
    if (an == null && bn == null) return 0;
    if (an == null) return 1;
    if (bn == null) return -1;
    return (an - bn) * mul;
  });
  return out;
}

function extract(e: GapEvent, key: WIRSortKey): string | number | undefined {
  switch (key) {
    case "symbol":
      return e.ticker;
    case "gap_pct":
      return e.gap_pct;
    case "volume":
      return e.volume;
    case "long_score":
      return e.long_score;
  }
}

/** Default sort that lands on the most actionable row at the top. */
export const DEFAULT_SORT: { key: WIRSortKey; dir: SortDir } = {
  key: "long_score",
  dir: "desc",
};

/** Toggle helper for column-header clicks. */
export function nextSort(
  current: { key: WIRSortKey; dir: SortDir },
  clicked: WIRSortKey
): { key: WIRSortKey; dir: SortDir } {
  if (current.key !== clicked) {
    // First click on a new column: default direction is desc for numerics,
    // asc for symbol (alphabetical reads naturally).
    return { key: clicked, dir: clicked === "symbol" ? "asc" : "desc" };
  }
  return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
}

/** Pretty-printers used by the watchlist row. */
export function formatGapPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function formatVolume(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

export function formatLongScore(n: number | undefined): string {
  if (n == null) return "—";
  return n.toFixed(1);
}
