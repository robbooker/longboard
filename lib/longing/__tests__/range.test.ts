import { describe, expect, it } from "vitest";
import { resolveLongingReportRange } from "../range";

describe("resolveLongingReportRange", () => {
  it("keeps the legacy Monday-through-Friday week behavior", () => {
    expect(resolveLongingReportRange({ week: "2026-07-13" })).toEqual({ start: "2026-07-13", end: "2026-07-17", days: 5 });
  });

  it("supports a single trading date", () => {
    expect(resolveLongingReportRange({ start: "2026-07-13" })).toEqual({ start: "2026-07-13", end: "2026-07-13", days: 1 });
  });

  it("supports an inclusive custom date range", () => {
    expect(resolveLongingReportRange({ start: "2026-07-08", end: "2026-07-13" })).toEqual({ start: "2026-07-08", end: "2026-07-13", days: 6 });
  });

  it("rejects reversed and oversized ranges", () => {
    expect(() => resolveLongingReportRange({ start: "2026-07-14", end: "2026-07-13" })).toThrow("The end date must be on or after the start date.");
    expect(() => resolveLongingReportRange({ start: "2026-06-01", end: "2026-07-13" })).toThrow("Choose a date range of 31 days or fewer.");
  });
});
