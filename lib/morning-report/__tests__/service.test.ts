import { describe, expect, it } from "vitest";
import {
  applyLiveRefreshResults,
  isLiveRefreshWindow,
  isMorningBuildMinute,
  liveRefreshVersionType,
} from "@/lib/morning-report/service";
import { emptyPriceTargets, type MorningEmailStock } from "@/lib/morning-email/types";

function stock(ticker: string, last: number): MorningEmailStock {
  return {
    ticker,
    name: `${ticker} Inc.`,
    change_pct: 10,
    dollar_change: 1,
    last,
    volume: 1000,
    market_cap: "$10M",
    float: "1.0M",
    provider_updated_at: "2026-05-07T13:00:00.000Z",
    catalyst: ["Original catalyst"],
    sentiment: "Original sentiment",
    evidence_notes: "",
    confidence: "Medium",
    risk_flags: [],
    source_urls: [],
    evidence: [],
    price_targets: emptyPriceTargets(),
  };
}

describe("morning report live refresh helpers", () => {
  it("patches successful tickers and preserves failed ticker values", () => {
    const original = [stock("AAA", 1), stock("BBB", 2)];
    const refreshed = applyLiveRefreshResults(original, [
      {
        ok: true,
        ticker: "AAA",
        patch: {
          last: 1.25,
          change_pct: 25,
          dollar_change: 0.25,
          volume: 2500,
          market_cap: "$12M",
          provider_updated_at: "2026-05-07T14:00:00.000Z",
        },
      },
      { ok: false, ticker: "BBB", error: "provider timeout" },
    ]);

    expect(refreshed.attempted).toEqual(["AAA", "BBB"]);
    expect(refreshed.succeeded).toEqual(["AAA"]);
    expect(refreshed.failed).toEqual(["BBB"]);
    expect(refreshed.stocks[0]).toMatchObject({ ticker: "AAA", last: 1.25, change_pct: 25, volume: 2500 });
    expect(refreshed.stocks[0].catalyst).toEqual(["Original catalyst"]);
    expect(refreshed.stocks[1]).toEqual(original[1]);
  });

  it("labels the 4:00pm ET run as the closing refresh", () => {
    expect(liveRefreshVersionType(new Date("2026-05-07T20:00:00.000Z"))).toBe("closing_refresh");
    expect(liveRefreshVersionType(new Date("2026-05-07T19:45:00.000Z"))).toBe("live_refresh");
  });

  it("uses ET operating windows", () => {
    expect(isMorningBuildMinute(new Date("2026-05-07T10:30:00.000Z"))).toBe(true);
    expect(isLiveRefreshWindow(new Date("2026-05-07T11:00:00.000Z"))).toBe(true);
    expect(isLiveRefreshWindow(new Date("2026-05-07T20:00:00.000Z"))).toBe(true);
    expect(isLiveRefreshWindow(new Date("2026-05-07T20:15:00.000Z"))).toBe(false);
  });
});
