import { describe, expect, it } from "vitest";
import { easternDateKey, easternDayBounds, easternHour } from "@/lib/chatSummary";

describe("Longboard Chat daily summary window", () => {
  it("uses Eastern calendar days during daylight time", () => {
    const { start, end } = easternDayBounds("2026-08-31");
    expect(start.toISOString()).toBe("2026-08-31T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("uses Eastern calendar days during standard time", () => {
    const { start, end } = easternDayBounds("2026-01-15");
    expect(start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-16T05:00:00.000Z");
  });

  it("detects the nightly Eastern summary hour across UTC dates", () => {
    const now = new Date("2026-09-01T03:45:00.000Z");
    expect(easternDateKey(now)).toBe("2026-08-31");
    expect(easternHour(now)).toBe(23);
  });
});
