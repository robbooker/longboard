import { describe, expect, it } from "vitest";
import {
  CFP,
  CFP_WORDS,
  GAINERS_COLUMNS,
  GAINERS_DETAIL_COLUMNS,
  GAINERS_PHONE_COLUMNS,
  cashAmount,
  cashLabel,
  countryLabel,
  easternDay,
  instOwnLabel,
  minutesSince,
  parseGainersFacts,
  splitCfp,
  type GainersTableRow,
} from "@/lib/chatGainersFacts";

const base: GainersTableRow = {
  sym: "AEHL",
  lastAlertAt: "2026-11-06T14:30:00.000Z",
  alerts: 1,
  country: null,
  countryChecked: false,
  cashUsd: null,
  cashMonthsLeft: null,
  cashFlowPositive: false,
  cashChecked: false,
  instOwnPct: null,
  instOwnChecked: false,
  notFound: false,
};

describe("Gainers Table labels (#371)", () => {
  it("shows cash the way Rob wrote it", () => {
    expect(cashLabel({ ...base, cashUsd: 31_500_000, cashMonthsLeft: 304.7, cashChecked: true })).toBe("$31.5M · 304 mo");
    expect(cashLabel({ ...base, cashUsd: 3_100_000, cashMonthsLeft: 4.8, cashChecked: true })).toBe("$3.1M · 4 mo");
    expect(cashLabel({ ...base, cashUsd: 48_300_000, cashMonthsLeft: 1204.5, cashChecked: true })).toBe("$48.3M · 1,204 mo");
    expect(cashLabel({ ...base, cashUsd: 2_000_000, cashChecked: true })).toBe("$2M");
    expect(cashLabel({ ...base, cashFlowPositive: true, cashChecked: true })).toBe("CFP");
    expect(cashLabel({ ...base, cashFlowPositive: true, cashUsd: 850_000, cashChecked: true })).toBe("$850K · CFP");
    expect(cashLabel({ ...base, cashChecked: true })).toBe("—");
    expect(cashLabel(base)).toBe("looking up…");
    expect(cashLabel({ ...base, notFound: true })).toBe("—");
  });
  it("shows amounts", () => {
    expect(cashAmount(1_250_000_000)).toBe("$1.3B");
    expect(cashAmount(123_456_789)).toBe("$123M");
    expect(cashAmount(1_500)).toBe("$1.5K");
  });
  it("shows country and ownership, or looking up", () => {
    expect(countryLabel({ ...base, country: "U.S.", countryChecked: true })).toBe("U.S.");
    expect(countryLabel(base)).toBe("looking up…");
    expect(countryLabel({ ...base, countryChecked: true })).toBe("—");
    expect(instOwnLabel({ ...base, instOwnPct: 0.1, instOwnChecked: true })).toBe("0.1%");
    expect(instOwnLabel({ ...base, instOwnPct: 43, instOwnChecked: true })).toBe("43%");
    expect(instOwnLabel(base)).toBe("looking up…");
  });
  it("counts whole minutes, never below zero", () => {
    const at = "2026-11-06T14:30:00.000Z";
    expect(minutesSince(at, Date.parse(at) + 59_999)).toBe(0);
    expect(minutesSince(at, Date.parse(at) + 60_000)).toBe(1);
    expect(minutesSince(at, Date.parse(at) - 5000)).toBe(0);
  });
  it("uses the Eastern day", () => {
    expect(easternDay(Date.parse("2026-11-07T04:30:00Z"))).toBe("2026-11-06");
    expect(easternDay(Date.parse("2026-11-07T05:30:00Z"))).toBe("2026-11-07");
  });
});

describe("parseGainersFacts", () => {
  const good = { ticker: "AEHL", notFound: false, country: " China ", cashUsd: 1, cashMonthsLeft: 2, cashFlowPositive: false, instOwnPct: 3 };
  it("takes a good result and trims the country", () => {
    expect(parseGainersFacts(good)).toEqual({ ...good, country: "China" });
  });
  it("empties everything for a ticker that wasn't found", () => {
    expect(parseGainersFacts({ ...good, notFound: true })).toEqual({
      ticker: "AEHL",
      notFound: true,
      country: null,
      cashUsd: null,
      cashMonthsLeft: null,
      cashFlowPositive: false,
      instOwnPct: null,
    });
  });
  it("refuses anything off", () => {
    for (const bad of [
      null,
      [],
      "x",
      { ...good, ticker: "aehl" },
      { ...good, ticker: "TOOLONGTICKER1" },
      { ...good, country: "<b>" },
      { ...good, country: "" },
      { ...good, country: "x".repeat(61) },
      { ...good, cashUsd: Number.NaN },
      { ...good, cashUsd: "1" },
      { ...good, instOwnPct: 1001 },
      { ...good, cashFlowPositive: null },
      { ...good, more: 1 },
    ])
      expect(parseGainersFacts(bad)).toBeNull();
  });
});

describe("Gainers Table CFP (#394)", () => {
  it("shortens cash flow positive to CFP, with or without an amount", () => {
    expect(CFP).toBe("CFP");
    expect(CFP_WORDS).toBe("Cash Flow Positive");
    expect(cashLabel({ ...base, cashFlowPositive: true, cashChecked: true })).not.toMatch(/cash flow/i);
  });
  it("splits out the CFP part only", () => {
    expect(splitCfp("CFP")).toEqual({ before: "", cfp: true });
    expect(splitCfp("$850K · CFP")).toEqual({ before: "$850K · ", cfp: true });
    for (const label of ["$31.5M · 304 mo", "$2M", "—", "looking up…", "CFPX", "Cash flow positive"])
      expect(splitCfp(label)).toEqual({ before: label, cfp: false });
  });
});

describe("Gainers Table phone columns (#398)", () => {
  const names = (columns: readonly { name: string }[]) => columns.map((column) => column.name);
  it("keeps a computer's columns as they were", () => {
    expect(names(GAINERS_COLUMNS)).toEqual([
      "Price",
      "% today",
      "Volume",
      "Borrow at TZ",
      "IB overnight fee",
      "IB avail",
      "Min since alert",
      "Country",
      "Cash left",
      "Inst Own %",
    ]);
  });
  it("shows Price, % today, Country and Borrow at TZ on a phone, in that order", () => {
    expect(names(GAINERS_PHONE_COLUMNS)).toEqual(["Price", "% today", "Country", "Borrow at TZ"]);
  });
  it("puts every other column in the details, once, in a computer's order", () => {
    expect(names(GAINERS_DETAIL_COLUMNS)).toEqual(["Volume", "IB overnight fee", "IB avail", "Min since alert", "Cash left", "Inst Own %"]);
    const keys = (columns: readonly { key: string }[]) => columns.map((column) => column.key).sort();
    expect(keys([...GAINERS_PHONE_COLUMNS, ...GAINERS_DETAIL_COLUMNS])).toEqual(keys(GAINERS_COLUMNS));
  });
});
