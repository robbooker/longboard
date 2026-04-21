/* ── Shared design tokens ──────────────────────────────
   Colors and font families resolve to CSS vars defined in
   app/globals.css so the whole dashboard surface tracks the
   active theme (light / dark / statement). Brand colors
   (TradeZero blue/gold, live-account red) stay hardcoded. */

export const green = "var(--accent)";
export const red = "var(--danger)";
export const dim = "var(--text-secondary)";
export const text = "var(--text-primary)";

/** Default family for the page body — labels, inputs, buttons,
 *  timestamps, badges. Resolves to mono in all three themes
 *  (Statement keeps labels mono, only numbers go serif). */
export const font = "var(--font-labels)";

/** Family for consequential numbers — dollar amounts, P&L,
 *  equity, percentages, share quantities. Mono in Light + Dark;
 *  serif in Statement. Rule of thumb: if it'd appear on a
 *  printed brokerage statement, use this. */
export const fontNumbers = "var(--font-numbers)";

/** Inline style helper for any cell that renders a consequential
 *  number. Adds tabular-nums so column widths don't jitter across
 *  theme flips (Georgia's proportional numerals would otherwise
 *  break column alignment on the positions table). */
export const money = {
  fontFamily: fontNumbers,
  fontVariantNumeric: "tabular-nums",
} as const;

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
  // `cardHi` is the inset-card background — used on table header
  // rows, halt-ticker label strip, and Quick Order inputs. One
  // step "back" from `card` so nested rows read as recessed.
  cardHi: "var(--surface-hi)",
  border: "var(--border)",
} as const;
