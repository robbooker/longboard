// #371 Gainers Table: the company facts behind each row (country, cash left, institutional
// ownership), how a lookup's result is checked on the way in, which tickers still need a lookup,
// and how the table shows them. The lookup program on Rob's computer (scripts/gainers-lookup/)
// reads DilutionTracker and posts here; the table shows every value as React text.
import type { GainersBorrow } from "@/lib/chatGainersBorrow";
import type { GainersIb } from "@/lib/chatGainersIb";

/** Cash is looked up again once it is this old. The country never is. */
export const CASH_STALE_DAYS = 30;
/** A ticker DilutionTracker had no page for is tried again after this long. */
export const NOT_FOUND_RETRY_HOURS = 6;
const DAY_MS = 86_400_000;

/** One row of public.chat_gainers_table(day), as the database returns it. */
export type GainersTableDbRow = {
  ticker: string;
  last_alert_at: string;
  alerts: number;
  country: string | null;
  country_checked_at: string | null;
  cash_usd: number | string | null;
  cash_months_left: number | string | null;
  cash_flow_positive: boolean;
  cash_checked_at: string | null;
  inst_own_pct: number | string | null;
  inst_own_checked_at: string | null;
  not_found: boolean;
  checked_at: string | null;
  /** #412: the latest alert that day was after hours (missing before 20261110190000: false). */
  last_after_hours?: boolean | null;
  /** #433: at least one alert that day was pre-market or regular hours (missing before
   * 20261110230000: not known, so the row stays). */
  any_not_after_hours?: boolean | null;
  /** #433: the highest Extended Price among that day's after-hours alerts; null when there is none
   * (missing before 20261110230000). */
  after_hours_high?: number | string | null;
};

/** One row as the table view gets it. A null *Checked means "not looked up yet". */
export type GainersTableRow = {
  sym: string;
  lastAlertAt: string;
  alerts: number;
  country: string | null;
  countryChecked: boolean;
  cashUsd: number | null;
  cashMonthsLeft: number | null;
  cashFlowPositive: boolean;
  cashChecked: boolean;
  instOwnPct: number | null;
  instOwnChecked: boolean;
  notFound: boolean;
  /** #412: when the lookup last saved this ticker's company facts (null: never). Optional so older
   * fixtures without it still read. */
  factsCheckedAt?: string | null;
  /** #412: the latest alert was after hours: the row is tagged "AH". */
  lastAfterHours?: boolean;
  /** #372: price, % today and volume today from Polygon's snapshot; null when it couldn't be read. */
  quote?: GainersQuote | null;
  /** #373: today's TradeZero borrow check; null before the first one. */
  borrow?: GainersBorrow | null;
  /** #376: Interactive Brokers' borrow fee and shares to lend; null before the first file is read. */
  ib?: GainersIb | null;
  /** #442: shares outstanding from Polygon's ticker details; null when not known (yet). */
  sharesOutstanding?: number | null;
};

/** #372: one ticker's snapshot as the table shows it. Any part may be missing. */
export type GainersQuote = { price: number | null; changePct: number | null; volume: number | null };

export type GainersTableData = { day: string; rows: GainersTableRow[] };

const num = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function tableRow(row: GainersTableDbRow): GainersTableRow {
  return {
    sym: row.ticker,
    lastAlertAt: new Date(row.last_alert_at).toISOString(),
    alerts: row.alerts,
    country: row.country,
    countryChecked: !!row.country_checked_at,
    cashUsd: num(row.cash_usd),
    cashMonthsLeft: num(row.cash_months_left),
    cashFlowPositive: !!row.cash_flow_positive,
    cashChecked: !!row.cash_checked_at,
    instOwnPct: num(row.inst_own_pct),
    instOwnChecked: !!row.inst_own_checked_at,
    notFound: !!row.not_found,
    factsCheckedAt: row.checked_at ? new Date(row.checked_at).toISOString() : null,
    lastAfterHours: !!row.last_after_hours,
  };
}

