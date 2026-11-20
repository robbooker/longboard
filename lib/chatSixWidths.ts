// Six view card widths. On a computer (1100px and wider) Six is three cards across and two rows; a
// member can drag the edge between two cards in a row to widen one card and narrow its neighbours.
// #470 did this for whole columns (both rows moved together); #474 makes it per card: each row has
// its own edges and its own widths, so the card above or below never changes.
//
// Saved as six shares: row 1's three cards, then row 2's three, each row adding up to 1, so they fit
// any screen. They live with the card layout on the member's account (/api/chat/card-layout, column
// `widths`) and are copied in this browser. Null means the standard even layout. A #470 save (three
// shares, one per column) is read as the same three shares for both rows, so nobody loses theirs.
// Narrower windows and phones never use them. Pure maths here, no React, so the route and the page
// share the same rules.

export const SIX_COLUMNS = 3;
export const SIX_ROWS = 2;
/** No card is ever drawn narrower than this: chat text and the Gainers Table's first columns stay readable. */
export const SIX_COLUMN_MIN_PX = 320;
/** Arrow keys move an edge this far; Shift+arrow four times as far. */
export const SIX_KEY_STEP_PX = 24;
export const SIX_KEY_STEP_LARGE_PX = 96;
/** The shares a saved layout may hold. Real minimums are in pixels and applied when drawing. */
const MIN_FRACTION = 0.05;
const MAX_FRACTION = 0.9;

/** Six shares (row 1's three cards, then row 2's), each row adding up to 1; null for even. */
export type SixWidths = number[];
/** One row's three shares, adding up to 1. */
export type SixRowWidths = number[];

export const sixWidthsStorageKey = (accountId: string | undefined) => `rb-chat-six-widths-v1:${accountId}`;

const round = (value: number) => Math.round(value * 10000) / 10000;
const EVEN_ROW: SixRowWidths = Array(SIX_COLUMNS).fill(round(1 / SIX_COLUMNS));

/** One row's numbers scaled to add up to 1, or null when one is missing, not positive or out of range. */
function parseRow(value: unknown[]): SixRowWidths | null {
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) return null;
  const total = (value as number[]).reduce((sum, v) => sum + v, 0);
  const shares = (value as number[]).map((v) => v / total);
  if (shares.some((v) => v < MIN_FRACTION || v > MAX_FRACTION)) return null;
  return shares.map(round);
}

/**
 * A saved or submitted value as widths: six numbers (two rows of three), or three (a #470 save: the
 * same for both rows). Each row is scaled to add up to 1 and each card must be within 5%–90% of its
 * row. Anything else, or even everywhere, is null. Rounded to 4 places, so the result is stable.
 */
export function parseSixWidths(value: unknown): SixWidths | null {
  if (!Array.isArray(value)) return null;
  let rows: unknown[][];
  if (value.length === SIX_COLUMNS) rows = [value, value];
  else if (value.length === SIX_COLUMNS * SIX_ROWS)
    rows = [value.slice(0, SIX_COLUMNS), value.slice(SIX_COLUMNS)];
  else return null;
  const parsed = rows.map(parseRow);
  if (parsed.some((row) => !row)) return null;
  const widths = (parsed as SixRowWidths[]).flat();
  return isEvenSixWidths(widths) ? null : widths;
}

/** Strict shape check for what a browser sends: null (reset) or a list of six numbers (or three, from a #470 page). */
export function isSixWidthsShape(value: unknown): value is SixWidths | null {
  return (
    value === null ||
    (Array.isArray(value) &&
      (value.length === SIX_COLUMNS || value.length === SIX_COLUMNS * SIX_ROWS) &&
      value.every((v) => typeof v === "number" && Number.isFinite(v)))
  );
}

/** Even, to within a tenth of a percent (every card, both rows). */
export function isEvenSixWidths(widths: SixWidths | null): boolean {
  return !widths || widths.every((v) => Math.abs(v - 1 / SIX_COLUMNS) < 0.001);
}

/** One row's shares (0: top, 1: bottom); even when there are no widths. */
export function sixRowWidths(widths: SixWidths | null, row: number): SixRowWidths {
  const shares = widths?.slice(row * SIX_COLUMNS, (row + 1) * SIX_COLUMNS);
  return shares?.length === SIX_COLUMNS ? shares : EVEN_ROW;
}

/** The widths with one row replaced; null when that leaves every card even. */
export function withSixRow(widths: SixWidths | null, row: number, shares: SixRowWidths): SixWidths | null {
  const next = Array.from({ length: SIX_ROWS }, (_, r) =>
    r === row ? shares.map(round) : sixRowWidths(widths, r),
  ).flat();
  return isEvenSixWidths(next) ? null : next;
}

/**
 * A row's columns: a card, the 8px track the edge sits in, a card, and so on. Each card takes its
 * share of the space but never less than the minimum.
 */
export function sixRowTemplate(shares: SixRowWidths | null): string {
  return (shares ?? EVEN_ROW)
    .map((share) => `minmax(${SIX_COLUMN_MIN_PX}px, ${(share * 100).toFixed(2)}fr)`)
    .join(" 8px ");
}

