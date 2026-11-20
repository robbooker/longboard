import { describe, expect, it } from "vitest";
import {
  SIX_COLUMN_MIN_PX,
  isEvenSixWidths,
  isSixWidthsShape,
  moveSixEdge,
  parseSixWidths,
  resetSixCard,
  sixCardToReset,
  sixEdgeRange,
  sixRowFromPixels,
  sixRowTemplate,
  sixRowWidths,
  withSixRow,
} from "../chatSixWidths";

const third = 0.3333;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("#470/#474 Six view card widths", () => {
  it("reads six shares (two rows of three), each row scaled to add up to one and rounded", () => {
    expect(parseSixWidths([0.5, 0.25, 0.25, third, third, third])).toEqual([0.5, 0.25, 0.25, third, third, third]);
    expect(parseSixWidths([2, 1, 1, 1, 1, 2])).toEqual([0.5, 0.25, 0.25, 0.25, 0.25, 0.5]);
    expect(parseSixWidths([0.123456, 0.3, 0.576544, 1, 1, 1])).toEqual([0.1235, 0.3, 0.5765, third, third, third]);
  });
  it("reads an old #470 save (three column shares) as the same shares for both rows", () => {
    expect(parseSixWidths([0.5, 0.25, 0.25])).toEqual([0.5, 0.25, 0.25, 0.5, 0.25, 0.25]);
    expect(parseSixWidths([2, 1, 1])).toEqual([0.5, 0.25, 0.25, 0.5, 0.25, 0.25]);
  });
  it("treats even and anything malformed as no widths", () => {
    for (const value of [
      null,
      undefined,
      "0.5,0.25,0.25",
      [],
      [0.5, 0.5],
      [0.25, 0.25, 0.25, 0.25],
      [0.5, 0.25, 0.25, 0.5, 0.5],
      [0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 0.5],
      [0.5, "0.25", 0.25],
      [0.5, 0.25, 0.25, 0.5, Number.NaN, 0.5],
      [1, 0, 0],
      [-1, 1, 1],
      [0.96, 0.02, 0.02], // a card under 5%
      [0.5, 0.25, 0.25, 0.96, 0.02, 0.02], // one bad row spoils the lot
      [1, 1, 1],
      [1, 1, 1, 2, 2, 2],
      [1 / 3, 1 / 3, 1 / 3],
      { 0: 0.5, 1: 0.25, 2: 0.25 },
    ])
      expect(parseSixWidths(value)).toBeNull();
  });
  it("accepts null (reset), six numbers or three (a #470 page) from a browser, nothing else", () => {
    expect(isSixWidthsShape(null)).toBe(true);
    expect(isSixWidthsShape([0.5, 0.25, 0.25])).toBe(true);
    expect(isSixWidthsShape([0.5, 0.25, 0.25, 0.3, 0.3, 0.4])).toBe(true);
    for (const value of [
      undefined,
      "x",
      [0.5, 0.5],
      [0.5, "a", 0.5],
      [0.5, Infinity, 0.5],
      [1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      { widths: [] },
    ])
      expect(isSixWidthsShape(value)).toBe(false);
  });
  it("knows when every card is even", () => {
    expect(isEvenSixWidths(null)).toBe(true);
    expect(isEvenSixWidths([third, third, 0.3334, third, third, 0.3334])).toBe(true);
    expect(isEvenSixWidths([third, third, 0.3334, 0.4, 0.3, 0.3])).toBe(false);
  });
  it("splits the widths into rows, and replaces one row leaving the other alone", () => {
    expect(sixRowWidths(null, 0)).toEqual([third, third, third]);
    const widths = [0.5, 0.25, 0.25, 0.2, 0.4, 0.4];
    expect(sixRowWidths(widths, 0)).toEqual([0.5, 0.25, 0.25]);
    expect(sixRowWidths(widths, 1)).toEqual([0.2, 0.4, 0.4]);
    expect(withSixRow(null, 1, [0.4, 0.3, 0.3])).toEqual([third, third, third, 0.4, 0.3, 0.3]);
    expect(withSixRow(widths, 0, [0.3, 0.3, 0.4])).toEqual([0.3, 0.3, 0.4, 0.2, 0.4, 0.4]);
    expect(withSixRow([0.5, 0.25, 0.25, third, third, third], 0, [third, third, third])).toBeNull();
  });
  it("draws each card in a row with the minimum, and the edge tracks between them", () => {
    expect(sixRowTemplate(null)).toBe("minmax(320px, 33.33fr) 8px minmax(320px, 33.33fr) 8px minmax(320px, 33.33fr)");
    expect(sixRowTemplate([0.5, 0.25, 0.25])).toBe(
      "minmax(320px, 50.00fr) 8px minmax(320px, 25.00fr) 8px minmax(320px, 25.00fr)",
    );
  });
  it("moves an edge with the pointer: the next card shrinks, then the one after it once the next is at the minimum", () => {
    expect(moveSixEdge([500, 500, 500], 0, 100)).toEqual([600, 400, 500]);
    expect(moveSixEdge([500, 500, 500], 1, -100)).toEqual([500, 400, 600]);
    expect(moveSixEdge([500, 500, 500], 0, 200)).toEqual([700, SIX_COLUMN_MIN_PX, 480]);
    expect(moveSixEdge([500, 500, 500], 1, -200)).toEqual([480, SIX_COLUMN_MIN_PX, 700]);
    // As far as it goes: every other card at the minimum, nothing off the screen.
    expect(moveSixEdge([500, 500, 500], 0, 5000)).toEqual([860, SIX_COLUMN_MIN_PX, SIX_COLUMN_MIN_PX]);
    expect(moveSixEdge([500, 500, 500], 0, -1000)).toEqual([SIX_COLUMN_MIN_PX, 680, 500]);
    expect(moveSixEdge([500, 500, 500], 1, 1000)).toEqual([500, 680, SIX_COLUMN_MIN_PX]);
    for (const [edge, delta] of [
      [0, 777],
      [1, -999],
      [0, -3],
    ])
      expect(sum(moveSixEdge([400, 700, 400], edge, delta))).toBe(1500);
    // Too narrow for the minimums: the row stays as it is rather than overflowing.
    expect(moveSixEdge([300, 300, 300], 0, 50)).toEqual([300, 300, 300]);
    // An edge that doesn't exist changes nothing.
    expect(moveSixEdge([500, 500, 500], 2, 50)).toEqual([500, 500, 500]);
  });
  it("picks the card beside a double-clicked edge to put back: the wider one, else the one furthest out", () => {
    expect(sixCardToReset([650, 350, 500], 0)).toBe(0); // card 1 was widened
    expect(sixCardToReset([350, 650, 500], 0)).toBe(1); // card 2 was widened leftwards
    expect(sixCardToReset([500, 600, 400], 1)).toBe(1);
    expect(sixCardToReset([400, 500, 600], 1)).toBe(2); // card 3 was widened
    expect(sixCardToReset([500, 400, 600], 0)).toBe(1); // card 2 squeezed by card 3: card 2 goes back
    expect(sixCardToReset([500, 500, 500], 0)).toBeNull();
  });
  it("puts a card back to normal and re-balances the row, keeping another card's own width", () => {
    // Card 1 widened: back to a third, card 2 gets its room back.
    expect(resetSixCard([650, 350, 500], 0, 0)).toEqual([500, 500, 500]);
    // Card 3 was widened (card 2 gave), then card 1 (card 2 gave again): resetting card 1 keeps card 3 wide.
    expect(resetSixCard([580, 320, 600], 0, 0)).toEqual([500, 400, 600]);
    // Card 2 squeezed by card 3: card 2 goes back, the room comes from card 3, the wider one, not card 1.
    expect(resetSixCard([500, 400, 600], 1, 0)).toEqual([500, 500, 500]);
    // Card 1 pushed the others to the minimum: both get room back.
    expect(resetSixCard([860, 320, 320], 0, 0)).toEqual([500, 500, 500]);
    // A narrow card goes back by taking from its neighbours, none under the minimum.
    expect(resetSixCard([330, 800, 370], 0, 0)).toEqual([500, 630, 370]);
    for (const [row, card, edge] of [
      [[700, 320, 480], 0, 0],
      [[340, 340, 820], 2, 1],
      [[340, 820, 340], 1, 0],
    ] as const)
      expect(sum(resetSixCard([...row], card, edge))).toBeCloseTo(1500, 6);
  });
  it("turns drawn pixels into a row's shares", () => {
    expect(sixRowFromPixels([800, 400, 400])).toEqual([0.5, 0.25, 0.25]);
    expect(sixRowFromPixels([500, 500, 500])).toEqual([third, third, third]);
    expect(sixRowFromPixels([0, 0, 0])).toEqual([third, third, third]);
  });
  it("announces where an edge is and how far it can go, as shares of the row", () => {
    expect(sixEdgeRange([500, 500, 500], 0)).toEqual({ now: 33, min: 21, max: 57 });
    expect(sixEdgeRange([500, 500, 500], 1)).toEqual({ now: 67, min: 43, max: 79 });
  });
});