/**
 * #433: whether the Gainers Table leaves this stock off. Rob: a stock that was below yesterday's
 * close when it alerted isn't a gainer. After hours the alert fires when a stock is up from TODAY's
 * close, so one that fell hard in the day and bounced after the close alerts while still below
 * YESTERDAY's close.
 *
 * A stock is on the table when at least one of its alerts today was above yesterday's close at the
 * time of the alert:
 * - a pre-market or regular-hours alert is measured from yesterday's close already, so it always
 *   counts (a morning gainer that faded later stays, showing its red %);
 * - an after-hours alert counts when its Extended Price is above yesterday's close.
 * So a stock is left off only when every one of these is known: it has no alert outside after
 * hours, its highest after-hours alert price, and yesterday's close (Polygon's prevDay.c), with that
 * price at or below that close. Anything not known keeps the row: the columns missing (before
 * migration 20261110230000), an after-hours alert without a price, or no answer from Polygon.
 */
export function gainersRowLeftOff(row: Pick<GainersTableDbRow, "any_not_after_hours" | "after_hours_high">, prevClose: number | null | undefined) {
  if (row.any_not_after_hours !== false) return false;
  const high = num(row.after_hours_high);
  if (high === null || high <= 0) return false;
  if (typeof prevClose !== "number" || !Number.isFinite(prevClose) || prevClose <= 0) return false;
  return high <= prevClose;
}

/** What a ticker still needs looked up, or null when nothing. */
export function factsNeeded(row: GainersTableDbRow, now = Date.now()): string[] | null {
  if (row.not_found && !row.country_checked_at && !row.cash_checked_at && !row.inst_own_checked_at) {
    const at = row.checked_at ? Date.parse(row.checked_at) : 0;
    return now - at >= NOT_FOUND_RETRY_HOURS * 3_600_000 ? ["country", "cash", "instOwn"] : null;
  }
  const needs: string[] = [];
  if (!row.country_checked_at) needs.push("country");
  const cashAt = row.cash_checked_at ? Date.parse(row.cash_checked_at) : NaN;
  if (!Number.isFinite(cashAt) || now - cashAt > CASH_STALE_DAYS * DAY_MS) needs.push("cash");
  if (!row.inst_own_checked_at) needs.push("instOwn");
  return needs.length ? needs : null;
}

export type GainersFactsInput = {
  ticker: string;
  notFound: boolean;
  country: string | null;
  cashUsd: number | null;
  cashMonthsLeft: number | null;
  cashFlowPositive: boolean;
  instOwnPct: number | null;
};

const TICKER = /^[A-Z][A-Z. ]{0,11}$/;
const KEYS = ["ticker", "notFound", "country", "cashUsd", "cashMonthsLeft", "cashFlowPositive", "instOwnPct"];
const within = (value: unknown, max: number): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max);

/** Checks one lookup's result; returns only the known fields, or null when anything is off. */
export function parseGainersFacts(value: unknown): GainersFactsInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => !KEYS.includes(key)) || KEYS.some((key) => !(key in p))) return null;
  if (typeof p.ticker !== "string" || !TICKER.test(p.ticker)) return null;
  if (typeof p.notFound !== "boolean" || typeof p.cashFlowPositive !== "boolean") return null;
  if (
    p.country !== null &&
    (typeof p.country !== "string" || !/^[^\0<>]{1,60}$/.test(p.country) || !p.country.trim())
  )
    return null;
  if (!within(p.cashUsd, 1e13) || !within(p.cashMonthsLeft, 1e6) || !within(p.instOwnPct, 1000)) return null;
  return {
    ticker: p.ticker,
    notFound: p.notFound,
    country: p.notFound || p.country === null ? null : p.country.trim(),
    cashUsd: p.notFound ? null : p.cashUsd,
    cashMonthsLeft: p.notFound ? null : p.cashMonthsLeft,
    cashFlowPositive: !p.notFound && p.cashFlowPositive,
    instOwnPct: p.notFound ? null : p.instOwnPct,
  };
}

