import { describe, expect, it } from "vitest";
import {
  borrowLabel,
  borrowNeeded,
  borrowPrice,
  borrowTableLabel,
  borrowTablePrice,
  borrowTitle,
  parseGainersBorrow,
  type GainersBorrow,
} from "@/lib/chatGainersBorrow";
import { borrowDue, createBorrowSchedule, readTradeZeroEnv } from "../../scripts/gainers-lookup/lookup.mjs";

// #373: when a ticker is checked again, what the route takes, and how the table shows it.
const NOW = Date.parse("2026-11-06T15:00:00Z"); // 10:00 AM in New York, a Friday
const min = (m: number) => new Date(NOW - m * 60_000).toISOString();
const result = (extra: Partial<GainersBorrow> = {}): GainersBorrow => ({
  status: "offered",
  etb: false,
  pricePerShare: 0.04,
  locateType: "Locate",
  checkedAt: min(20),
  attemptedAt: min(20),
  ...extra,
});

describe("borrow schedule (#373)", () => {
  it("checks a ticker the first time it shows up, however long ago it alerted", () => {
    expect(borrowNeeded(min(1), null, NOW)).toBe(true);
    expect(borrowNeeded(min(300), undefined, NOW)).toBe(true);
  });
  it("then every 15 minutes while it is still alerting", () => {
    expect(borrowNeeded(min(5), result({ checkedAt: min(14), attemptedAt: min(14) }), NOW)).toBe(false);
    expect(borrowNeeded(min(5), result({ checkedAt: min(15), attemptedAt: min(15) }), NOW)).toBe(true);
    expect(borrowNeeded(min(60), result(), NOW)).toBe(true);
    // ETB is re-checked on the same clock.
    expect(borrowNeeded(min(5), result({ status: "etb", etb: true, pricePerShare: null, locateType: null }), NOW)).toBe(true);
  });
  it("not once its last alert is over an hour old", () => {
    expect(borrowNeeded(min(61), result(), NOW)).toBe(false);
    expect(borrowNeeded(min(61), result({ status: "error", checkedAt: null }), NOW)).toBe(false);
  });
  it("after an error, again in 5 minutes", () => {
    const failed = result({ status: "error", pricePerShare: null, locateType: null, checkedAt: null, attemptedAt: min(4) });
    expect(borrowNeeded(min(2), failed, NOW)).toBe(false);
    expect(borrowNeeded(min(2), { ...failed, attemptedAt: min(5) }, NOW)).toBe(true);
    // A failed re-check of a known result also comes back sooner.
    expect(borrowNeeded(min(2), result({ checkedAt: min(30), attemptedAt: min(6) }), NOW)).toBe(true);
  });

  it("the lookup program only acts in market hours and never twice in 5 minutes", () => {
    const schedule = createBorrowSchedule();
    const list = [{ ticker: "AAA" }, { ticker: "BBB" }, { ticker: "bad!" }, null];
    expect(borrowDue(list, schedule, NOW)).toEqual(["AAA", "BBB"]);
    schedule.started("AAA", NOW);
    expect(borrowDue(list, schedule, NOW + 60_000)).toEqual(["BBB"]);
    expect(borrowDue(list, schedule, NOW + 5 * 60_000)).toEqual(["AAA", "BBB"]);
    // 3:59 AM and 8:00 PM in New York, and a Saturday: nothing.
    expect(borrowDue(list, createBorrowSchedule(), Date.parse("2026-11-06T08:59:00Z"))).toEqual([]);
    expect(borrowDue(list, createBorrowSchedule(), Date.parse("2026-11-06T09:00:00Z"))).toEqual(["AAA", "BBB"]);
    expect(borrowDue(list, createBorrowSchedule(), Date.parse("2026-11-07T01:00:00Z"))).toEqual([]);
    expect(borrowDue(list, createBorrowSchedule(), Date.parse("2026-11-07T15:00:00Z"))).toEqual([]);
    expect(borrowDue(undefined, createBorrowSchedule(), NOW)).toEqual([]);
  });

  it("reads TradeZero's env file in either naming", () => {
    expect(readTradeZeroEnv("TRADEZERO_API_KEY_ID=a\nTRADEZERO_API_SECRET_KEY='b'\nTRADEZERO_ACCOUNT_ID=c\n# x=y\n")).toEqual({
      keyId: "a",
      secret: "b",
      accountId: "c",
      baseUrl: undefined,
    });
    expect(readTradeZeroEnv('export TZ_API_KEY_ID=a\nTZ_API_SECRET="b"\nTZ_API_BASE_URL=https://x.test\n')).toEqual({
      keyId: "a",
      secret: "b",
      accountId: "",
      baseUrl: "https://x.test",
    });
  });
});

