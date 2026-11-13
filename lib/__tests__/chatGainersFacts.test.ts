import { describe, expect, it } from "vitest";
import {
  CFP,
  CFP_WORDS,
  GAINERS_COLUMNS,
  GAINERS_DETAIL_COLUMNS,
  GAINERS_PHONE_COLUMNS,
  cashAmount,
  cashLabel,
  countryBlock,
  countryCode,
  countryShort,
  easternDay,
  gainersRowLeftOff,
  instOwnLabel,
  localClock,
  marketCapLabel,
  marketCapUsd,
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
  it("shows ownership, or looking up", () => {
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
  it("keeps a computer's columns as they were, without IB avail and with Updated (#412), headed Time (#429), Min and Inst % (#432), with Market Cap in ON fee's place (#442)", () => {
    expect(names(GAINERS_COLUMNS)).toEqual([
      "Price",
      "% today",
      "Volume",
      "Borrow at TZ",
      "Market Cap",
      "Min",
      "Time",
      "Cash left",
      "Inst %",
    ]);
  });
  it("shows Price, % today and Borrow at TZ on a phone, in that order (#451: no Country column)", () => {
    expect(names(GAINERS_PHONE_COLUMNS)).toEqual(["Price", "% today", "Borrow at TZ"]);
  });
  it("puts every other column in the details, once, in a computer's order", () => {
    expect(names(GAINERS_DETAIL_COLUMNS)).toEqual(["Volume", "Market Cap", "Min", "Time", "Cash left", "Inst %"]);
    const keys = (columns: readonly { key: string }[]) => columns.map((column) => column.key).sort();
    expect(keys([...GAINERS_PHONE_COLUMNS, ...GAINERS_DETAIL_COLUMNS])).toEqual(keys(GAINERS_COLUMNS));
  });
});

describe("Gainers Table short headings (#429)", () => {
  const column = (key: string) => GAINERS_COLUMNS.find((c) => c.key === key)!;
  it("heads the refreshed column Time, explained on hover", () => {
    expect(column("updated")).toMatchObject({ name: "Time", title: "Time: when this row’s company facts or TradeZero borrow were last checked (your time)" });
  });
  it("heads the minutes column Min and the institutions column Inst %, each explained on hover (#432)", () => {
    expect(column("minutes")).toMatchObject({ name: "Min", title: "Min: minutes since the stock last alerted" });
    expect(column("instOwn")).toMatchObject({ name: "Inst %", title: "Inst %: share of the company owned by institutions" });
    // The old, longer names are gone from the table and from a phone's details.
    const names = GAINERS_COLUMNS.map((c) => c.name);
    expect(names).not.toContain("Min since alert");
    expect(names).not.toContain("Inst Own %");
  });
});

describe("Gainers Table country block under the symbol (#451)", () => {
  const checked = (country: string | null): GainersTableRow => ({ ...base, country, countryChecked: true });
  it("has no Country column on a computer or a phone, nor in a phone's details", () => {
    for (const columns of [GAINERS_COLUMNS, GAINERS_PHONE_COLUMNS, GAINERS_DETAIL_COLUMNS]) {
      expect(columns.map((c) => c.key as string)).not.toContain("country");
      expect(columns.map((c) => c.name)).not.toContain("Country");
    }
  });
  it("maps every country name the data uses to its ISO 3166 alpha-2 code", () => {
    const names: [string, string][] = [
      ["China", "CN"], ["Hong Kong", "HK"], ["China Hong Kong", "HK"], ["Macau", "MO"], ["Macao", "MO"],
      ["Singapore", "SG"], ["Canada", "CA"], ["Israel", "IL"], ["Malaysia", "MY"], ["Australia", "AU"],
      ["United Kingdom", "GB"], ["Greece", "GR"], ["Japan", "JP"], ["Taiwan", "TW"], ["Cayman Islands", "KY"],
      ["Cyprus", "CY"], ["Netherlands", "NL"], ["Luxembourg", "LU"], ["Denmark", "DK"], ["Germany", "DE"],
      ["Switzerland", "CH"], ["Ireland", "IE"], ["British Virgin Islands", "VG"], ["Peru", "PE"], ["Brazil", "BR"],
      ["Philippines", "PH"], ["Mexico", "MX"], ["Spain", "ES"], ["United Arab Emirates", "AE"], ["Cambodia", "KH"],
      ["India", "IN"], ["France", "FR"], ["South Korea", "KR"], ["Bermuda", "BM"], ["Marshall Islands", "MH"],
      ["Isle of Man", "IM"], ["Jersey", "JE"], ["Monaco", "MC"], ["Austria", "AT"], ["Sweden", "SE"],
    ];
    for (const [name, code] of names) expect(countryCode(name), name).toBe(code);
  });
  it("reads a name whatever its capitals or spacing", () => {
    expect(countryCode("  cayman  islands ")).toBe("KY");
    expect(countryCode("SINGAPORE")).toBe("SG");
    expect(countryCode(" China ")).toBe("CN");
    expect(countryCode("british Virgin Islands")).toBe("VG");
  });
  it("falls back to the short form for a country it doesn't know", () => {
    expect(countryCode("Trinidad and Tobago")).toBe("TAT");
    expect(countryCode("Atlantis")).toBe("ATL");
    expect(countryCode("Fiji")).toBe("Fiji");
    expect(countryShort("Democratic Republic of the Congo and Friends")).toBe("DROTC");
  });
  it("makes China, Hong Kong and Macau red, every other foreign country grey", () => {
    for (const name of ["China", "Hong Kong", "China Hong Kong", "Macau"])
      expect(countryBlock(checked(name)), name).toMatchObject({ kind: "country", red: true });
    for (const name of ["Taiwan", "Singapore", "Malaysia", "Israel", "Cayman Islands", "Canada", "Atlantis"])
      expect(countryBlock(checked(name)), name).toMatchObject({ kind: "country", red: false });
    expect(countryBlock(checked("China Hong Kong"))).toEqual({ kind: "country", code: "HK", name: "China Hong Kong", red: true });
    expect(countryBlock(checked("  British  Virgin Islands "))).toEqual({ kind: "country", code: "VG", name: "British Virgin Islands", red: false });
  });
  it("#452: gives the U.S. a grey US block named United States, however it is written", () => {
    for (const name of ["U.S.", "U.S", "US", "USA", "U.S.A.", "United States", " united  states of america "])
      expect(countryBlock(checked(name)), name).toEqual({ kind: "country", code: "US", name: "United States", red: false });
  });
  it("shows no block for an unknown country or a ticker that wasn't found", () => {
    for (const name of ["Unknown", "N/A", "", "  "]) expect(countryBlock(checked(name)), name).toBeNull();
    expect(countryBlock(checked(null))).toBeNull();
    expect(countryBlock({ ...base, notFound: true })).toBeNull();
  });
  it("says it is still looking up before the country has been checked", () => {
    expect(countryBlock(base)).toEqual({ kind: "lookingUp" });
  });
  it("opens newest first when the remembered order was by the old Country column", () => {
    expect(parseSort(JSON.stringify({ key: "country", dir: "asc" }))).toBeNull();
    expect(parseSort(JSON.stringify({ key: "country", dir: "desc" }))).toBeNull();
    expect(sortRows([row("A", "2026-11-06T14:00:00.000Z"), row("B", "2026-11-06T14:30:00.000Z")], parseSort(JSON.stringify({ key: "country", dir: "asc" }))).map((r) => r.sym)).toEqual(["B", "A"]);
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
    row("AAA", "2026-11-06T14:00:00.000Z", { quote: { price: 2.5, changePct: 52.3, volume: 1_200_000 }, country: "China", cashUsd: 3e6, instOwnPct: 4, borrow: borrow({ status: "etb", etb: true, pricePerShare: null, locateType: null, checkedAt: "2026-11-06T14:45:00.000Z" }), ib: { feePct: 1390, rebatePct: null, available: null, availableMore: false, fileTime: "2026-11-06T14:00:00.000Z" }, sharesOutstanding: 10_000_000 }),
    row("BBB", "2026-11-06T14:30:00.000Z", { quote: { price: 0.4512, changePct: -12.3, volume: 850_000 }, country: "U.S.", cashUsd: 31.5e6, instOwnPct: 12.5, borrow: borrow({ pricePerShare: 0.0725 }), ib: { feePct: 8.9, rebatePct: null, available: null, availableMore: false, fileTime: "2026-11-06T14:00:00.000Z" }, sharesOutstanding: 20_000_000 }),
    row("CCC", "2026-11-06T14:10:00.000Z", { quote: null, borrow: null, ib: null, sharesOutstanding: 5_000_000 }),
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
    // #442: Market Cap (price × shares): AAA $25M, BBB $9.0M, DDD has a price but no shares, CCC neither.
    expect(syms(sortRows(rows, { key: "marketCap", dir: "desc" }))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "marketCap", dir: "asc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "cash", dir: "desc" }))).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "instOwn", dir: "asc" }))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
  });
  it("sorts borrow from easy to borrow, by price, to none offered; unchecked last", () => {
    expect(syms(sortRows(rows, { key: "borrow", dir: "asc" }))).toEqual(["AAA", "BBB", "DDD", "CCC"]);
    expect(syms(sortRows(rows, { key: "borrow", dir: "desc" }))).toEqual(["DDD", "BBB", "AAA", "CCC"]);
    expect(sortValue("borrow", row("X", base.lastAlertAt, { borrow: borrow({ status: "error", pricePerShare: null, locateType: null, checkedAt: null }) }))).toBeNull();
  });
  it("sorts words alphabetically", () => {
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
    expect(nextSort(null, "symbol")).toEqual({ key: "symbol", dir: "asc" });
    expect(nextSort({ key: "symbol", dir: "asc" }, "symbol")).toEqual({ key: "symbol", dir: "desc" });
    expect(nextSort({ key: "symbol", dir: "asc" }, "volume")).toEqual({ key: "volume", dir: "desc" });
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

describe("Gainers Table: below yesterday's close when it alerted (#433)", () => {
  // The two #433 columns of chat_gainers_table(day): any alert outside after hours, and the highest
  // after-hours alert price. The second argument is yesterday's close from Polygon.
  const alerts = (any_not_after_hours: boolean | null | undefined, after_hours_high: number | string | null | undefined) => ({ any_not_after_hours, after_hours_high });
  it("2026-11-10: FOSL stays, BMGL and ALGS go", () => {
    // FOSL alerted after hours at $10.00; yesterday's close was $8.06.
    expect(gainersRowLeftOff(alerts(false, "10.00"), 8.06)).toBe(false);
    // BMGL alerted after hours at $2.43 and $2.72 (the highest counts); yesterday's close was about $5.40.
    expect(gainersRowLeftOff(alerts(false, "2.72"), 5.4)).toBe(true);
    // ALGS alerted after hours at $3.25; yesterday's close was about $3.95.
    expect(gainersRowLeftOff(alerts(false, 3.25), 3.95)).toBe(true);
  });
  it("a stock with a pre-market or regular-hours alert always stays", () => {
    // A morning gainer that is now -30%: nothing after hours.
    expect(gainersRowLeftOff(alerts(true, null), 5)).toBe(false);
    // A regular-hours alert and a later after-hours alert below yesterday's close.
    expect(gainersRowLeftOff(alerts(true, "2.72"), 5.4)).toBe(false);
  });
  it("an after-hours alert has to be above yesterday's close, not at it", () => {
    expect(gainersRowLeftOff(alerts(false, 5.41), 5.4)).toBe(false);
    expect(gainersRowLeftOff(alerts(false, 5.4), 5.4)).toBe(true);
    expect(gainersRowLeftOff(alerts(false, 5.39), 5.4)).toBe(true);
  });
  it("stays when yesterday's close isn't known", () => {
    for (const prevClose of [null, undefined, 0, -1, NaN, Infinity]) expect(gainersRowLeftOff(alerts(false, "2.72"), prevClose)).toBe(false);
  });
  it("stays when the after-hours alert had no price", () => {
    for (const high of [null, undefined, "", "abc", 0]) expect(gainersRowLeftOff(alerts(false, high), 5.4)).toBe(false);
  });
  it("stays when the database doesn't have the columns yet (before migration 20261110230000)", () => {
    expect(gainersRowLeftOff({}, 5.4)).toBe(false);
    expect(gainersRowLeftOff(alerts(undefined, "2.72"), 5.4)).toBe(false);
    expect(gainersRowLeftOff(alerts(null, "2.72"), 5.4)).toBe(false);
    const old: GainersTableDbRow = { ticker: "BMGL", last_alert_at: "2026-11-10T21:25:42Z", alerts: 2, country: null, country_checked_at: null, cash_usd: null, cash_months_left: null, cash_flow_positive: false, cash_checked_at: null, inst_own_pct: null, inst_own_checked_at: null, not_found: false, checked_at: null, last_after_hours: true };
    expect(gainersRowLeftOff(old, 5.4)).toBe(false);
  });
  it("never sends the two columns to the browser", () => {
    const db: GainersTableDbRow = { ticker: "FOSL", last_alert_at: "2026-11-10T21:14:38Z", alerts: 1, country: null, country_checked_at: null, cash_usd: null, cash_months_left: null, cash_flow_positive: false, cash_checked_at: null, inst_own_pct: null, inst_own_checked_at: null, not_found: false, checked_at: null, last_after_hours: true, any_not_after_hours: false, after_hours_high: "10.00" };
    expect(Object.keys(tableRow(db)).filter((key) => /after|high|prev/i.test(key))).toEqual(["lastAfterHours"]);
  });
});

describe("Gainers Table Market Cap (#442)", () => {
  const at = (price: number | null, sharesOutstanding: number | null | undefined) => ({
    quote: price === null ? null : { price, changePct: null, volume: null },
    sharesOutstanding,
  });
  it("is in ON fee's place, explained on hover, and ON fee is gone", () => {
    const keys = GAINERS_COLUMNS.map((c) => c.key as string);
    expect(keys.indexOf("marketCap")).toBe(4);
    expect(keys).not.toContain("ibFee");
    expect(GAINERS_COLUMNS.map((c) => c.name)).not.toContain("ON fee");
    expect(GAINERS_COLUMNS[4]).toMatchObject({ name: "Market Cap", number: true, title: "Market Cap: the price now times the company’s shares outstanding" });
  });
  it("is the price the table shows times the shares outstanding", () => {
    expect(marketCapUsd(at(2.5, 4_960_000))).toBe(12_400_000);
    expect(marketCapUsd(at(0.4512, 1_000_000))).toBeCloseTo(451_200);
  });
  it("shows a short dollar amount", () => {
    expect(marketCapLabel(at(12, 100_000_000))).toBe("$1.2B");
    expect(marketCapLabel(at(8.5, 100_000_000))).toBe("$850M");
    expect(marketCapLabel(at(2.5, 4_960_000))).toBe("$12.4M");
    expect(marketCapLabel(at(0.94, 1_000_000))).toBe("$940K");
    expect(marketCapLabel(at(150, 1_000_000_000))).toBe("$150B");
    // 999,960 would round to "$1000K": "$1M" instead.
    expect(marketCapLabel(at(0.99996, 1_000_000))).toBe("$1M");
  });
  it("shows a dash, never $0 or blank, when either part is unknown", () => {
    for (const row of [at(null, 5_000_000), at(2.5, null), at(2.5, undefined), at(0, 5_000_000), at(2.5, 0), at(-1, 5_000_000), at(Number.NaN, 5_000_000)]) {
      expect(marketCapUsd(row)).toBeNull();
      expect(marketCapLabel(row)).toBe("—");
    }
  });
});