/** Today's date in New York, YYYY-MM-DD: the gainers room's trading day. */
export function easternDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

// --- Display.
const LOOKING_UP = "looking up…";
const NONE = "—";

/** "$31.5M", "$1.2B", "$850K". */
export function cashAmount(value: number) {
  const [scaled, unit] =
    value >= 1e9 ? [value / 1e9, "B"] : value >= 1e6 ? [value / 1e6, "M"] : [value / 1e3, "K"];
  return `$${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1))}${unit}`;
}

/** #394: the Gainers Table shows "CFP" for cash flow positive; hovering or tapping it shows the words. */
export const CFP = "CFP";
export const CFP_WORDS = "Cash Flow Positive";

/** "$31.5M · 304 mo" (whole months, rounded down, as Rob wrote it), "CFP" or "$850K · CFP" (#394),
 * "—", or "looking up…" until the lookup has been. */
export function cashLabel(row: GainersTableRow) {
  if (row.cashFlowPositive) return row.cashUsd !== null ? `${cashAmount(row.cashUsd)} · ${CFP}` : CFP;
  if (row.cashUsd !== null) {
    const months = row.cashMonthsLeft === null ? null : Math.floor(row.cashMonthsLeft);
    return months === null
      ? cashAmount(row.cashUsd)
      : `${cashAmount(row.cashUsd)} · ${months.toLocaleString("en-US")} mo`;
  }
  return row.cashChecked || row.notFound ? NONE : LOOKING_UP;
}

// #451: the country is no longer a column: a small two-letter block under each symbol says where the
// company is (ISO 3166 alpha-2 codes), with the whole name on hover and on a tap. China, Hong Kong and
// Macau are a red block, every other country outside the U.S. a quiet grey one; a U.S. company, one
// whose country isn't known and one DilutionTracker had no page for show no block at all.

/** The whole country names DilutionTracker uses (and their usual variants), lower case, to ISO codes. */
const COUNTRY_CODES: Readonly<Record<string, string>> = {
  china: "CN",
  "people's republic of china": "CN",
  prc: "CN",
  "hong kong": "HK",
  "china hong kong": "HK",
  "hong kong sar": "HK",
  macau: "MO",
  macao: "MO",
  "china macau": "MO",
  taiwan: "TW",
  singapore: "SG",
  malaysia: "MY",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  "republic of korea": "KR",
  india: "IN",
  indonesia: "ID",
  philippines: "PH",
  thailand: "TH",
  vietnam: "VN",
  cambodia: "KH",
  mongolia: "MN",
  kazakhstan: "KZ",
  pakistan: "PK",
  bangladesh: "BD",
  "sri lanka": "LK",
  australia: "AU",
  "new zealand": "NZ",
  israel: "IL",
  "united arab emirates": "AE",
  uae: "AE",
  "saudi arabia": "SA",
  qatar: "QA",
  bahrain: "BH",
  kuwait: "KW",
  jordan: "JO",
  lebanon: "LB",
  turkey: "TR",
  egypt: "EG",
  canada: "CA",
  mexico: "MX",
  "united kingdom": "GB",
  "u.k.": "GB",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  ireland: "IE",
  "isle of man": "IM",
  jersey: "JE",
  guernsey: "GG",
  gibraltar: "GI",
  france: "FR",
  germany: "DE",
  netherlands: "NL",
  "the netherlands": "NL",
  belgium: "BE",
  luxembourg: "LU",
  switzerland: "CH",
  liechtenstein: "LI",
  austria: "AT",
  italy: "IT",
  spain: "ES",
  portugal: "PT",
  greece: "GR",
  cyprus: "CY",
  malta: "MT",
  monaco: "MC",
  denmark: "DK",
  sweden: "SE",
  norway: "NO",
  finland: "FI",
  iceland: "IS",
  estonia: "EE",
  latvia: "LV",
  lithuania: "LT",
  poland: "PL",
  "czech republic": "CZ",
  czechia: "CZ",
  hungary: "HU",
  romania: "RO",
  bulgaria: "BG",
  serbia: "RS",
  croatia: "HR",
  slovenia: "SI",
  slovakia: "SK",
  ukraine: "UA",
  russia: "RU",
  georgia: "GE",
  armenia: "AM",
  "cayman islands": "KY",
  "british virgin islands": "VG",
  bermuda: "BM",
  bahamas: "BS",
  "the bahamas": "BS",
  barbados: "BB",
  jamaica: "JM",
  "puerto rico": "PR",
  curacao: "CW",
  "marshall islands": "MH",
  panama: "PA",
  "costa rica": "CR",
  guatemala: "GT",
  brazil: "BR",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  uruguay: "UY",
  paraguay: "PY",
  ecuador: "EC",
  venezuela: "VE",
  bolivia: "BO",
  "south africa": "ZA",
  nigeria: "NG",
  kenya: "KE",
  ghana: "GH",
  morocco: "MA",
};

