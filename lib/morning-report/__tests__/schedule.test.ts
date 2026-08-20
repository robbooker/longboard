import { describe, expect, it } from "vitest";
import {
  formatMorningReportCountdown,
  getEtReportWeekRange,
  getMorningReportAvailability,
  isEtWeekend,
  isMorningBuildMinute,
  isMorningReportFresh,
} from "@/lib/morning-report/schedule";

describe("morning report schedule", () => {
  it("recognizes the scheduled 6:30 AM Eastern build minute", () => {
    expect(isMorningBuildMinute(new Date("2026-08-20T10:30:00.000Z"))).toBe(true);
    expect(isMorningBuildMinute(new Date("2026-08-20T10:29:59.000Z"))).toBe(false);
    expect(isMorningBuildMinute(new Date("2026-01-15T11:30:00.000Z"))).toBe(true);
  });

  it("treats any same-day report, including an admin run, as fresh", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    expect(isMorningReportFresh("2026-08-20", now)).toBe(true);
  });

  it("makes the prior report stale at midnight Eastern", () => {
    const justBeforeMidnightEt = new Date("2026-08-21T03:59:59.000Z");
    const midnightEt = new Date("2026-08-21T04:00:00.000Z");
    expect(isMorningReportFresh("2026-08-20", justBeforeMidnightEt)).toBe(true);
    expect(isMorningReportFresh("2026-08-20", midnightEt)).toBe(false);
  });

  it("counts down to today's issue before 6:30 AM Eastern", () => {
    const availability = getMorningReportAvailability(new Date("2026-08-20T10:00:00.000Z"));
    expect(availability.scheduledReportDate).toBe("2026-08-20");
    expect(availability.scheduledAt.toISOString()).toBe("2026-08-20T10:30:00.000Z");
    expect(availability.remainingMs).toBe(30 * 60_000);
    expect(availability.isDue).toBe(false);
  });

  it("holds at due now after the scheduled issue time until a fresh report exists", () => {
    const availability = getMorningReportAvailability(new Date("2026-08-20T10:45:00.000Z"));
    expect(availability.scheduledReportDate).toBe("2026-08-20");
    expect(availability.remainingMs).toBe(0);
    expect(availability.isDue).toBe(true);
  });

  it("counts down across the weekend to Monday's report", () => {
    const availability = getMorningReportAvailability(new Date("2026-08-22T16:00:00.000Z"));
    expect(availability.scheduledReportDate).toBe("2026-08-24");
    expect(availability.scheduledAt.toISOString()).toBe("2026-08-24T10:30:00.000Z");
    expect(availability.scheduledDateLabel).toBe("MONDAY, AUG 24");
    expect(availability.isDue).toBe(false);
  });

  it("resolves the completed Monday-through-Friday report range on weekends", () => {
    const saturday = new Date("2026-08-22T16:00:00.000Z");
    const sunday = new Date("2026-08-23T16:00:00.000Z");
    expect(isEtWeekend(saturday)).toBe(true);
    expect(isEtWeekend(sunday)).toBe(true);
    expect(getEtReportWeekRange(saturday)).toEqual({
      weekStart: "2026-08-17",
      weekEnd: "2026-08-21",
    });
    expect(getEtReportWeekRange(sunday)).toEqual({
      weekStart: "2026-08-17",
      weekEnd: "2026-08-21",
    });
  });

  it("formats short and multi-day countdowns", () => {
    expect(formatMorningReportCountdown(3_661_000)).toBe("01:01:01");
    expect(formatMorningReportCountdown(183_661_000)).toBe("2D 03:01:01");
    expect(formatMorningReportCountdown(-1)).toBe("00:00:00");
  });
});
