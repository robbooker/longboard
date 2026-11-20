// #470 Six view column widths. On a computer (1100px and wider) Six is three columns across, two
// cards each; a member can drag the edge between two columns to widen one and narrow the other.
// The widths are kept as fractions of the three columns (they add up to 1), so they fit any screen,
// saved to the member's account with their card layout (/api/chat/card-layout, column `widths`) and
// copied in this browser. Null means the standard even layout. Narrower windows and phones never
// use them. Pure maths here, no React, so the route and the page share the same rules.

export const SIX_COLUMNS = 3;
/** No column is ever drawn narrower than this: chat text and the Gainers Table's first columns stay readable. */
export const SIX_COLUMN_MIN_PX = 320;
/** Arrow keys move an edge this far; Shift+arrow four times as far. */
export const SIX_KEY_STEP_PX = 24;
export const SIX_KEY_STEP_LARGE_PX = 96;
/** The fractions a saved layout may hold. Real minimums are in pixels and applied when drawing. */
const MIN_FRACTION = 0.05;
const MAX_FRACTION = 0.9;

/** Three fractions adding up to 1, or null for even. */
export type SixWidths = number[];

export const sixWidthsStorageKey = (accountId: string | undefined) => `rb-chat-six-widths-v1:${accountId}`;

const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * A saved or submitted value as widths: three finite numbers each within 5%–90% once scaled to add
 * up to 1. Anything else (including "even") is null. Rounded to 4 places, so the result is stable.
 */
export function parseSixWidths(value: unknown): SixWidths | null {
  if (!Array.isArray(value) || value.length !== SIX_COLUMNS) return null;
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) return null;
  const total = (value as number[]).reduce((sum, v) => sum + v, 0);
  const widths = (value as number[]).map((v) => v / total);
  if (widths.some((v) => v < MIN_FRACTION || v > MAX_FRACTION)) return null;
  return isEvenSixWidths(widths) ? null : widths.map(round);
}

/** Strict shape check for what a browser sends: null (reset) or a list of three numbers. */
export function isSixWidthsShape(value: unknown): value is SixWidths | null {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.length === SIX_COLUMNS &&
      value.every((v) => typeof v === "number" && Number.isFinite(v)))
  );
}

/** Even, to within a tenth of a percent. */
export function isEvenSixWidths(widths: SixWidths | null): boolean {
  return !widths || widths.every((v) => Math.abs(v - 1 / SIX_COLUMNS) < 0.001);
}

/**
 * The grid's columns: a card column, the 8px track the edge sits in, a card column, and so on. Each
 * card column takes its share of the space but never less than the minimum.
 */
export function sixColumnsTemplate(widths: SixWidths | null): string {
  const shares = widths ?? Array(SIX_COLUMNS).fill(1 / SIX_COLUMNS);
  return shares.map((share) => `minmax(${SIX_COLUMN_MIN_PX}px, ${(share * 100).toFixed(2)}fr)`).join(" 8px ");
}

/**
 * Moves the edge after column `edge` (0 or 1) by `delta` pixels, given the columns as drawn now in
 * pixels. Only the two columns beside the edge change; each stops at the minimum. Returns the new
 * pixel widths.
 */
export function moveSixEdge(drawn: number[], edge: number, delta: number, min = SIX_COLUMN_MIN_PX): number[] {
  const left = drawn[edge],
    right = drawn[edge + 1];
  if (left === undefined || right === undefined) return drawn;
  const pair = left + right;
  // If the window is too narrow for both minimums, split what there is evenly.
  const floor = Math.min(min, pair / 2);
  const nextLeft = Math.min(pair - floor, Math.max(floor, left + delta));
  return drawn.map((width, i) => (i === edge ? nextLeft : i === edge + 1 ? pair - nextLeft : width));
}

/** Pixel widths as fractions of their total (null when they're even). */
export function sixWidthsFromPixels(pixels: number[]): SixWidths | null {
  const total = pixels.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return null;
  const widths = pixels.map((v) => round(v / total));
  return isEvenSixWidths(widths) ? null : widths;
}

/** The range an edge can move in, as the left column's share of the three (whole percent), for screen readers. */
export function sixEdgeRange(drawn: number[], edge: number, min = SIX_COLUMN_MIN_PX) {
  const total = drawn.reduce((sum, v) => sum + v, 0);
  const before = drawn.slice(0, edge).reduce((sum, v) => sum + v, 0);
  const pct = (v: number) => (total > 0 ? Math.round(((before + v) / total) * 100) : 0);
  const pair = (drawn[edge] ?? 0) + (drawn[edge + 1] ?? 0);
  const floor = Math.min(min, pair / 2);
  return { now: pct(drawn[edge] ?? 0), min: pct(floor), max: pct(pair - floor) };
}
