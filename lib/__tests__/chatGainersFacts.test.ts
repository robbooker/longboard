import { describe, expect, it } from "vitest";
import {
  CFP,
  CFP_WORDS,
  GAINERS_COLUMNS,
  GAINERS_DETAIL_COLUMNS,
  GAINERS_PHONE_COLUMNS,
  cashAmount,
  cashLabel,
  countryCell,
  countryLabel,
  countryShort,
  easternDay,
  instOwnLabel,
  localClock,
  minutesSince,
  nextSort,
  parseGainersFacts,
  parseSort,
  sortRows,
  sortValue,
  splitCfp,
  tableRow,
  updatedAt,
  updatedTitle,
  type GainersTableDbRow,
  type GainersTableRow,
} from "@/lib/chatGainersFacts";
import type { GainersBorrow } from "@/lib/chatGainersBorrow";

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
  it("keeps a computer's columns as they were, without IB avail and with Updated (#412), headed ON fee and Time (#429)", () => {
    expect(names(GAINERS_COLUMNS)).toEqual([
      "Price",
      "% today",
      "Volume",
      "Borrow at TZ",
      "ON fee",
      "Min since alert",
      "Time",
      "Country",
      "Cash left",
      "Inst Own %",
    ]);
  });
  it("shows Price, % today, Country and Borrow at TZ on a phone, in that order", () => {
    expect(names(GAINERS_PHONE_COLUMNS)).toEqual(["Price", "% today", "Country", "Borrow at TZ"]);
  });
  it("puts every other column in the details, once, in a computer's order", () => {
    expect(names(GAINERS_DETAIL_COLUMNS)).toEqual(["Volume", "ON fee", "Min since alert", "Time", "Cash left", "Inst Own %"]);
    const keys = (columns: readonly { key: string }[]) => columns.map((column) => column.key).sort();
    expect(keys([...GAINERS_PHONE_COLUMNS, ...GAINERS_DETAIL_COLUMNS])).toEqual(keys(GAINERS_COLUMNS));
  });
});

