/**
 * Types for the Week-in-Review gap event dataset.
 *
 * Source: ~/Downloads/autotrade-full/data_week_apr27/gap_events_week.json
 * (94 events after universe filter; 5 sessions Apr 27 - May 1 2026)
 *
 * Base schema from gap_events_{nov,dec,jan,april}.json + 3 additive fields
 * from weekly_data_pull.py (pattern + long_score + hod_close_pct, per Codex
 * merge). We accept extra fields permissively so the JSON can grow without
 * breaking the watchlist.
 */
export type GapEvent = {
  // Base fields (canonical schema, all required)
  ticker: string;
  gap_date: string; // ET date, YYYY-MM-DD
  prev_date: string; // ET date, YYYY-MM-DD
  gap_pct: number; // open vs prev close, signed %
  ah_price: number;
  price_830am: number;
  rough_gap_pct: number;
  volume: number; // total day volume (RTH + extended)

  // Additive fields from the weekly Codex merge (may be missing on older
  // gap_events_*.json shards — handle as optional).
  pattern?: string; // "Gap-and-go" | "Reclaim" | "Long trap" | ...
  long_score?: number; // 0-100 composite
  rs_close_pct?: number; // signed % open->RS close, optional helper

  // Permissive bag so /api shape evolution doesn't break us.
  [extra: string]: unknown;
};

export type WIRWeek = {
  /** ISO week start (Mon), e.g. "2026-04-27" */
  week_start: string;
  /** ISO week end (Fri), e.g. "2026-05-01" */
  week_end: string;
  /** Human label, e.g. "Apr 27 - May 1, 2026" */
  label: string;
  events: GapEvent[];
};

/** Sortable columns in the watchlist UI. */
export type WIRSortKey = "symbol" | "gap_pct" | "volume" | "long_score";
export type SortDir = "asc" | "desc";
