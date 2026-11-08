// #376 Gainers Table: what Interactive Brokers charges to borrow each stock (annual fee %) and how
// many shares it has to lend. IB publishes this for everyone as a file on its public FTP server
// (ftp2.interactivebrokers.com, user "shortstock", usa.txt, refreshed about every 15 minutes). The
// lookup program on Rob's computer (scripts/gainers-lookup/ib.mjs) reads it and posts the rows for
// today's tickers to /api/chat/gainers/facts with kind "ib"; the table shows them beside Borrow at TZ
// on a computer. One row per ticker, replaced by each newer file. This file holds how a post is
// checked on the way in and how the table shows it.
import { easternClock } from "@/lib/chatGainersBorrow";
import { shortCount } from "@/lib/chatGainersFacts";

/** The most rows one post may carry (the program sends today's tickers, in pieces of 100). */
export const IB_MAX_ROWS = 200;
/** IB's file says ">10000000" when it has at least that many; the biggest count it writes. */
export const IB_MAX_AVAILABLE = 1e12;
/** Bounds on a rate, as % a year. IB's own range is about -9,000 to 9,000. */
export const IB_MAX_RATE = 100_000;

/** One row of public.chat_gainers_ib_for(tickers), as the database returns it. */
export type GainersIbDbRow = {
  ticker: string;
  fee_pct: number | string | null;
  rebate_pct: number | string | null;
  available: number | string | null;
  available_more: boolean;
  file_time: string;
  updated_at: string;
};

/** One ticker's IB rate as the table gets it. available null: IB didn't say; 0: none to lend. */
export type GainersIb = {
  feePct: number | null;
  rebatePct: number | null;
  available: number | null;
  /** true: IB has more than `available` ("> 10,000,000"). */
  availableMore: boolean;
  /** When IB wrote the file this came from. */
  fileTime: string;
};

const num = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function ibFromDb(row: GainersIbDbRow): GainersIb {
  return {
    feePct: num(row.fee_pct),
    rebatePct: num(row.rebate_pct),
    available: num(row.available),
    availableMore: !!row.available_more,
    fileTime: new Date(row.file_time).toISOString(),
  };
}

export type GainersIbRowInput = {
  ticker: string;
  feePct: number | null;
  rebatePct: number | null;
  available: number | null;
  availableMore: boolean;
};
export type GainersIbInput = { fileTime: string; rows: GainersIbRowInput[] };

const TICKER = /^[A-Z][A-Z. ]{0,11}$/;
const KEYS = ["kind", "fileTime", "rows"];
const ROW_KEYS = ["ticker", "feePct", "rebatePct", "available", "availableMore"];
const rate = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= IB_MAX_RATE);
const exact = (p: Record<string, unknown>, keys: string[]) =>
  Object.keys(p).length === keys.length && keys.every((key) => key in p);

/**
 * Checks one post ({ kind: "ib", fileTime, rows: [...] }); null when anything is off. The file's
 * time may not be more than an hour ahead of now (a clock that far off means bad input).
 */
export function parseGainersIb(value: unknown, now = Date.now()): GainersIbInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (!exact(p, KEYS) || p.kind !== "ib") return null;
  if (typeof p.fileTime !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(p.fileTime)) return null;
  const at = Date.parse(p.fileTime);
  if (!Number.isFinite(at) || at > now + 3_600_000 || at < Date.parse("2020-01-01T00:00:00Z")) return null;
  if (!Array.isArray(p.rows) || p.rows.length < 1 || p.rows.length > IB_MAX_ROWS) return null;
  const seen = new Set<string>();
  const rows: GainersIbRowInput[] = [];
  for (const item of p.rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const r = item as Record<string, unknown>;
    if (!exact(r, ROW_KEYS)) return null;
    if (typeof r.ticker !== "string" || !TICKER.test(r.ticker) || seen.has(r.ticker)) return null;
    if (!rate(r.feePct) || !rate(r.rebatePct) || typeof r.availableMore !== "boolean") return null;
    const available = r.available;
    if (available !== null && (typeof available !== "number" || !Number.isSafeInteger(available) || available < 0 || available > IB_MAX_AVAILABLE))
      return null;
    if (r.availableMore && available === null) return null;
    seen.add(r.ticker);
    rows.push({ ticker: r.ticker, feePct: r.feePct, rebatePct: r.rebatePct, available, availableMore: r.availableMore });
  }
  return { fileTime: new Date(at).toISOString(), rows };
}

// --- Display.
const NONE = "—";

/** "1,390%", "8.9%", "0.25%": whole percent from 100 up, one decimal from 1, two under 1. "—" without a rate. */
export function ibFeeLabel(ib: GainersIb | null | undefined) {
  const fee = ib?.feePct;
  if (fee === null || fee === undefined || !Number.isFinite(fee)) return NONE;
  const digits = Math.abs(fee) >= 100 ? 0 : Math.abs(fee) >= 1 ? 1 : 2;
  return `${fee.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** "70K", "2.8M", ">10M", "0" (none to lend); "—" when IB didn't say or hasn't been read yet. */
export function ibAvailLabel(ib: GainersIb | null | undefined) {
  const available = ib?.available;
  if (available === null || available === undefined || !Number.isFinite(available)) return NONE;
  return `${ib?.availableMore ? ">" : ""}${shortCount(available)}`;
}

/** true when IB has no shares to lend: the cell is shown muted. */
export const ibNoneToLend = (ib: GainersIb | null | undefined) => ib?.available === 0 && !ib.availableMore;

const easternDate = (at: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(at));

/** "Interactive Brokers indicative rate, updated 9:42 ET" ("updated Nov 7, 3:58 ET" from an earlier day). */
export function ibTitle(ib: GainersIb | null | undefined, now = Date.now()) {
  if (!ib) return "No Interactive Brokers rate yet";
  const sameDay = easternDate(ib.fileTime) === easternDate(new Date(now).toISOString());
  const when = `${sameDay ? "" : `${easternDate(ib.fileTime)}, `}${easternClock(ib.fileTime)} ET`;
  return `Interactive Brokers indicative rate, updated ${when}`;
}