describe("borrow results on the way in (#373)", () => {
  const good = { kind: "borrow", ticker: "ABCD", status: "offered", etb: false, pricePerShare: 0.04, locateType: "PreBorrow" };
  it("takes each status with what it means", () => {
    expect(parseGainersBorrow(good)).toEqual({ ticker: "ABCD", status: "offered", etb: false, pricePerShare: 0.04, locateType: "PreBorrow" });
    expect(parseGainersBorrow({ ...good, status: "etb", etb: true, pricePerShare: null, locateType: null })).not.toBeNull();
    expect(parseGainersBorrow({ ...good, status: "none", pricePerShare: null, locateType: null })).not.toBeNull();
    expect(parseGainersBorrow({ ...good, status: "error", etb: null, pricePerShare: null, locateType: null })).not.toBeNull();
  });
  it("refuses anything off", () => {
    for (const bad of [
      { ...good, kind: "facts" },
      { ...good, ticker: "abcd" },
      { ...good, status: "maybe" },
      { ...good, pricePerShare: 0 },
      { ...good, pricePerShare: -1 },
      { ...good, pricePerShare: 1001 },
      { ...good, pricePerShare: "0.04" },
      { ...good, locateType: "Other" },
      { ...good, locateType: null },
      { ...good, etb: true },
      { ...good, status: "etb", etb: false, pricePerShare: null, locateType: null },
      { ...good, status: "none", pricePerShare: 0.04 },
      { ...good, status: "error", pricePerShare: 0.04 },
      { ...good, extra: 1 },
      { kind: "borrow", ticker: "ABCD" },
      [good],
      null,
    ])
      expect(parseGainersBorrow(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("Borrow at TZ cell (#373)", () => {
  it("shows ETB, the price, None, or checking…", () => {
    expect(borrowLabel(null)).toBe("checking…");
    expect(borrowLabel(result({ status: "etb", etb: true, pricePerShare: null, locateType: null }))).toBe("ETB");
    expect(borrowLabel(result())).toBe("$0.04");
    expect(borrowLabel(result({ status: "none", pricePerShare: null, locateType: null }))).toBe("None");
    expect(borrowLabel(result({ status: "error", pricePerShare: null, locateType: null, checkedAt: null }))).toBe("—");
  });
  it("prices with two to four decimals", () => {
    expect(borrowPrice(0.04)).toBe("$0.04");
    expect(borrowPrice(0.0125)).toBe("$0.0125");
    expect(borrowPrice(0.015)).toBe("$0.015");
    expect(borrowPrice(0.123456)).toBe("$0.1235");
    expect(borrowPrice(1.5)).toBe("$1.50");
  });
  it("#412: the Gainers Table drops the dollar sign and the leading zero, nothing else", () => {
    expect(borrowTablePrice(0.0045)).toBe(".0045");
    expect(borrowTablePrice(0.12)).toBe(".12");
    expect(borrowTablePrice(1.25)).toBe("1.25");
    expect(borrowTablePrice(0.04)).toBe(".04");
    expect(borrowTablePrice(0.015)).toBe(".015");
    expect(borrowTablePrice(0.123456)).toBe(".1235");
    expect(borrowTablePrice(1.5)).toBe("1.50");
    expect(borrowTablePrice(10.5)).toBe("10.50");
    expect(borrowTablePrice(1000)).toBe("1,000.00");
    expect(borrowTableLabel(result({ pricePerShare: 0.0045 }))).toBe(".0045");
    expect(borrowTableLabel(null)).toBe("checking…");
    expect(borrowTableLabel(result({ status: "etb", etb: true, pricePerShare: null, locateType: null }))).toBe("ETB");
    expect(borrowTableLabel(result({ status: "none", pricePerShare: null, locateType: null }))).toBe("None");
    expect(borrowTableLabel(result({ status: "error", pricePerShare: null, locateType: null, checkedAt: null }))).toBe("—");
    // Elsewhere (the Stock Club card) keeps its dollar sign.
    expect(borrowLabel(result({ pricePerShare: 0.0045 }))).toBe("$0.0045");
  });
  it("says when it was checked, New York time", () => {
    expect(borrowTitle(result({ checkedAt: "2026-11-06T14:42:00Z" }))).toBe("checked 9:42");
    expect(borrowTitle(result({ checkedAt: "2026-11-06T14:42:00Z", locateType: "SingleUse" }))).toBe("checked 9:42 · single-use");
    expect(borrowTitle(result({ status: "etb", locateType: null, checkedAt: "2026-11-06T18:05:00Z" }))).toBe("checked 1:05");
    expect(borrowTitle(result({ status: "error", checkedAt: null, attemptedAt: "2026-11-06T14:42:00Z" }))).toBe("couldn’t check, tried 9:42");
    expect(borrowTitle(null)).toBe("Not checked at TradeZero yet");
  });
});
