import { describe, expect, it } from "vitest";
import { clockZone, placeClock, zoneLetters } from "@/lib/gainerBalloons/clock";
import { nyEpochMs } from "@/lib/gainerBalloons/data";

// #532 Gainer Balloons: the clock follows the chosen place. The short letters for a time zone, how
// a moment reads there (daylight saving included), and New York time for anything not known.
const WINTER = "2026-11-27";
const SUMMER = "2026-07-15";
/** 9:00 AM in New York on that day. */
const nine = (day: string) => nyEpochMs(day, 9 * 60);

describe("zoneLetters", () => {
  it("gives each U.S. zone its plain letters, the same in summer and winter", () => {
    const zones: Record<string, string> = {
      "America/New_York": "ET",
      "America/Detroit": "ET",
      "America/Indiana/Indianapolis": "ET",
      "America/Kentucky/Louisville": "ET",
      "America/Chicago": "CT",
      "America/Indiana/Knox": "CT",
      "America/North_Dakota/Center": "CT",
      "America/Menominee": "CT",
      "America/Denver": "MT",
      "America/Boise": "MT",
      "America/Phoenix": "MT",
      "America/Los_Angeles": "PT",
      "America/Anchorage": "AKT",
      "America/Juneau": "AKT",
      "America/Nome": "AKT",
      "Pacific/Honolulu": "HT",
      "America/Adak": "HT",
      "America/Puerto_Rico": "AT",
    };
    for (const [zone, letters] of Object.entries(zones)) expect(zoneLetters(zone), zone).toBe(letters);
  });
  it("answers nothing for a zone it doesn't know, or anything that isn't a zone name", () => {
    for (const zone of ["Europe/London", "Asia/Tokyo", "UTC", "Mars/Olympus_Mons", "", " ", "CST", "<b>America/Chicago</b>", "America/Chicago ", "a".repeat(60), null, undefined, 5, {}, ["America/Chicago"]]) {
      expect(zoneLetters(zone), String(zone)).toBeNull();
      expect(clockZone(zone), String(zone)).toBeNull();
    }
    expect(clockZone("America/Chicago")).toBe("America/Chicago");
  });
});

describe("placeClock", () => {
  it("reads 9:00 AM in New York as each place's own time", () => {
    const winter: Record<string, string> = {
      "America/New_York": "9:00 AM ET",
      "America/Chicago": "8:00 AM CT",
      "America/Denver": "7:00 AM MT",
      "America/Phoenix": "7:00 AM MT",
      "America/Los_Angeles": "6:00 AM PT",
      "America/Anchorage": "5:00 AM AKT",
      "Pacific/Honolulu": "4:00 AM HT",
      "America/Puerto_Rico": "10:00 AM AT",
    };
    for (const [zone, text] of Object.entries(winter)) expect(placeClock(zone).clock(nine(WINTER)), zone).toBe(text);
  });
  it("handles daylight saving: Arizona and Hawaii don't shift, so in summer they fall an hour further behind", () => {
    const summer: Record<string, string> = {
      "America/New_York": "9:00 AM ET",
      "America/Chicago": "8:00 AM CT",
      "America/Denver": "7:00 AM MT",
      "America/Phoenix": "6:00 AM MT",
      "America/Los_Angeles": "6:00 AM PT",
      "America/Anchorage": "5:00 AM AKT",
      "Pacific/Honolulu": "3:00 AM HT",
      "America/Puerto_Rico": "9:00 AM AT",
    };
    for (const [zone, text] of Object.entries(summer)) expect(placeClock(zone).clock(nine(SUMMER)), zone).toBe(text);
    // Arizona: with Denver in winter, with Los Angeles in summer; "MT" both times.
    expect(placeClock("America/Phoenix").time(nine(WINTER))).toBe(placeClock("America/Denver").time(nine(WINTER)));
    expect(placeClock("America/Phoenix").time(nine(SUMMER))).toBe(placeClock("America/Los_Angeles").time(nine(SUMMER)));
  });
  it("reads the trading day's ends in the place's time: Austin's runs 3:00 AM to 7:00 PM", () => {
    const austin = placeClock("America/Chicago");
    expect(austin.letters).toBe("CT");
    expect(austin.zone).toBe("America/Chicago");
    expect([4 * 60, 9 * 60 + 30, 12 * 60, 16 * 60, 20 * 60].map((minute) => austin.time(nyEpochMs(WINTER, minute)))).toEqual(["3:00 AM", "8:30 AM", "11:00 AM", "3:00 PM", "7:00 PM"]);
    expect(austin.clock(nyEpochMs(WINTER, 9 * 60 + 42))).toBe("8:42 AM CT");
    expect(placeClock("Pacific/Honolulu").time(nyEpochMs(WINTER, 4 * 60))).toBe("11:00 PM");
  });
  it("stays on New York time, \"ET\", without a zone or with one it doesn't know", () => {
    for (const zone of [undefined, null, "", "Europe/London", "Not/A_Zone", "CST"]) {
      const clock = placeClock(zone);
      expect(clock.letters, String(zone)).toBe("ET");
      expect(clock.zone).toBe("America/New_York");
      expect(clock.clock(nine(WINTER))).toBe("9:00 AM ET");
      expect(clock.time(nyEpochMs(WINTER, 20 * 60))).toBe("8:00 PM");
    }
  });
  it("never puts a zone's name in what is shown", () => {
    for (const zone of ["America/Chicago", "America/Phoenix", "Pacific/Honolulu"]) expect(placeClock(zone).clock(nine(WINTER))).toMatch(/^\d{1,2}:\d\d [AP]M [A-Z]{2,3}$/);
  });
});
