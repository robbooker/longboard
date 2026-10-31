import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  easternTime,
  fixed,
  levelsLine,
  marketCap,
  money,
  parseGainersDay,
  parseGainersPage,
  shares,
  signalCandleTime,
  weekdayName,
  type GainersChartStock,
} from "@/lib/chatGainersPages";

const first = { ts: "2026-10-30T14:22:38Z", px: 2.68, vol: 392999, sess: "day" };
const chart = {
  sym: "CHOW",
  country: "Hong Kong",
  peak: 233.33,
  alertCount: 12,
  first,
  lastCap: 24940000,
  cmp: 5.6546,
  missed: [{ price: 9.2, month: "Sep 26" }],
  historyFrom: "2025-09-16",
  note: null,
  lo: 2,
  hi: 8,
  bars: [[1793332920, 2, 2.1, 1.9, 2, 100]],
  sma: [[1793332920, 2]],
  vwap: [[1793332920, 2]],
};
const page = { day: "2026-10-30", total: 28, top: [chart], rest: [{ sym: "ZJYL", country: "Unknown", peak: 40.85, first, lastCap: 211770000 }] };

describe("parseGainersPage", () => {
  it("accepts a good day and keeps only known fields", () => {
    const parsed = parseGainersPage({ ...page, html: "<script>x</script>", top: [{ ...chart, extra: 1 }] });
    expect(parsed?.day).toBe("2026-10-30");
    expect(parsed).not.toHaveProperty("html");
    expect(parsed?.top[0]).not.toHaveProperty("extra");
  });
  it.each([
    ["a bad date", { ...page, day: "2026-02-30" }],
    ["no charts", { ...page, top: [] }],
    ["seven charts", { ...page, top: Array(7).fill(chart) }],
    ["a bad ticker", { ...page, top: [{ ...chart, sym: "<b>" }] }],
    ["a bar with a missing number", { ...page, top: [{ ...chart, bars: [[1, 2, 3]] }] }],
    ["a bar with text", { ...page, top: [{ ...chart, bars: [[1, 2, 3, 4, 5, "6"]] }] }],
    ["an alert under 150K", { ...page, top: [{ ...chart, first: { ...first, vol: 149999 } }] }],
    ["an after-hours signal", { ...page, top: [{ ...chart, first: { ...first, sess: "after" } }] }],
    ["no country", { ...page, top: [{ ...chart, country: "" }] }],
    ["not an object", []],
  ])("refuses %s", (_name, value) => {
    expect(parseGainersPage(value)).toBeNull();
  });
  it("checks dates", () => {
    expect(parseGainersDay("2026-10-30")).toBe("2026-10-30");
    expect(parseGainersDay("2026-13-01")).toBeNull();
    expect(parseGainersDay("../x")).toBeNull();
  });
});

describe("display matches the approved Python formatting", () => {
  it("rounds exact ties to even, like Python", () => {
    const values = [0.5, 1.5, 2.5, 32.5, 150.5, 1.15, 1.25, 1.35, 1.45, 1.55, 1.65, 1.75, 2.675, 9.995, 10.005, 233.33, 0.125, 0.375];
    const out = execFileSync("python3", ["-I", "-c", `import json,sys
v=json.loads(sys.argv[1]);print(json.dumps([[f"{x:.0f}",f"{x:.1f}",f"{x:.2f}",f"{x:.3f}"] for x in v]))`, JSON.stringify(values)]);
    const expected = JSON.parse(out.toString()) as string[][];
    values.forEach((value, i) => expect([0, 1, 2, 3].map((d) => fixed(value, d))).toEqual(expected[i]));
  });
  it("formats money, shares and caps", () => {
    expect(money(5.6546)).toBe("$5.655");
    expect(money(1234.5)).toBe("$1,234.50");
    expect(shares(392999)).toBe("393K");
    expect(shares(18925822)).toBe("18.9M");
    expect(marketCap(24940000)).toBe("$24.9M");
    expect(marketCap(1.2e9)).toBe("$1.2B");
    expect(marketCap(900000)).toBe("$900K");
  });
  it("uses Eastern time and the 2-minute grid", () => {
    expect(easternTime("2026-10-30T14:22:38Z")).toBe("10:22 AM");
    // 10:22:38 Eastern as if UTC, floored to 10:22.
    expect(signalCandleTime("2026-10-30T14:22:38Z")).toBe(Date.UTC(2026, 9, 30, 10, 22) / 1000);
    // Winter clocks are UTC-5.
    expect(signalCandleTime("2026-12-01T15:03:00Z")).toBe(Date.UTC(2026, 11, 1, 10, 2) / 1000);
    expect(weekdayName("2026-10-30")).toBe("Friday");
  });
  it("writes the pivots line", () => {
    const stock = chart as unknown as GainersChartStock;
    expect(levelsLine(stock, "2026-10-30")).toBe("Oct pivot $5.655. Missed pivots: $9.200 Sep 26 (above chart).");
    expect(levelsLine({ ...stock, cmp: null, missed: [], historyFrom: "2026-10-05" }, "2026-10-30")).toBe(
      "Oct pivot: none, no September trading. Missed pivots: none found. Market data starts 2026-10-05, so older missed pivots are not checked.",
    );
    expect(levelsLine({ ...stock, missed: [], note: "It began trading in October." }, "2026-10-30")).toBe(
      "Oct pivot $5.655. Missed pivots: none found. It began trading in October.",
    );
  });
});
