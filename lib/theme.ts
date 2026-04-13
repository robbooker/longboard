/* ── Shared design tokens ──────────────────────────────
   Colors resolve to CSS vars defined in app/globals.css so the whole
   dashboard surface tracks the light/dark toggle. Brand colors
   (TradeZero blue/gold, live-account red) stay hardcoded. */

export const green = "var(--accent)";
export const red = "var(--danger)";
export const dim = "var(--text-secondary)";
export const text = "var(--text-primary)";
export const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

/* ── Alpaca page tokens ────────────────────────────── */

export const alpacaTheme = {
  bg: "var(--bg)",
  card: "var(--surface)",
  border: "var(--border)",
} as const;

/* ── TradeZero page tokens ─────────────────────────── */

export const tradezeroTheme = {
  TZ_BLUE: "#00a3ff",
  TZ_GOLD: "#d4af37",
  amber: "var(--warning)",
  bg: "var(--bg)",
  card: "var(--surface)",
  cardHi: "var(--surface)",
  border: "var(--border)",
} as const;