describe("Gainers Table short headings and country names (#429)", () => {
  const column = (key: string) => GAINERS_COLUMNS.find((c) => c.key === key)!;
  it("heads the IB fee column ON fee and the refreshed column Time, each explained on hover", () => {
    expect(column("ibFee")).toMatchObject({ name: "ON fee", title: "ON fee: Interactive Brokers’ yearly overnight borrow rate" });
    expect(column("updated")).toMatchObject({ name: "Time", title: "Time: when this row’s company facts or TradeZero borrow were last checked (your time)" });
  });
  it("leaves a name of five characters or fewer alone", () => {
    for (const name of ["U.S.", "China", "Japan", "India", "Spain", "Peru", "Chile", "Italy", "Macau", "UK"]) expect(countryShort(name)).toBe(name);
  });
  it("shortens every listed country to five characters at most", () => {
    const listed: [string, string][] = [
      ["Hong Kong", "HK"], ["China Hong Kong", "CN/HK"], ["Singapore", "SG"], ["United Kingdom", "U.K."],
      ["United Arab Emirates", "UAE"], ["British Virgin Islands", "BVI"], ["Cayman Islands", "CYM"], ["New Zealand", "NZ"],
      ["South Korea", "KOR"], ["South Africa", "RSA"], ["Marshall Islands", "MHL"], ["Isle of Man", "IOM"],
      ["Canada", "CAN"], ["Malaysia", "MYS"], ["Israel", "ISR"], ["Australia", "AUS"], ["Austria", "AUT"],
      ["Taiwan", "TWN"], ["Greece", "GRC"], ["Netherlands", "NLD"], ["Luxembourg", "LUX"], ["Denmark", "DNK"],
      ["Germany", "GER"], ["Cyprus", "CYP"], ["Ireland", "IRL"], ["Mexico", "MEX"], ["Brazil", "BRA"],
      ["Philippines", "PHL"], ["Switzerland", "SUI"], ["Cambodia", "CAM"], ["France", "FRA"], ["Sweden", "SWE"],
      ["Norway", "NOR"], ["Finland", "FIN"], ["Belgium", "BEL"], ["Argentina", "ARG"], ["Colombia", "COL"],
      ["Thailand", "THA"], ["Indonesia", "IDN"], ["Vietnam", "VNM"], ["Turkey", "TUR"], ["Kazakhstan", "KAZ"],
      ["Bermuda", "BMU"], ["Bahamas", "BHS"], ["Panama", "PAN"], ["Uruguay", "URU"], ["Nigeria", "NGA"],
      ["Jordan", "JOR"], ["Russia", "RUS"], ["Portugal", "POR"], ["Poland", "POL"], ["Monaco", "MCO"],
      ["Jersey", "JEY"], ["Guernsey", "GGY"], ["Liechtenstein", "LIE"],
    ];
    expect(listed).toHaveLength(55);
    for (const [name, short] of listed) {
      expect(countryShort(name), name).toBe(short);
      expect(short.length, name).toBeLessThanOrEqual(5);
    }
    // No two listed countries share a short form.
    expect(new Set(listed.map(([, short]) => short)).size).toBe(listed.length);
  });
  it("reads a listed name whatever its capitals or spacing", () => {
    expect(countryShort("  cayman  islands ")).toBe("CYM");
    expect(countryShort("SINGAPORE")).toBe("SG");
    expect(countryShort(" China ")).toBe("China");
  });
  it("shortens a long name it doesn't know: initials for several words, three letters for one", () => {
    expect(countryShort("Costa Rica")).toBe("CR");
    expect(countryShort("Saudi Arabia")).toBe("SA");
    expect(countryShort("Trinidad and Tobago")).toBe("TAT");
    expect(countryShort("Democratic Republic of the Congo and Friends")).toBe("DROTC");
    expect(countryShort("Iceland")).toBe("ICE");
    expect(countryShort("Mongolia")).toBe("MON");
    expect(countryShort("Egypt")).toBe("Egypt");
  });
  it("gives the cell its short label and the whole name for the title, only when shortened", () => {
    expect(countryCell({ ...base, country: "Cayman Islands", countryChecked: true })).toEqual({ label: "CYM", full: "Cayman Islands" });
    expect(countryCell({ ...base, country: "Singapore", countryChecked: true })).toEqual({ label: "SG", full: "Singapore" });
    expect(countryCell({ ...base, country: "China", countryChecked: true })).toEqual({ label: "China", full: null });
    expect(countryCell({ ...base, country: "U.S.", countryChecked: true })).toEqual({ label: "U.S.", full: null });
  });
  it("never shortens looking up… or —", () => {
    expect(countryCell(base)).toEqual({ label: "looking up…", full: null });
    expect(countryCell({ ...base, countryChecked: true })).toEqual({ label: "—", full: null });
    expect(countryCell({ ...base, notFound: true })).toEqual({ label: "—", full: null });
  });
  it("still sorts by the whole name, not the short form", () => {
    const row = (sym: string, country: string | null): GainersTableRow => ({ ...base, sym, country, countryChecked: true });
    // Short forms would put SUI before SWE and U.K. before U.S.; whole names say otherwise.
    const rows = [row("SWIS", "Switzerland"), row("SWED", "Sweden"), row("USAA", "U.S."), row("BRIT", "United Kingdom"), row("NONE", null), row("CAYM", "Cayman Islands")];
    expect(sortValue("country", rows[0])).toBe("Switzerland");
    expect(sortRows(rows, { key: "country", dir: "asc" }).map((r) => r.sym)).toEqual(["CAYM", "SWED", "SWIS", "USAA", "BRIT", "NONE"]);
    expect(sortRows(rows, { key: "country", dir: "desc" }).map((r) => r.sym)).toEqual(["BRIT", "USAA", "SWIS", "SWED", "CAYM", "NONE"]);
  });
});

const borrow = (over: Partial<GainersBorrow>): GainersBorrow => ({
  status: "offered",
  etb: false,
  pricePerShare: 0.04,
  locateType: "Locate",
  checkedAt: "2026-11-06T14:40:00.000Z",
  attemptedAt: "2026-11-06T14:40:00.000Z",
  ...over,
});
const row = (sym: string, alertAt: string, over: Partial<GainersTableRow> = {}): GainersTableRow => ({
  ...base,
  sym,
  lastAlertAt: alertAt,
  ...over,
});
const syms = (rows: GainersTableRow[]) => rows.map((r) => r.sym);

