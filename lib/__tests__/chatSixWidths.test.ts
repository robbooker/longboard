import { describe, expect, it } from "vitest";
import {
  SIX_COLUMN_MIN_PX,
  isEvenSixWidths,
  isSixWidthsShape,
  moveSixEdge,
  parseSixWidths,
  sixColumnsTemplate,
  sixEdgeRange,
  sixWidthsFromPixels,
} from "../chatSixWidths";

describe("#470 Six view column widths", () => {
  it("reads three shares, scaled to add up to one and rounded", () => {
    expect(parseSixWidths([0.5, 0.25, 0.25])).toEqual([0.5, 0.25, 0.25]);
    expect(parseSixWidths([2, 1, 1])).toEqual([0.5, 0.25, 0.25]);
    expect(parseSixWidths([0.123456, 0.3, 0.576544])).toEqual([0.1235, 0.3, 0.5765]);
  });
  it("treats even and anything malformed as no widths", () => {
    for (const value of [
      null,
      undefined,
      "0.5,0.25,0.25",
      [],
      [0.5, 0.5],
      [0.25, 0.25, 0.25, 0.25],
      [0.5, "0.25", 0.25],
      [0.5, Number.NaN, 0.5],
      [1, 0, 0],
      [-1, 1, 1],
      [0.96, 0.02, 0.02], // a column under 5%
      [1, 1, 1],
      [1 / 3, 1 / 3, 1 / 3],
      { 0: 0.5, 1: 0.25, 2: 0.25 },
    ])
      expect(parseSixWidths(value)).toBeNull();
  });
  it("accepts null (reset) or three numbers from a browser, nothing else", () => {
    expect(isSixWidthsShape(null)).toBe(true);
    expect(isSixWidthsShape([0.5, 0.25, 0.25])).toBe(true);
    for (const value of [undefined, "x", [0.5, 0.5], [0.5, "a", 0.5], [0.5, Infinity, 0.5], { widths: [] }])
      expect(isSixWidthsShape(value)).toBe(false);
  });
  it("knows when columns are even", () => {
    expect(isEvenSixWidths(null)).toBe(true);
    expect(isEvenSixWidths([0.3333, 0.3333, 0.3334])).toBe(true);
    expect(isEvenSixWidths([0.4, 0.3, 0.3])).toBe(false);
  });
  it("draws each card column with the minimum, and the edge tracks between them", () => {
    expect(sixColumnsTemplate(null)).toBe(
      "minmax(320px, 33.33fr) 8px minmax(320px, 33.33fr) 8px minmax(320px, 33.33fr)",
    );
    expect(sixColumnsTemplate([0.5, 0.25, 0.25])).toBe(
      "minmax(320px, 50.00fr) 8px minmax(320px, 25.00fr) 8px minmax(320px, 25.00fr)",
    );
  });
  it("moves only the two columns beside the edge, and stops each at the minimum", () => {
    expect(moveSixEdge([500, 500, 500], 0, 200)).toEqual([680, 320, 500]);
    expect(moveSixEdge([500, 500, 500], 0, 100)).toEqual([600, 400, 500]);
    expect(moveSixEdge([500, 500, 500], 1, -100)).toEqual([500, 400, 600]);
    expect(moveSixEdge([500, 500, 500], 0, -1000)).toEqual([SIX_COLUMN_MIN_PX, 680, 500]);
    expect(moveSixEdge([500, 500, 500], 1, 1000)).toEqual([500, 680, SIX_COLUMN_MIN_PX]);
    // Too narrow for two minimums: the pair is split evenly rather than overflowing.
    expect(moveSixEdge([300, 300, 300], 0, 50)).toEqual([300, 300, 300]);
    // An edge that doesn't exist changes nothing.
    expect(moveSixEdge([500, 500, 500], 2, 50)).toEqual([500, 500, 500]);
  });
  it("turns drawn pixels into shares, and even pixels into no widths", () => {
    expect(sixWidthsFromPixels([800, 400, 400])).toEqual([0.5, 0.25, 0.25]);
    expect(sixWidthsFromPixels([500, 500, 500])).toBeNull();
    expect(sixWidthsFromPixels([0, 0, 0])).toBeNull();
  });
  it("announces where an edge is and how far it can go, as shares of the three", () => {
    expect(sixEdgeRange([500, 500, 500], 0)).toEqual({ now: 33, min: 21, max: 45 });
    expect(sixEdgeRange([500, 500, 500], 1)).toEqual({ now: 67, min: 55, max: 79 });
  });
});
