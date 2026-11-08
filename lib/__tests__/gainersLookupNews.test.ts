import { describe, expect, it } from "vitest";
import { dtItemId, dtNewsSettled, dtNewsTime, newsPayload, parseDtNews, NEWS_MAX_ITEMS } from "../../scripts/gainers-lookup/parse.mjs";
import { createNewsSchedule, easternDay, newsDue, NEWS_TRIES } from "../../scripts/gainers-lookup/lookup.mjs";

// #387: small synthetic rows in the shape the News tab snapshot returns (never saved pages):
// meta = the item's header spans (relative time, exact New York time, wire), links = its anchors.
const NOW = Date.parse("2026-11-08T17:00:00Z");
const row = (when: string, wire: string, title: string, href: string, rel = "2 days ago") => ({ meta: [rel, `${when} `, wire], links: [{ href, text: title }] });

describe("DilutionTracker news times", () => {
  it("reads New York time in winter (EST) and summer (EDT)", () => {
    expect(dtNewsTime("11/6/2026, 9:15:00 AM")).toBe("2026-11-06T14:15:00.000Z");
    expect(dtNewsTime("10/1/2026, 4:08:00 PM ")).toBe("2026-10-01T20:08:00.000Z");
    expect(dtNewsTime("11/4/2026, 12:00:00 PM")).toBe("2026-11-04T17:00:00.000Z");
    expect(dtNewsTime("11/4/2026, 12:30:00 AM")).toBe("2026-11-04T05:30:00.000Z");
    expect(dtNewsTime("11/4/2026, 9:30 PM")).toBe("2026-11-05T02:30:00.000Z");
  });
  it("refuses anything else", () => {
    for (const bad of ["2 days ago", "ACCESS Newswire", "13/1/2026, 9:00:00 AM", "11/6/2026, 13:15:00 PM", "", null]) expect(dtNewsTime(bad)).toBeNull();
  });
  it("takes DilutionTracker's id from its dilution.news link only", () => {
    expect(dtItemId("https://dilution.news/bdd806ef20e2f0afc6aa4a9f68db15c9")).toBe("bdd806ef20e2f0afc6aa4a9f68db15c9");
    expect(dtItemId("https://dilution.news/2UndnT")).toBe("2UndnT");
    expect(dtItemId("https://www.globenewswire.com/news-release/1")).toBeNull();
    expect(dtItemId("https://dilution.news/a/b")).toBeNull();
    expect(dtItemId("not a url")).toBeNull();
  });
});

describe("parseDtNews", () => {
  it("keeps each release with its wire, time, headline and link, newest first", () => {
    const items = parseDtNews(
      [
        row("11/5/2026, 10:30:00 AM", "ACCESS Newswire", "Good Intentions Don't Count; Measured Plastic Does", "https://dilution.news/c92d0001", "3 days ago"),
        row("11/6/2026, 9:15:00 AM", "ACCESS Newswire", "Plastic Recycling has a New Passport; SMX is the Stamp", "https://dilution.news/bdd80001"),
        row("10/30/2026, 3:00:00 PM", "GlobeNewswire", "  A   headline\nwith odd spacing ", "https://www.globenewswire.com/x", "9 days ago"),
      ],
      { now: NOW },
    );
    expect(items).toEqual([
      { publishedAt: "2026-11-06T14:15:00.000Z", source: "ACCESS Newswire", title: "Plastic Recycling has a New Passport; SMX is the Stamp", url: "https://dilution.news/bdd80001", dtItemId: "bdd80001" },
      { publishedAt: "2026-11-05T15:30:00.000Z", source: "ACCESS Newswire", title: "Good Intentions Don't Count; Measured Plastic Does", url: "https://dilution.news/c92d0001", dtItemId: "c92d0001" },
      { publishedAt: "2026-10-30T19:00:00.000Z", source: "GlobeNewswire", title: "A headline with odd spacing", url: "https://www.globenewswire.com/x", dtItemId: null },
    ]);
  });
  it("keeps the last 30 days only, each release once, at most 50", () => {
    const old = row("4/29/2024, 9:00:00 AM", "GlobeNewswire", "Two years back", "https://dilution.news/old00001", "2 years ago");
    const dup = row("11/6/2026, 9:15:00 AM", "ACCESS Newswire", "Same", "https://dilution.news/same0001");
    expect(parseDtNews([old, dup, dup], { now: NOW }).map((i) => i.title)).toEqual(["Same"]);
    const many = Array.from({ length: 80 }, (_, i) => row(`11/${1 + (i % 7)}/2026, 9:${String(i % 60).padStart(2, "0")}:00 AM`, "W", `T${i}`, `https://dilution.news/id${String(i).padStart(4, "0")}`));
    expect(parseDtNews(many, { now: NOW })).toHaveLength(NEWS_MAX_ITEMS);
  });
  it("skips rows without a usable link, headline or time, and odd input", () => {
    expect(
      parseDtNews(
        [
          row("11/6/2026, 9:15:00 AM", "W", "Script link", "javascript:alert(1)"),
          row("11/6/2026, 9:15:00 AM", "W", "   ", "https://dilution.news/empt0001"),
          row("yesterday", "W", "No time", "https://dilution.news/noti0001"),
          { meta: "x", links: null },
          null,
        ],
        { now: NOW },
      ),
    ).toEqual([]);
    expect(parseDtNews(null as unknown as [], { now: NOW })).toEqual([]);
  });
  it("finds the time even when the relative time is missing, and leaves an unknown wire empty", () => {
    expect(parseDtNews([{ meta: ["11/6/2026, 9:15:00 AM"], links: [{ href: "https://dilution.news/only0001", text: "Only a time" }] }], { now: NOW })[0]).toMatchObject({ source: "", title: "Only a time" });
  });
  it("counts a read finished once the tab shows releases, or has drawn and waited", () => {
    expect(dtNewsSettled({ active: false, headings: [], rows: [] }, 99_000)).toBe(false);
    expect(dtNewsSettled({ active: true, headings: ["Chart Explorer", "PR Releases"], rows: [{}] }, 0)).toBe(true);
    expect(dtNewsSettled({ active: true, headings: ["Chart Explorer"], rows: [] }, 2_000)).toBe(false);
    expect(dtNewsSettled({ active: true, headings: ["Chart Explorer"], rows: [] }, 9_000)).toBe(true);
    expect(dtNewsSettled({ active: true, headings: [], rows: [] }, 99_000)).toBe(false);
  });
  it("keeps a post under 30 KB by dropping the oldest", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ publishedAt: "2026-11-06T14:15:00.000Z", source: "W", title: "x".repeat(700), url: `https://dilution.news/id${i}`, dtItemId: `id${i}xx` }));
    const body = newsPayload("SMX", items);
    expect(body.kind).toBe("news");
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(30_000);
    expect(body.items[0]).toEqual(items[0]);
    expect(body.items.length).toBeLessThan(50);
  });
});