describe("Gainers Table sorting (#412)", () => {
  const rows = [
    row("AAA", "2026-11-06T14:00:00.000Z", { quote: { price: 2.5, changePct: 52.3, volume: 1_200_000 }, country: "China", cashUsd: 3e6, instOwnPct: 4, borrow: borrow({ status: "etb", etb: true, pricePerShare: null, locateType: null, checkedAt: "2026-11-06T14:45:00.000Z" }), ib: { feePct: 1390, rebatePct: null, available: null, availableMore: false, fileTime: "2026-11-06T14:00:00.000Z" } }),
    row("BBB", "2026-11-06T14:30:00.000Z", { quote: { price: 0.4512, changePct: -12.3, volume: 850_000 }, country: "U.S.", cashUsd: 31.5e6, instOwnPct: 12.5, borrow: borrow({ pricePerShare: 0.0725 }), ib: { feePct: 8.9, rebatePct: null, available: null, availableMore: false, fileTime: "2026-11-06T14:00:00.000Z" } }),
    row("CCC", "2026-11-06T14:10:00.000Z", { quote: null, borrow: null, ib: null }),
    row("DDD", "2026-11-06T14:20:00.000Z", { quote: { price: 10, changePct: 100, volume: null }, country: "british Virgin Islands", borrow: borrow({ status: "none", pricePerShare: null, locateType: null }) }),
  ];

  it("defaults to newest alert first", () => {
    expect(syms(sortRows(rows, null))).toEqual(["BBB", "DDD", "CCC", "AAA"]);
    expect(syms(rows)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });
  it("sorts numbers numerically, with missing values last both ways", () => {
    expect(syms(sortRows(rows, { key: "price", dir: "desc" }))).toEqual(["DDD", "AAA", "BBB", "CCC"]);
    expect(syms(sortRows(rows, { key: "price", dir: "asc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "change", dir: "desc" }))).toEqual(["DDD", "AAA", "BBB", "CCC"]);
    expect(syms(sortRows(rows, { key: "change", dir: "asc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    // Two missing volumes keep the default order between them (DDD's alert is newer than CCC's).
    expect(syms(sortRows(rows, { key: "volume", dir: "desc" }))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "volume", dir: "asc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "ibFee", dir: "asc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "cash", dir: "desc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "instOwn", dir: "asc" }))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
  });
  it("sorts borrow from easy to borrow, by price, to none offered; unchecked last", () => {
    expect(syms(sortRows(rows, { key: "borrow", dir: "asc" }))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "borrow", dir: "desc" }))).toEqual(["DDD", "BBB", "AAA", "CCC"]);
    expect(sortValue("borrow", row("X", base.lastAlertAt, { borrow: borrow({ status: "error", pricePerShare: null, locateType: null, checkedAt: null }) }))).toBeNull();
  });
  it("sorts words alphabetically, ignoring case, with missing ones last", () => {
    expect(syms(sortRows(rows, { key: "country", dir: "asc" }))).toEqual(["DDD", "AAA", "BBB", "CCC"]);
    expect(syms(sortRows(rows, { key: "country", dir: "desc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "symbol", dir: "desc" }))).toEqual(["DDD", "CCC", "BBB", "AAA"]);
  });
  it("sorts minutes since alert and updated by time", () => {
    expect(syms(sortRows(rows, { key: "minutes", dir: "asc" }))).toEqual(["BBB", "DDD", "CCC", "AAA"]);
    expect(syms(sortRows(rows, { key: "minutes", dir: "desc" }))).toEqual(["AAA", "CCC", "DDD", "BBB"]);
    // AAA's alert is 14:00 but its borrow was checked 14:45: the most recently updated. BBB and DDD
    // were both checked 14:40 (a tie keeps newest alert first); CCC only has its 14:10 alert.
    expect(syms(sortRows(rows, { key: "updated", dir: "desc" }))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
  });
  it("cycles a heading: first way, reversed, then back to newest first", () => {
    expect(nextSort(null, "price")).toEqual({ key: "price", dir: "desc" });
    expect(nextSort({ key: "price", dir: "desc" }, "price")).toEqual({ key: "price", dir: "asc" });
    expect(nextSort({ key: "price", dir: "asc" }, "price")).toBeNull();
    expect(nextSort(null, "country")).toEqual({ key: "country", dir: "asc" });
    expect(nextSort({ key: "country", dir: "asc" }, "country")).toEqual({ key: "country", dir: "desc" });
    expect(nextSort({ key: "country", dir: "asc" }, "volume")).toEqual({ key: "volume", dir: "desc" });
  });
  it("reads back only a real remembered choice", () => {
    expect(parseSort(JSON.stringify({ key: "borrow", dir: "asc" }))).toEqual({ key: "borrow", dir: "asc" });
    for (const bad of [null, undefined, "", "{", "null", "[]", JSON.stringify({ key: "ibAvail", dir: "asc" }), JSON.stringify({ key: "price", dir: "up" }), 5])
      expect(parseSort(bad)).toBeNull();
  });
});

describe("Gainers Table re-alerts (#412)", () => {
  const db = (ticker: string, last: string, alerts = 1): GainersTableDbRow => ({
    ticker,
    last_alert_at: last,
    alerts,
    country: null,
    country_checked_at: null,
    cash_usd: null,
    cash_months_left: null,
    cash_flow_positive: false,
    cash_checked_at: null,
    inst_own_pct: null,
    inst_own_checked_at: null,
    not_found: false,
    checked_at: null,
  });
  it("puts a stock that alerted again back on top, its minutes counted from the latest alert", () => {
    // OLD first alerted at 9:00 and again at 9:50; NEW alerted once at 9:40.
    const rows = [db("NEW", "2026-11-06T14:40:00Z"), db("OLD", "2026-11-06T14:50:00Z", 2)].map(tableRow);
    const sorted = sortRows(rows, null);
    expect(syms(sorted)).toEqual(["OLD", "NEW"]);
    const now = Date.parse("2026-11-06T14:55:00Z");
    expect(minutesSince(sorted[0].lastAlertAt, now)).toBe(5);
    expect(minutesSince(sorted[1].lastAlertAt, now)).toBe(15);
  });
});

describe("Gainers Table Updated (#412)", () => {
  const at = "2026-11-06T14:30:00.000Z";
  it("is the latest of the facts lookup and the borrow check, or the alert before either", () => {
    expect(updatedAt(row("A", at))).toBe(at);
    // A check before this latest alert doesn't count: the alert is newer.
    expect(updatedAt(row("A", at, { factsCheckedAt: "2026-10-31T12:00:00.000Z", borrow: borrow({ checkedAt: "2026-11-06T14:00:00.000Z" }) }))).toBe(at);
    expect(updatedAt(row("A", at, { factsCheckedAt: "2026-11-06T14:35:00.000Z", borrow: borrow({ checkedAt: "2026-11-06T14:42:00.000Z" }) }))).toBe("2026-11-06T14:42:00.000Z");
    expect(updatedAt(row("A", at, { factsCheckedAt: "2026-11-06T14:45:00.000Z", borrow: borrow({ checkedAt: null }) }))).toBe("2026-11-06T14:45:00.000Z");
  });
  const db: GainersTableDbRow = { ticker: "A", last_alert_at: at, alerts: 1, country: null, country_checked_at: null, cash_usd: null, cash_months_left: null, cash_flow_positive: false, cash_checked_at: null, inst_own_pct: null, inst_own_checked_at: null, not_found: false, checked_at: "2026-11-06T14:45:00+00:00" };
  it("keeps the facts lookup's time from the database row", () => {
    expect(tableRow(db).factsCheckedAt).toBe("2026-11-06T14:45:00.000Z");
    expect(tableRow({ ...db, checked_at: null }).factsCheckedAt).toBeNull();
  });
  it("marks a row whose latest alert was after hours, and reads an older database row as not", () => {
    expect(tableRow({ ...db, last_after_hours: true }).lastAfterHours).toBe(true);
    expect(tableRow({ ...db, last_after_hours: false }).lastAfterHours).toBe(false);
    expect(tableRow(db).lastAfterHours).toBe(false);
  });
  it("shows a short clock in the viewer's time, without seconds or AM/PM", () => {
    expect(localClock("2026-11-06T14:42:31.000Z", "en-US", "America/Chicago")).toBe("8:42");
    expect(localClock("2026-11-06T19:05:00.000Z", "en-US", "America/New_York")).toBe("2:05");
    expect(localClock("2026-11-06T19:05:00.000Z", "en-GB", "Europe/London")).toBe("19:05");
    expect(updatedTitle("2026-11-06T14:42:31.000Z", "en-US", "America/Chicago")).toMatch(/^Updated 8:42\sAM$/);
  });
});
