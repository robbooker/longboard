import { describe, expect, it } from "vitest";
import { amount, cashSection, factsPayload, parseDilutionTracker } from "../../scripts/gainers-lookup/parse.mjs";
import { createBackoff, createPacer, lookupUrl, marketHours } from "../../scripts/gainers-lookup/lookup.mjs";

// #371: small synthetic page texts in the shapes DilutionTracker uses (never saved pages).
const header = (country: string, inst = "0.1%") =>
  `DilutionTracker\nSector:IndustrialsIndustry:Building ProductsCountry:${country}Exchange:NASDAQ\n` +
  `Mkt Cap & EV:193.7M / 165.8MFloat & OS:0.55M / 16.46MEst. Net Cash/Sh:1.7Inst Own:${inst}SI:41.7%\n`;
const cashBlock = (sentence: string) =>
  `Cash Need\nLow\nHistorical O/S\n\nCash Position\n\n${sentence}\n\n12/31/2018\n06/30/2020\nOpCF\nCurrent Est\n0\n8\n            Millions of USD\nWarrant\n`;
const page = (country: string, sentence: string | null, inst?: string) =>
  header(country, inst) + (sentence === null ? "About the company\n" : cashBlock(sentence));

describe("parseDilutionTracker", () => {
  it("reads months left, burn and current cash", () => {
    const parsed = parseDilutionTracker(
      page("China", "The company has 304.7 months of cash left based on quarterly cash burn of -$0.31M and estimated current cash of $31.5M."),
    );
    expect(parsed).toEqual({
      state: "found",
      country: "China",
      instOwnPct: 0.1,
      cashUsd: 31_500_000,
      cashMonthsLeft: 304.7,
      cashFlowPositive: false,
      cashSection: true,
    });
  });
  it("saves the U.S. with its dot", () => {
    expect(parseDilutionTracker(page("U.S", null)).country).toBe("U.S.");
    expect(parseDilutionTracker(page("U.S.", null)).country).toBe("U.S.");
    expect(parseDilutionTracker(page("Hong Kong", null)).country).toBe("Hong Kong");
    expect(parseDilutionTracker(page("China Hong Kong", null)).country).toBe("China Hong Kong");
  });
  it("reads a cash flow positive company: no months, no burn amount taken as cash", () => {
    const parsed = parseDilutionTracker(
      page("Greece", "The company is cashflow positive based on quarterly operating cash flow of $5.53M.", "2.0%"),
    );
    expect(parsed).toMatchObject({ cashFlowPositive: true, cashUsd: null, cashMonthsLeft: null, instOwnPct: 2 });
  });
  it("keeps a current cash amount a positive company's page gives", () => {
    const parsed = parseDilutionTracker(
      page("U.S", "The company has positive operating cash flow of $1.2M and estimated current cash of $850K."),
    );
    expect(parsed).toMatchObject({ cashFlowPositive: true, cashUsd: 850_000, cashMonthsLeft: null });
  });
  it("handles other amounts and wordings", () => {
    const one = (sentence: string) => parseDilutionTracker(page("Israel", sentence));
    expect(one("The company has 1,204.5 months of cash left based on quarterly cash burn of -$0.01M and estimated current cash of $1.2B.")).toMatchObject({ cashUsd: 1_200_000_000, cashMonthsLeft: 1204.5 });
    expect(one("The company has 0.4 months of cash left based on quarterly cash burn of -$12.1M and estimated current cash of $1,850K.")).toMatchObject({ cashUsd: 1_850_000, cashMonthsLeft: 0.4 });
    expect(one("The company has 3 months of cash remaining based on quarterly cash burn of -$2M and an estimated current cash position of $2.0M.")).toMatchObject({ cashUsd: 2_000_000, cashMonthsLeft: 3 });
    expect(one("The company has cash and cash equivalents of $4.5 million.")).toMatchObject({ cashUsd: 4_500_000, cashMonthsLeft: null });
  });
  it("leaves cash empty when the page has no Cash Position (large companies)", () => {
    expect(parseDilutionTracker(page("U.S", null, "66.9%"))).toMatchObject({
      state: "found",
      cashSection: false,
      cashUsd: null,
      cashMonthsLeft: null,
      cashFlowPositive: false,
      instOwnPct: 66.9,
    });
  });
  it("never reads cash from outside the Cash Position section", () => {
    const text = header("China") + "News: the company reported estimated current cash of $99M last year.\n";
    expect(parseDilutionTracker(text).cashUsd).toBeNull();
  });
  it("reads a missing country or ownership as empty", () => {
    expect(parseDilutionTracker(page("N/A", null, "N/A")).country).toBeNull();
    expect(parseDilutionTracker(page("", null, "N/A")).instOwnPct).toBeNull();
  });
  it("tells a ticker it doesn't know from a page still loading", () => {
    expect(parseDilutionTracker("DilutionTracker\nGo\nPOPULAR TICKERS\nELPW\n-20.3%eLong Power").state).toBe("not_found");
    expect(parseDilutionTracker("DilutionTracker\nLoading").state).toBe("loading");
    expect(parseDilutionTracker("").state).toBe("loading");
  });
  it("stops the cash section at the chart", () => {
    expect(cashSection(cashBlock("A sentence."))).toBe("A sentence.");
    expect(cashSection("nothing here")).toBe("");
  });
  it("reads amounts", () => {
    expect(amount("31.5", "M")).toBe(31_500_000);
    expect(amount("1,850", "K")).toBe(1_850_000);
    expect(amount("4.5", "million")).toBe(4_500_000);
    expect(amount("12", "")).toBe(12);
    expect(amount("x", "M")).toBeNull();
  });
});

