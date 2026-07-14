import { describe, expect, it } from "vitest";
import { snapshotCumulativeVolume } from "../snapshotVolume";

describe("snapshotCumulativeVolume", () => {
  it("uses extended-hours cumulative volume when it exceeds regular-session volume", () => {
    expect(snapshotCumulativeVolume({
      day: { v: 42_833 },
      min: { av: 127_033, v: 68_935 },
    })).toBe(127_033);
  });

  it("keeps regular-session volume when it is the largest available total", () => {
    expect(snapshotCumulativeVolume({
      day: { v: 250_000 },
      min: { av: 240_000, v: 5_000 },
    })).toBe(250_000);
  });

  it("falls back to the current minute volume and ignores invalid values", () => {
    expect(snapshotCumulativeVolume({
      day: { v: Number.NaN },
      min: { av: -1, v: 7_500 },
    })).toBe(7_500);
    expect(snapshotCumulativeVolume({})).toBe(0);
  });
});
