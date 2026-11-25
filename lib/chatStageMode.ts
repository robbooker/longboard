// #501 Stage mode (admin-only preview): a room "goes live" as a three-column trading desk with the
// video player on the left, trades and questions in the middle and the room's own chat on the right.
// This file holds the gate and the pure pieces (what the stock panel shows); the screen itself is
// components/chat/stage/*, downloaded only when an admin opens it.
import {
  GAINERS_COLUMNS,
  cashLabel,
  changeLabel,
  changeTone,
  countryBlock,
  floatLabel,
  instOwnLabel,
  localClock,
  marketCapLabel,
  minutesSince,
  priceLabel,
  updatedAt,
  volumeLabel,
  type GainersColumnKey,
  type GainersTableRow,
} from "@/lib/chatGainersFacts";
import { borrowTableLabel } from "@/lib/chatGainersBorrow";

/** /chat?room=<room>&stage=1 opens stage mode (for an admin; anyone else's link is just the room). */
export const STAGE_PARAM = "stage";

/**
 * The one gate, decided on the server (app/chat/page.tsx) from the signed-in account: chat admins
 * only. CHAT_STAGE_MODE=off turns the preview off for admins too, without a deploy of new code.
 * There is no flag table in this app, so nothing is stored (no migration).
 */
export function stageModeAllowed(isAdmin: boolean, setting: string | undefined = process.env.CHAT_STAGE_MODE) {
  return isAdmin && setting?.trim().toLowerCase() !== "off";
}

/** Whether this address asks for stage mode. */
export function stageRequested(search: string) {
  return new URLSearchParams(search).get(STAGE_PARAM) === "1";
}

/** The address with stage mode on or off, everything else kept. */
export function stageHref(href: string, on: boolean) {
  const url = new URL(href);
  if (on) url.searchParams.set(STAGE_PARAM, "1");
  else url.searchParams.delete(STAGE_PARAM);
  return url.toString();
}

export type StageStat = { key: GainersColumnKey; name: string; value: string; tone?: "up" | "down" };
/** One stock as the "On screen now" panel shows it. */
export type StageStock = {
  sym: string;
  /** The market tag beside the symbol ("US", "CN"…), when known. */
  market: string | null;
  stats: StageStat[];
  /** "table": a row of today's Gainers Table. "sample": the handoff's saved row. "placeholder": a made-up ticker. */
  source: "table" | "sample" | "placeholder";
};

const PLACEHOLDER = "—";
const stats = (value: (key: GainersColumnKey) => string, tone?: "up" | "down"): StageStat[] =>
  GAINERS_COLUMNS.map((column) => ({
    key: column.key,
    name: column.key === "marketCap" ? "Mkt cap" : column.name,
    value: value(column.key),
    ...(column.key === "change" && tone ? { tone } : {}),
  }));

/** A Gainers Table row as the panel's stats: the table's own columns, order and wording. */
export function stageStockFromRow(row: GainersTableRow, now: number): StageStock {
  const block = countryBlock(row);
  const values: Record<GainersColumnKey, string> = {
    price: priceLabel(row.quote),
    change: changeLabel(row.quote),
    volume: volumeLabel(row.quote),
    borrow: borrowTableLabel(row.borrow),
    marketCap: marketCapLabel(row),
    float: floatLabel(row),
    cash: cashLabel(row),
    instOwn: instOwnLabel(row),
    minutes: String(minutesSince(row.lastAlertAt, now)),
    updated: localClock(updatedAt(row)),
  };
  return {
    sym: row.sym,
    market: block?.kind === "country" ? block.code : null,
    stats: stats((key) => values[key], changeTone(row.quote) ?? undefined),
    source: "table",
  };
}

/** The handoff's sample row: APUS as the Gainers Table showed it on 2026-11-25. Shown (marked as a
 * sample) only when today's table has no rows to show. */
const SAMPLE_APUS: Record<GainersColumnKey, string> = {
  price: "$3.14",
  change: "+35.8%",
  volume: "7.3M",
  borrow: ".01",
  marketCap: "$5.8M",
  float: "1.2M",
  cash: "$149M",
  instOwn: "3.9%",
  minutes: "7",
  updated: "9:25",
};
/** Made-up tickers from the mock-up: no numbers are invented for them. */
export const STAGE_SAMPLE_STOCKS: readonly StageStock[] = [
  { sym: "APUS", market: "US", stats: stats((key) => SAMPLE_APUS[key], "up"), source: "sample" },
  { sym: "QBTZ", market: null, stats: stats(() => PLACEHOLDER), source: "placeholder" },
  { sym: "MLNK", market: null, stats: stats(() => PLACEHOLDER), source: "placeholder" },
];

/** How many of today's stocks get a chip (newest alert first). */
export const STAGE_CHIP_LIMIT = 6;

/** The session's stocks: today's Gainers Table (newest alert first), or the sample when it is empty or unread. */
export function stageStocks(rows: readonly GainersTableRow[] | null, now: number): readonly StageStock[] {
  if (!rows?.length) return STAGE_SAMPLE_STOCKS;
  return rows.slice(0, STAGE_CHIP_LIMIT).map((row) => stageStockFromRow(row, now));
}

/** The stock on screen: the chosen one while it is still in the list, otherwise the first. */
export function stageOnScreen(stocks: readonly StageStock[], chosen: string | null) {
  return stocks.find((stock) => stock.sym === chosen) ?? stocks[0];
}

/** "00:34:12" since the stage opened. */
export function stageElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(Math.floor(total / 3600))}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}`;
}