/** #451: the codes that get the red block. */
const RED_CODES: ReadonlySet<string> = new Set(["CN", "HK", "MO"]);

/** Names that mean the United States (no block). Compared lower case, dots and spaces dropped. */
const US_NAMES: ReadonlySet<string> = new Set(["us", "usa", "unitedstates", "unitedstatesofamerica", "america"]);
/** Names that say the country isn't known (no block, like a missing one). */
const UNKNOWN_NAMES: ReadonlySet<string> = new Set(["unknown", "n/a", "na", "none", "-", "—"]);

const COUNTRY_SHORT_MAX = 5;
const wholeName = (name: string) => name.trim().replace(/\s+/g, " ");

export const isUsCountry = (name: string) => US_NAMES.has(wholeName(name).toLowerCase().replace(/[.\s]/g, ""));

/**
 * #429's short form, now only for a country the code list doesn't have: five characters or fewer stay
 * as they are; a longer name gives its initials (several words) or its first three letters, in capitals.
 */
export function countryShort(name: string) {
  const full = wholeName(name);
  if (full.length <= COUNTRY_SHORT_MAX) return full;
  const words = full.split(" ");
  const short = words.length > 1 ? words.map((word) => word[0]).join("") : full.slice(0, 3);
  return short.slice(0, COUNTRY_SHORT_MAX).toUpperCase();
}

/** #451: the ISO 3166 alpha-2 code for a country name ("Cayman Islands" → "KY"); a name not on the
 * list falls back to its short form. */
export function countryCode(name: string) {
  const full = wholeName(name);
  return COUNTRY_CODES[full.toLowerCase()] ?? countryShort(full);
}

/** #451: what goes under a row's symbol: nothing (U.S., unknown, not found), a faint "…" while the
 * country is still being looked up, or a block with its code, the whole name and whether it is red. */
export type CountryBlock = { kind: "lookingUp" } | { kind: "country"; code: string; name: string; red: boolean } | null;

export function countryBlock(row: Pick<GainersTableRow, "country" | "countryChecked" | "notFound">): CountryBlock {
  const name = row.country ? wholeName(row.country) : "";
  if (!name) return row.countryChecked || row.notFound ? null : { kind: "lookingUp" };
  if (isUsCountry(name) || UNKNOWN_NAMES.has(name.toLowerCase())) return null;
  const code = countryCode(name);
  return { kind: "country", code, name, red: RED_CODES.has(code) };
}

export function instOwnLabel(row: GainersTableRow) {
  if (row.instOwnPct !== null) return `${Number(row.instOwnPct.toFixed(1))}%`;
  return row.instOwnChecked || row.notFound ? NONE : LOOKING_UP;
}

/** Whole minutes since the most recent alert (never below 0). */
export function minutesSince(at: string, now: number) {
  return Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
}

/** #412: the tag beside a symbol whose latest alert was after hours, and what it means. */
export const AFTER_HOURS_TAG = "AH";
export const AFTER_HOURS_WORDS = "After-hours alert";

