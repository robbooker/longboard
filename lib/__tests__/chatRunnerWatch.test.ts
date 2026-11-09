import { describe, expect, it } from "vitest";
import { parseRunnerWatchUpdate, runnerWatchReportId } from "@/lib/chatRunnerWatch";
import { composeRunnerWatchPost, runnerWatchLinkLabel, runnerWatchPostLink, runnerWatchReportParts, safeRunnerWatchHref } from "@/lib/chatRunnerWatchText";

const good = { id: "a", summary: "S", fullText: "F" };
const parse = (extra: object) => parseRunnerWatchUpdate({ ...good, ...extra });
const URL_ = "https://www.longboardai.com/runner-watch/12345678-1234-4234-8234-123456789012";

describe("the update shape", () => {
  it("accepts the small shape, with or without tickers", () => {
    const r = parse({ tickers: ["$sgrx", "SGRX", "BRK.B"], alert: true, sentAt: "2026-10-31T14:30:00Z" });
    expect(r).toMatchObject({ ok: true, update: { key: "id:a", tickers: ["SGRX", "BRK.B"], alert: true, sentAt: "2026-10-31T14:30:00.000Z" } });
    expect(parse({})).toMatchObject({ ok: true, update: { tickers: [], alert: false, sentAt: null } });
  });
  it("uses dedupeKey, and the words when neither is sent", () => {
    expect(parseRunnerWatchUpdate({ dedupeKey: "k", summary: "S", fullText: "F" })).toMatchObject({ update: { key: "id:k" } });
    const a = parseRunnerWatchUpdate({ summary: "S", fullText: "F" }), b = parseRunnerWatchUpdate({ summary: "S", fullText: "F" });
    expect(a.ok && a.update.key.startsWith("hash:")).toBe(true);
    expect(a).toEqual(b);
  });
  it.each([
    [{ summary: "" }, "summary_required"], [{ summary: 1 }, "summary_required"], [{ fullText: "  " }, "full_text_required"],
    [{ summary: "x".repeat(1001) }, "summary_too_long"], [{ fullText: "x".repeat(50001) }, "full_text_too_long"],
    [{ tickers: "SGRX" }, "invalid_tickers"], [{ tickers: ["<b>"] }, "invalid_tickers"], [{ tickers: Array(21).fill("A") }, "invalid_tickers"],
    [{ alert: "yes" }, "invalid_alert"], [{ sentAt: "yesterday" }, "invalid_sent_at"], [{ id: "x".repeat(198) }, "invalid_id"], [{ id: 5 }, "invalid_id"],
  ])("refuses %j", (extra, error) => expect(parse(extra)).toEqual({ ok: false, error }));
  it("strips hidden characters and refuses non-objects", () => {
    expect(parse({ summary: "a\u0000b‮c\r\nd" })).toMatchObject({ update: { summary: "abc\nd" } });
    expect(parseRunnerWatchUpdate([])).toEqual({ ok: false, error: "invalid_update" });
  });
  it("gives one key one stable address", () => {
    expect(runnerWatchReportId("id:a")).toBe(runnerWatchReportId("id:a"));
    expect(runnerWatchReportId("id:a")).not.toBe(runnerWatchReportId("id:b"));
    expect(runnerWatchReportId("id:a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("the chat post", () => {
  it("words the link for any number of tickers", () => {
    expect(runnerWatchLinkLabel(["SGRX"])).toBe("More about SGRX here");
    expect(runnerWatchLinkLabel(["A", "B"])).toBe("More about A and B here");
    expect(runnerWatchLinkLabel(["A", "B", "C", "D", "E"])).toBe("More about A, B, C and 2 more here");
    expect(runnerWatchLinkLabel([])).toBe("More about this update here");
  });
  it("carries summary, link and label, and leads differently in main rooms", () => {
    const post = composeRunnerWatchPost({ tickers: ["SGRX"], summary: "New S-1.", alert: true, url: URL_ });
    expect(post).toBe(`Alert: New S-1.\n\nMore about SGRX here: ${URL_}\nAI-generated research from Jake's watchlist. Check it against the filings. Not trade advice.`);
    expect(composeRunnerWatchPost({ tickers: [], summary: "S", alert: true, url: URL_, mainRoom: true })).toMatch(/^Runner Risk Watch alert: S\n/);
  });
  it("stays under the room's limit in the worst case and keeps only our link", () => {
    const worst = composeRunnerWatchPost({ tickers: ["ABCDEFGHIJ", "BCDEFGHIJK", "CDEFGHIJKL", "D"], summary: "word ".repeat(200), alert: true, url: URL_, mainRoom: true });
    expect(worst.length).toBeLessThanOrEqual(600);
    const post = composeRunnerWatchPost({ tickers: [], summary: "See https://evil.test/x and www.evil.test now", alert: false, url: URL_ });
    expect(post).not.toContain("evil");
    expect(composeRunnerWatchPost({ tickers: [], summary: "https://evil.test", alert: false, url: URL_ })).toMatch(/^New Runner Risk Watch update\./);
  });
  it("finds the bot's link, and nothing else", () => {
    const post = composeRunnerWatchPost({ tickers: ["SGRX"], summary: "S", alert: false, url: URL_ });
    expect(runnerWatchPostLink(post)).toMatchObject({ before: "S\n\n", label: "More about SGRX here", href: "/runner-watch/12345678-1234-4234-8234-123456789012" });
    expect(runnerWatchPostLink("More about X here: https://evil.test/other")).toBeNull();
  });
});

describe("links in the report", () => {
  it("allows only http and https", () => {
    expect(safeRunnerWatchHref("https://sec.gov/a")).toBe("https://sec.gov/a");
    expect(safeRunnerWatchHref("HTTP://sec.gov/")).toBe("http://sec.gov/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.test", "https://u:p@evil.test/", "vbscript:x", "ftp://x"]) expect(safeRunnerWatchHref(bad)).toBeNull();
  });
  it("picks out links and leaves the rest as text, HTML included", () => {
    expect(runnerWatchReportParts("See https://a.test/x. <b>y</b>")).toEqual([
      { kind: "text", value: "See " }, { kind: "link", value: "https://a.test/x", href: "https://a.test/x" }, { kind: "text", value: ". <b>y</b>" },
    ]);
    expect(runnerWatchReportParts("[S-1](https://a.test/) [bad](javascript:alert(1))").filter((p) => p.kind === "link")).toEqual([{ kind: "link", value: "S-1", href: "https://a.test/" }]);
    expect(runnerWatchReportParts("[bad](javascript:x)")).toEqual([{ kind: "text", value: "[bad](javascript:x)" }]);
    expect(runnerWatchReportParts("javascript:alert(1)")).toEqual([{ kind: "text", value: "javascript:alert(1)" }]);
  });
});