describe("factsPayload", () => {
  it("builds the route's body", () => {
    const parsed = parseDilutionTracker(page("China", "The company has 4.8 months of cash left based on quarterly cash burn of -$1.94M and estimated current cash of $3.1M."));
    expect(factsPayload("ABLV", parsed)).toEqual({
      ticker: "ABLV",
      notFound: false,
      country: "China",
      cashUsd: 3_100_000,
      cashMonthsLeft: 4.8,
      cashFlowPositive: false,
      instOwnPct: 0.1,
    });
    expect(factsPayload("ZZZQ", parseDilutionTracker("POPULAR TICKERS"))).toMatchObject({ ticker: "ZZZQ", notFound: true, country: null });
  });
});

describe("lookup program limits", () => {
  it("opens only DilutionTracker search pages", () => {
    expect(lookupUrl("AEHL")).toBe("https://dilutiontracker.com/app/search/AEHL");
    expect(lookupUrl("BRK.B")).toBe("https://dilutiontracker.com/app/search/BRK.B");
    expect(() => lookupUrl("../logout")).toThrow();
    expect(() => lookupUrl("aehl")).toThrow();
  });
  it("keeps 3 seconds between pages and at most 60 an hour", () => {
    const pacer = createPacer();
    let now = 1_000_000;
    expect(pacer.wait(now)).toBe(0);
    pacer.started(now);
    expect(pacer.wait(now + 1000)).toBe(2000);
    for (let i = 1; i < 60; i++) {
      now += 3000;
      expect(pacer.wait(now)).toBe(0);
      pacer.started(now);
    }
    // The 61st waits until the first is an hour old.
    expect(pacer.wait(now + 3000)).toBe(1_000_000 + 3_600_000 - (now + 3000));
    expect(pacer.wait(1_000_000 + 3_600_000)).toBe(0);
  });
  it("waits longer after each failure", () => {
    const backoff = createBackoff();
    expect(backoff.ready("AEHL", 0)).toBe(true);
    backoff.failed("AEHL", 0);
    expect(backoff.ready("AEHL", 119_999)).toBe(false);
    expect(backoff.ready("AEHL", 120_000)).toBe(true);
    backoff.failed("AEHL", 120_000);
    expect(backoff.ready("AEHL", 120_000 + 239_999)).toBe(false);
    backoff.succeeded("AEHL");
    expect(backoff.ready("AEHL", 120_001)).toBe(true);
  });
  it("knows the market's hours in New York", () => {
    expect(marketHours(Date.parse("2026-11-06T09:30:00Z"))).toBe(true); // Fri 4:30 AM EST
    expect(marketHours(Date.parse("2026-11-06T08:30:00Z"))).toBe(false); // Fri 3:30 AM EST
    expect(marketHours(Date.parse("2026-11-07T15:00:00Z"))).toBe(false); // Saturday
    expect(marketHours(Date.parse("2026-11-07T00:59:00Z"))).toBe(true); // Fri 7:59 PM EST
  });
});