describe("once-a-day news schedule", () => {
  const at = (iso: string) => Date.parse(iso);
  it("reads a ticker once per Eastern day and never again that day", () => {
    const schedule = createNewsSchedule();
    const t = at("2026-11-09T14:30:00Z");
    expect(newsDue([{ ticker: "SMX" }, { ticker: "AEHL" }], schedule, t)).toEqual(["SMX", "AEHL"]);
    schedule.succeeded("SMX", t);
    expect(newsDue([{ ticker: "SMX" }, { ticker: "AEHL" }], schedule, t + 60_000)).toEqual(["AEHL"]);
    // Still listed by the chat hours later (say its save didn't show yet): not read again today.
    expect(newsDue([{ ticker: "SMX" }], schedule, at("2026-11-10T04:59:00Z"))).toEqual([]);
  });
  it("tries a failed read again after 2, 4, 8 minutes, then stops for the day", () => {
    const schedule = createNewsSchedule();
    let t = at("2026-11-09T14:30:00Z");
    const tries: number[] = [];
    for (let minute = 0; minute < 120; minute++, t += 60_000)
      if (schedule.ready("SMX", t)) {
        tries.push(minute);
        schedule.failed("SMX", t);
      }
    expect(tries).toEqual([0, 2, 6, 14]);
    expect(tries).toHaveLength(NEWS_TRIES);
    expect(schedule.gaveUp("SMX", t)).toBe(true);
  });
  it("stops retrying once a read works", () => {
    const schedule = createNewsSchedule();
    const t = at("2026-11-09T14:30:00Z");
    schedule.failed("SMX", t);
    expect(schedule.ready("SMX", t + 60_000)).toBe(false);
    expect(schedule.ready("SMX", t + 120_000)).toBe(true);
    schedule.succeeded("SMX", t + 120_000);
    expect(schedule.ready("SMX", t + 3_600_000)).toBe(false);
    expect(schedule.gaveUp("SMX", t + 3_600_000)).toBe(false);
  });
  it("starts fresh on the next Eastern day (midnight New York, not UTC)", () => {
    const schedule = createNewsSchedule();
    const evening = at("2026-11-09T23:30:00Z"); // 6:30 PM New York, still the 9th
    schedule.succeeded("SMX", evening);
    for (let i = 0; i < NEWS_TRIES; i++) schedule.failed("AEHL", evening + i * 3_600_000);
    expect(easternDay(at("2026-11-10T01:00:00Z"))).toBe("2026-11-09");
    expect(schedule.ready("SMX", at("2026-11-10T01:00:00Z"))).toBe(false);
    expect(easternDay(at("2026-11-10T05:01:00Z"))).toBe("2026-11-10");
    expect(newsDue([{ ticker: "SMX" }, { ticker: "AEHL" }], schedule, at("2026-11-10T05:01:00Z"))).toEqual(["SMX", "AEHL"]);
  });
  it("ignores odd entries in the chat's list", () => {
    expect(newsDue([{ ticker: "bad" }, null, { ticker: 5 }, { ticker: "OK" }], createNewsSchedule(), NOW)).toEqual(["OK"]);
    expect(newsDue(null, createNewsSchedule(), NOW)).toEqual([]);
  });
});