export const isLookingUp = (label: string) => label === LOOKING_UP;

/** #394: a cash label split around its "CFP", so the table can make just that part hoverable and
 * tappable: "$850K · CFP" → { before: "$850K · ", cfp: true }; any other label → { before: label, cfp: false }. */
export function splitCfp(label: string) {
  return label === CFP || label.endsWith(` · ${CFP}`)
    ? { before: label.slice(0, label.length - CFP.length), cfp: true }
    : { before: label, cfp: false };
}

// --- #372: price, % today and volume today.

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** "$1.23", "$1,234.50"; four decimals under $1 ("$0.4512"); "—" without a price. */
export function priceLabel(quote: GainersQuote | null | undefined) {
  const price = quote?.price;
  if (!finite(price) || price <= 0) return NONE;
  const digits = price < 1 ? 4 : 2;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

// Halves round away from zero both ways, so -5.25 shows as -5.3% like +5.25 shows +5.3%.
const tenths = (pct: number) => (Math.sign(pct) * Math.round(Math.abs(pct) * 10)) / 10 || 0;

/** "+123.4%", "-5.2%", "0.0%"; "—" without a change. */
export function changeLabel(quote: GainersQuote | null | undefined) {
  const pct = quote?.changePct;
  if (!finite(pct)) return NONE;
  const rounded = tenths(pct);
  if (rounded === 0) return "0.0%";
  const text = Math.abs(rounded).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${rounded > 0 ? "+" : "-"}${text}%`;
}

/** "up" or "down" for the colour of the % today; null when flat or unknown. */
export function changeTone(quote: GainersQuote | null | undefined): "up" | "down" | null {
  const pct = quote?.changePct;
  if (!finite(pct)) return null;
  const rounded = tenths(pct);
  return rounded > 0 ? "up" : rounded < 0 ? "down" : null;
}

const VOLUME_UNITS: [number, string][] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
  [1, ""],
];

/** "12.3M", "850K", "1.2B", "940"; "—" without a volume. */
export function volumeLabel(quote: GainersQuote | null | undefined) {
  const volume = quote?.volume;
  if (!finite(volume) || volume < 0) return NONE;
  return shortCount(volume);
}

/** "12.3M", "850K", "1.2B", "940": a share count, short (#376: also IB's shares to lend). */
export function shortCount(count: number) {
  const short = (scaled: number) => (scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10);
  const found = VOLUME_UNITS.findIndex(([size]) => count >= size);
  const i = found === -1 ? VOLUME_UNITS.length - 1 : found;
  const [size, unit] = VOLUME_UNITS[i];
  const scaled = unit ? short(count / size) : Math.round(count);
  // 999,960 would round to "1000K": show "1M" instead.
  if (scaled >= 1000 && i > 0) return `1${VOLUME_UNITS[i - 1][1]}`;
  return `${scaled}${unit}`;
}

// --- #442: Market Cap (in place of the ON fee column).

/** The live market cap: the price the table shows times the shares outstanding; null without either. */
export function marketCapUsd(row: Pick<GainersTableRow, "quote" | "sharesOutstanding">): number | null {
  const price = row.quote?.price;
  const shares = row.sharesOutstanding;
  if (!finite(price) || price <= 0 || !finite(shares) || shares <= 0) return null;
  const cap = price * shares;
  return Number.isFinite(cap) ? cap : null;
}

/** "$1.2B", "$850M", "$12.4M", "$940K"; "—" when the market cap isn't known. */
export function marketCapLabel(row: Pick<GainersTableRow, "quote" | "sharesOutstanding">) {
  const cap = marketCapUsd(row);
  return cap === null ? NONE : `$${shortCount(cap)}`;
}

// --- #398: which columns a phone shows.
// #412: "IB avail" is gone; "Updated" (when the row's data was last refreshed) is new.
// #429: shorter headings, so the columns are narrower: "IB overnight fee" is "ON fee" and "Updated" is "Time".
// #432: two more, so the table fits a small window: "Min since alert" is "Min" and "Inst Own %" is "Inst %".
// #442: Market Cap takes the ON fee column's place (and its place in a phone's details).
// #451: Country is gone as a column, on a computer and a phone: a block under the symbol instead.

export type GainersColumnKey =
  "price" | "change" | "volume" | "borrow" | "marketCap" | "minutes" | "updated" | "cash" | "instOwn";

export type GainersColumn = { key: GainersColumnKey; name: string; number: boolean; title?: string };

/** The columns after Symbol, in a computer's order. */
export const GAINERS_COLUMNS: readonly GainersColumn[] = [
  { key: "price", name: "Price", number: true },
  { key: "change", name: "% today", number: true },
  { key: "volume", name: "Volume", number: true },
  { key: "borrow", name: "Borrow at TZ", number: true },
  {
    key: "marketCap",
    name: "Market Cap",
    number: true,
    title: "Market Cap: the price now times the company’s shares outstanding",
  },
  { key: "minutes", name: "Min", number: true, title: "Min: minutes since the stock last alerted" },
  {
    key: "updated",
    name: "Time",
    number: true,
    title: "Time: when this row’s company facts or TradeZero borrow were last checked (your time)",
  },
  { key: "cash", name: "Cash left", number: false },
  {
    key: "instOwn",
    name: "Inst %",
    number: true,
    title: "Inst %: share of the company owned by institutions",
  },
];

/** #398: a phone's row after Symbol, in this order (Rob's most important columns). #451: the country
 * is a block under the symbol now, not a column. */
export const GAINERS_PHONE_KEYS: readonly GainersColumnKey[] = ["price", "change", "borrow"];

const byKey = (key: GainersColumnKey) => GAINERS_COLUMNS.find((column) => column.key === key)!;

/** #398: the columns a phone's row shows after Symbol. */
export const GAINERS_PHONE_COLUMNS: readonly GainersColumn[] = GAINERS_PHONE_KEYS.map(byKey);

/** #398: the rest, in a computer's order: a phone shows them in the row's tap-down details. */
export const GAINERS_DETAIL_COLUMNS: readonly GainersColumn[] = GAINERS_COLUMNS.filter(
  (column) => !GAINERS_PHONE_KEYS.includes(column.key),
);

// --- #412: Updated (#429: the column's heading is "Time").

const latest = (...times: (string | null | undefined)[]) => {
  let best: string | null = null;
  let bestAt = -Infinity;
  for (const time of times) {
    const at = time ? Date.parse(time) : NaN;
    if (Number.isFinite(at) && at > bestAt) [best, bestAt] = [time!, at];
  }
  return best;
};

/**
 * When the row's data was last refreshed: the latest of the company facts lookup and TradeZero's
 * borrow check, or the (latest) alert itself when neither has been refreshed since. Price, % today
 * and volume are read fresh on every 15-second read and IB's file is the same for every row, so
 * neither counts (they would make every row say "now").
 */
export function updatedAt(row: GainersTableRow) {
  return latest(row.lastAlertAt, row.factsCheckedAt, row.borrow?.checkedAt) ?? row.lastAlertAt;
}

/** "8:42": hour and minute in the viewer's own time zone and clock (no seconds, no AM/PM). */
export function localClock(at: string, locale?: string, timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone })
    .formatToParts(new Date(at))
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}

/** The Time (#412 "Updated") cell's title: "Updated 8:42 AM" (with AM/PM where the viewer's clock has one). */
export function updatedTitle(at: string, locale?: string, timeZone?: string) {
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(at));
  return `Updated ${clock}`;
}

// --- #412: sorting by a column.

export type GainersSortKey = "symbol" | GainersColumnKey;
export type GainersSortDir = "asc" | "desc";
/** null: the default order, newest alert first. */
export type GainersSort = { key: GainersSortKey; dir: GainersSortDir } | null;

const SORT_KEYS: readonly GainersSortKey[] = ["symbol", ...GAINERS_COLUMNS.map((column) => column.key)];
const TEXT_KEYS: readonly GainersSortKey[] = ["symbol"];

/** The first tap's direction: words A to Z, numbers biggest first. */
export const firstSortDir = (key: GainersSortKey): GainersSortDir => (TEXT_KEYS.includes(key) ? "asc" : "desc");

/** A tap on a heading: sort by it; tap again to reverse; a third time goes back to newest alert first. */
export function nextSort(current: GainersSort, key: GainersSortKey): GainersSort {
  const first = firstSortDir(key);
  if (!current || current.key !== key) return { key, dir: first };
  return current.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : null;
}

/** A remembered choice read back from storage; null for anything that isn't one (#451: a choice saved
 * for the Country column, which is gone, too: the table opens newest alert first). */
export function parseSort(value: unknown): GainersSort {
  if (typeof value !== "string") return null;
  try {
    const p = JSON.parse(value) as { key?: unknown; dir?: unknown };
    if (!p || typeof p !== "object") return null;
    if (!SORT_KEYS.includes(p.key as GainersSortKey) || (p.dir !== "asc" && p.dir !== "desc")) return null;
    return { key: p.key as GainersSortKey, dir: p.dir };
  } catch {
    return null;
  }
}

const alertAt = (row: GainersTableRow) => {
  const at = Date.parse(row.lastAlertAt);
  return Number.isFinite(at) ? at : 0;
};

/**
 * What a column sorts by: a number, a word, or null when the row has none (missing values go last
 * in both directions). Borrow: easy to borrow is the cheapest (0), then the price per share, then
 * "None" offered (the dearest); not checked yet or only errors is missing. Min since alert sorts by
 * the latest alert (more minutes = older).
 */
export function sortValue(key: GainersSortKey, row: GainersTableRow): number | string | null {
  const known = (value: number | null | undefined) => (finite(value) ? value : null);
  switch (key) {
    case "symbol":
      return row.sym;
    case "price":
      return finite(row.quote?.price) && row.quote!.price! > 0 ? row.quote!.price! : null;
    case "change":
      return known(row.quote?.changePct);
    case "volume":
      return finite(row.quote?.volume) && row.quote!.volume! >= 0 ? row.quote!.volume! : null;
    case "borrow": {
      const borrow = row.borrow;
      if (!borrow) return null;
      if (borrow.status === "etb") return 0;
      if (borrow.status === "offered") return known(borrow.pricePerShare);
      if (borrow.status === "none") return Number.POSITIVE_INFINITY;
      return null;
    }
    case "marketCap":
      return marketCapUsd(row);
    case "minutes":
      return -alertAt(row);
    case "updated":
      return Date.parse(updatedAt(row));
    case "cash":
      return known(row.cashUsd);
    case "instOwn":
      return known(row.instOwnPct);
  }
}

/** The default order: newest (latest) alert first, then by symbol. A stock that alerts again moves back up. */
const byNewestAlert = (a: GainersTableRow, b: GainersTableRow) =>
  alertAt(b) - alertAt(a) || (a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0);

const collator = new Intl.Collator("en-US", { sensitivity: "base", numeric: true });

/** The rows in the chosen order (a new array). Ties keep the default order. */
export function sortRows(rows: readonly GainersTableRow[], sort: GainersSort): GainersTableRow[] {
  const sorted = [...rows];
  if (!sort) return sorted.sort(byNewestAlert);
  const sign = sort.dir === "asc" ? 1 : -1;
  const values = new Map(rows.map((row) => [row, sortValue(sort.key, row)]));
  return sorted.sort((a, b) => {
    const x = values.get(a) ?? null;
    const y = values.get(b) ?? null;
    if (x === null || y === null) return x === y ? byNewestAlert(a, b) : x === null ? 1 : -1;
    const order =
      typeof x === "string" || typeof y === "string"
        ? collator.compare(String(x), String(y))
        : x === y
          ? 0
          : x < y
            ? -1
            : 1;
    return order * sign || byNewestAlert(a, b);
  });
}
