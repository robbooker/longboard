// #373 Gainers Table: what it costs to borrow each stock at TradeZero today, per share. The lookup
// program on Rob's computer (scripts/gainers-lookup/) asks TradeZero (Rob has TradeZero's written
// permission to build this) and posts the result to /api/chat/gainers/facts; the table shows it.
// One row per ticker per Eastern day: easy to borrow, the cheapest offered price, no shares
// offered, or an error. This file holds the rule for when a ticker is checked again, how a result
// is checked on the way in, and how the table shows it.

/** A ticker still alerting is checked again this often. */
export const BORROW_RECHECK_MINUTES = 15;
/** "Still alerting": an alert within this many minutes. */
export const BORROW_ALERTING_MINUTES = 60;
/** After an error, a ticker still alerting is tried again sooner. */
export const BORROW_ERROR_RETRY_MINUTES = 5;
/** The highest per-share price accepted as a real offer (anything above is treated as bad input). */
export const BORROW_MAX_PRICE = 1000;

export const BORROW_STATUSES = ["offered", "none", "etb", "error"] as const;
export type BorrowStatus = (typeof BORROW_STATUSES)[number];
export const LOCATE_TYPES = ["Locate", "PreBorrow", "SingleUse"] as const;
export type LocateType = (typeof LOCATE_TYPES)[number];

/** One row of public.chat_gainers_borrow_day(day), as the database returns it. */
export type GainersBorrowDbRow = {
  ticker: string;
  status: BorrowStatus;
  etb: boolean | null;
  price_per_share: number | string | null;
  locate_type: LocateType | null;
  checked_at: string | null;
  attempted_at: string;
};

/** One ticker's borrow as the table gets it. checkedAt: when the shown result was read (null: only errors so far). */
export type GainersBorrow = {
  status: BorrowStatus;
  etb: boolean | null;
  pricePerShare: number | null;
  locateType: LocateType | null;
  checkedAt: string | null;
  attemptedAt: string;
};

export function borrowFromDb(row: GainersBorrowDbRow): GainersBorrow {
  const price = row.price_per_share === null || row.price_per_share === "" ? null : Number(row.price_per_share);
  return {
    status: row.status,
    etb: row.etb,
    pricePerShare: price !== null && Number.isFinite(price) ? price : null,
    locateType: row.locate_type,
    checkedAt: row.checked_at ? new Date(row.checked_at).toISOString() : null,
    attemptedAt: new Date(row.attempted_at).toISOString(),
  };
}

/**
 * Whether a ticker in today's table needs a borrow check now: at once the first time it shows up,
 * then every 15 minutes while it is still alerting (an alert in the last 60 minutes), or 5 minutes
 * after an error. The lookup program only acts on this between 4 AM and 8 PM New York time on
 * weekdays, and keeps its own minimum gap per ticker too.
 */
export function borrowNeeded(lastAlertAt: string, borrow: GainersBorrow | null | undefined, now = Date.now()) {
  if (!borrow) return true;
  const sinceAlert = now - Date.parse(lastAlertAt);
  if (!(sinceAlert <= BORROW_ALERTING_MINUTES * 60_000)) return false;
  const gap = borrow.status === "error" || (borrow.checkedAt ?? "") < borrow.attemptedAt
    ? BORROW_ERROR_RETRY_MINUTES
    : BORROW_RECHECK_MINUTES;
  return now - Date.parse(borrow.attemptedAt) >= gap * 60_000;
}

export type GainersBorrowInput = {
  ticker: string;
  status: BorrowStatus;
  etb: boolean | null;
  pricePerShare: number | null;
  locateType: LocateType | null;
};

const TICKER = /^[A-Z][A-Z. ]{0,11}$/;
const KEYS = ["kind", "ticker", "status", "etb", "pricePerShare", "locateType"];

/** Checks one borrow check's result ({ kind: "borrow", ... }); null when anything is off. */
export function parseGainersBorrow(value: unknown): GainersBorrowInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => !KEYS.includes(key)) || KEYS.some((key) => !(key in p))) return null;
  if (p.kind !== "borrow" || typeof p.ticker !== "string" || !TICKER.test(p.ticker)) return null;
  if (!BORROW_STATUSES.includes(p.status as BorrowStatus)) return null;
  if (p.etb !== null && typeof p.etb !== "boolean") return null;
  if (p.locateType !== null && !LOCATE_TYPES.includes(p.locateType as LocateType)) return null;
  const price = p.pricePerShare;
  if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > BORROW_MAX_PRICE))
    return null;
  const status = p.status as BorrowStatus;
  // Each status carries exactly what it means.
  if (status === "etb" && (p.etb !== true || price !== null || p.locateType !== null)) return null;
  if (status === "offered" && (p.etb !== false || price === null || p.locateType === null)) return null;
  if (status === "none" && (p.etb !== false || price !== null || p.locateType !== null)) return null;
  if (status === "error" && (price !== null || p.locateType !== null)) return null;
  return { ticker: p.ticker, status, etb: p.etb as boolean | null, pricePerShare: price as number | null, locateType: p.locateType as LocateType | null };
}

// --- Display.
export const BORROW_CHECKING = "checking…";

/** "$0.04", "$0.0125", "$1.50": two to four decimals, as many as the price needs. */
export function borrowPrice(price: number) {
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** #412: the Gainers Table's shorter price: no dollar sign and no leading zero (".0045", ".12", "1.25"). */
export function borrowTablePrice(price: number) {
  return borrowPrice(price).replace(/^\$/, "").replace(/^0\./, ".");
}

/** "ETB", "$0.04", "None", "—" (only errors so far), or "checking…" before the first check. */
export function borrowLabel(borrow: GainersBorrow | null | undefined) {
  if (!borrow) return BORROW_CHECKING;
  if (borrow.status === "etb") return "ETB";
  if (borrow.status === "offered" && borrow.pricePerShare !== null) return borrowPrice(borrow.pricePerShare);
  if (borrow.status === "none") return "None";
  return "—";
}

/** #412: borrowLabel as the Gainers Table shows it: ".04" for "$0.04"; everything else the same. */
export function borrowTableLabel(borrow: GainersBorrow | null | undefined) {
  if (borrow?.status === "offered" && borrow.pricePerShare !== null) return borrowTablePrice(borrow.pricePerShare);
  return borrowLabel(borrow);
}

/** "9:42": hour and minute in New York, the market's clock. */
export function easternClock(at: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(at))
    .replace(/\s?[AP]M$/i, "");
}

const TYPE_NOTE: Record<LocateType, string> = { Locate: "", PreBorrow: " · pre-borrow", SingleUse: " · single-use" };

/** The cell's title: "checked 9:42", with the kind of locate when it isn't a plain one. */
export function borrowTitle(borrow: GainersBorrow | null | undefined) {
  if (!borrow) return "Not checked at TradeZero yet";
  if (!borrow.checkedAt) return `couldn’t check, tried ${easternClock(borrow.attemptedAt)}`;
  const type = borrow.status === "offered" && borrow.locateType ? TYPE_NOTE[borrow.locateType] : "";
  return `checked ${easternClock(borrow.checkedAt)}${type}`;
}