/** The smallest a card may be in a row this wide: the minimum, or an even split if the row is too narrow for that. */
const floorFor = (drawn: number[], min: number) =>
  Math.min(min, drawn.reduce((sum, v) => sum + v, 0) / drawn.length);

/**
 * Takes up to `amount` pixels from the cards in `order` (first the nearest), leaving each at least
 * `floor`. Changes `widths`; returns how much it took.
 */
function take(widths: number[], order: number[], amount: number, floor: number) {
  let left = amount;
  for (const i of order) {
    const part = Math.min(left, Math.max(0, widths[i] - floor));
    widths[i] -= part;
    left -= part;
  }
  return amount - left;
}

/**
 * Moves the edge after card `edge` (0 or 1) of a row by `delta` pixels, given the row's cards as drawn
 * now in pixels. The edge follows the pointer: the card on one side grows, the card on the other
 * shrinks, and once that card is at the minimum the next one along shrinks too. Cards in the other
 * row are never involved. Returns the row's new pixel widths.
 */
export function moveSixEdge(drawn: number[], edge: number, delta: number, min = SIX_COLUMN_MIN_PX): number[] {
  if (edge < 0 || edge >= drawn.length - 1 || !delta) return drawn;
  const next = [...drawn],
    floor = floorFor(drawn, min);
  const right = Array.from({ length: drawn.length - edge - 1 }, (_, i) => edge + 1 + i);
  const left = Array.from({ length: edge + 1 }, (_, i) => edge - i);
  if (delta > 0) next[edge] += take(next, right, delta, floor);
  else next[edge + 1] += take(next, left, -delta, floor);
  return next;
}

/**
 * Double-clicking an edge puts a card beside it back to its normal width (a third of the row). Which
 * one: the card that is wider than normal (the wider, if both are); if neither is, the one further
 * from normal. Null when both are already normal (to within a pixel).
 */
export function sixCardToReset(drawn: number[], edge: number): number | null {
  const normal = drawn.reduce((sum, v) => sum + v, 0) / drawn.length;
  const a = (drawn[edge] ?? normal) - normal,
    b = (drawn[edge + 1] ?? normal) - normal;
  if (Math.max(a, b) > 1) return a >= b ? edge : edge + 1;
  if (Math.abs(a) <= 1 && Math.abs(b) <= 1) return null;
  return Math.abs(a) >= Math.abs(b) ? edge : edge + 1;
}

/**
 * Puts card `card` of a row back to its normal width; the others in the row re-balance. Room it gives
 * back goes first to cards narrower than normal, then to the card across the edge (`edge`); room it
 * needs comes first from cards wider than normal, then from the others, nearest first, none going
 * under the minimum. Returns the row's new pixel widths.
 */
export function resetSixCard(drawn: number[], card: number, edge: number, min = SIX_COLUMN_MIN_PX): number[] {
  if (card < 0 || card >= drawn.length) return drawn;
  const next = [...drawn],
    normal = drawn.reduce((sum, v) => sum + v, 0) / drawn.length,
    floor = floorFor(drawn, min);
  // The others, across the edge first and then outwards on each side.
  const across = card === edge ? 1 : -1;
  const order = Array.from({ length: drawn.length }, (_, i) => i)
    .filter((i) => i !== card)
    .sort((i, j) => {
      const side = (k: number) => (Math.sign(k - card) === across ? 0 : 1);
      return side(i) - side(j) || Math.abs(i - card) - Math.abs(j - card);
    });
  const change = normal - next[card];
  if (change < 0) {
    let spare = -change;
    for (const i of order) {
      const part = Math.min(spare, Math.max(0, normal - next[i]));
      next[i] += part;
      spare -= part;
    }
    next[order[0]] += spare;
    next[card] = normal;
  } else if (change > 0) {
    // Cards wider than normal give back down to normal first, then any card down to the minimum.
    let got = 0;
    for (const i of order) {
      const part = Math.min(change - got, Math.max(0, next[i] - Math.max(normal, floor)));
      next[i] -= part;
      got += part;
    }
    got += take(next, order, change - got, floor);
    next[card] += got;
  }
  return next;
}

/** Pixel widths as shares of their row, rounded (always three, even ones included). */
export function sixRowFromPixels(pixels: number[]): SixRowWidths {
  const total = pixels.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return EVEN_ROW;
  return pixels.map((v) => round(v / total));
}

/** The range an edge can move in, as the left card's end as a share of the row (whole percent), for screen readers. */
export function sixEdgeRange(drawn: number[], edge: number, min = SIX_COLUMN_MIN_PX) {
  const total = drawn.reduce((sum, v) => sum + v, 0);
  const before = drawn.slice(0, edge).reduce((sum, v) => sum + v, 0);
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const floor = floorFor(drawn, min);
  return {
    now: pct(before + (drawn[edge] ?? 0)),
    min: pct((edge + 1) * floor),
    max: pct(total - (drawn.length - edge - 1) * floor),
  };
}
