import { describe, expect, it } from "vitest";
import { computeSessionBoundaries } from "../sessionBoundaries";

function etTimeOf(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

describe("computeSessionBoundaries", () => {
  it("returns 04:00 / 09:30 / 16:00 / 20:00 ET on a regular weekday", () => {
    // 2026-04-30 — a Thursday in DST (ET = UTC-4).
    const b = computeSessionBoundaries("2026-04-30");
    expect(etTimeOf(b.pmStart)).toBe("04:00");
    expect(etTimeOf(b.rthStart)).toBe("09:30");
    expect(etTimeOf(b.rthEnd)).toBe("16:00");
    expect(etTimeOf(b.ahEnd)).toBe("20:00");
  });

  it("orders boundaries strictly increasing", () => {
    const b = computeSessionBoundaries("2026-04-30");
    expect(b.pmStart).toBeLessThan(b.rthStart);
    expect(b.rthStart).toBeLessThan(b.rthEnd);
    expect(b.rthEnd).toBeLessThan(b.ahEnd);
  });

  it("returns boundaries 5h30m apart between PM start and RTH start", () => {
    const b = computeSessionBoundaries("2026-04-30");
    expect(b.rthStart - b.pmStart).toBe((5 * 60 + 30) * 60);
  });

  it("handles DST: a winter (standard time) date gets the right ET wall clock", () => {
    // 2026-01-15 — winter, ET = UTC-5.
    const b = computeSessionBoundaries("2026-01-15");
    expect(etTimeOf(b.pmStart)).toBe("04:00");
    expect(etTimeOf(b.rthStart)).toBe("09:30");
    expect(etTimeOf(b.rthEnd)).toBe("16:00");
    expect(etTimeOf(b.ahEnd)).toBe("20:00");
  });

  it("throws on a malformed date", () => {
    expect(() => computeSessionBoundaries("2026-4-30")).toThrow();
    expect(() => computeSessionBoundaries("not-a-date")).toThrow();
  });
});
