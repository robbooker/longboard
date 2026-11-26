// #501 Stage mode: a room "goes live" as a trading desk with the video player on the left and the
// room's own chat on the right (admins also see sample trades and questions in the middle).
// #502: the video is real (LiveKit, lib/chatStageVideo.ts) and members of a room can watch while
// that room is live. This file holds the gate and the pure pieces (what the stock panel shows); the
// screen itself is components/chat/stage/*, downloaded only when someone opens it.
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
  type GainersQuote,
  type GainersTableRow,
} from "@/lib/chatGainersFacts";
import { borrowTableLabel } from "@/lib/chatGainersBorrow";

/** /chat?room=<room>&stage=1 opens stage mode (for an admin, or for a member while the room is live; otherwise the link is just the room). */
export const STAGE_PARAM = "stage";

/**
 * The admin gate, decided on the server (app/chat/page.tsx) from the signed-in account: chat admins
 * may open the stage at any time ("Go live (preview)") and see the room's stream address and key (#512).
 * CHAT_STAGE_MODE=off turns the stage off for everyone, without a deploy of new code.
 * There is no flag table in this app, so nothing is stored (no migration).
 */
export function stageModeAllowed(isAdmin: boolean, setting: string | undefined = process.env.CHAT_STAGE_MODE) {
  return isAdmin && setting?.trim().toLowerCase() !== "off";
}

// #502: the live-video state and who may open the stage are in lib/chatStageLive.ts (a small file
// the room itself loads; this one, with the stock panel's pieces, loads only with the stage).
export * from "./chatStageLive";

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
  /**
   * "table": a row of today's Gainers Table. "sample": the handoff's saved row. "placeholder": a
   * made-up ticker. "lookup" (#507): a stock the host put on screen that is not on today's table;
   * only what Polygon says about it is filled in.
   */
  source: "table" | "sample" | "placeholder" | "lookup";
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

/** How many of today's stocks get a chip (newest alert first). #507: one row that scrolls sideways. */
export const STAGE_CHIP_LIMIT = 24;

// --- #507: the stock the host put on screen for everyone.

/** What the app can really say about a stock that is not on today's Gainers Table (Polygon only). */
export type StageLookup = { quote: GainersQuote | null; sharesOutstanding: number | null };
const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** /api/chat/stage/stock's answer for this ticker, or null when it is not one. */
export function parseStageLookup(body: unknown, sym: string): StageLookup | null {
  if (!body || typeof body !== "object") return null;
  const { ticker, quote, sharesOutstanding } = body as { ticker?: unknown; quote?: unknown; sharesOutstanding?: unknown };
  if (ticker !== sym) return null;
  const q = quote && typeof quote === "object" ? (quote as Record<string, unknown>) : null;
  return {
    quote: q ? { price: numberOrNull(q.price), changePct: numberOrNull(q.changePct), volume: numberOrNull(q.volume) } : null,
    sharesOutstanding: numberOrNull(sharesOutstanding),
  };
}

/** The four columns a lookup can fill; every other column is "—". */
export const STAGE_LOOKUP_KEYS: readonly GainersColumnKey[] = ["price", "change", "volume", "marketCap"];

/**
 * A stock that is not on today's Gainers Table: price, % today, volume and market cap in the table's
 * own wording when Polygon has them, and "—" for everything else (and for all of it before the
 * answer, or without one). No number is ever made up.
 */
export function stageStockFromLookup(sym: string, lookup: StageLookup | null): StageStock {
  const quote = lookup?.quote ?? null;
  const values: Partial<Record<GainersColumnKey, string>> = {
    price: priceLabel(quote),
    change: changeLabel(quote),
    volume: volumeLabel(quote),
    marketCap: marketCapLabel({ quote, sharesOutstanding: lookup?.sharesOutstanding ?? null }),
  };
  return { sym, market: null, stats: stats((key) => values[key] ?? PLACEHOLDER, changeTone(quote) ?? undefined), source: "lookup" };
}

/**
 * What the "On screen now" panel shows.
 *  - chips: today's Gainers Table stocks (newest alert first); with none, the samples for an admin
 *    and nothing for a member.
 *  - stock: the viewer's own pick while it is on the table (or a sample chip); otherwise the host's
 *    stock, from its table row when it has one (any row, not only the chips) and from the lookup
 *    when it has not; otherwise the first chip. null: nothing to show.
 *  - following: the viewer is looking at what the host has on screen (or the host has nothing).
 *  - lookup: the stock shown is the host's and is not on the table, so it needs the lookup.
 * The host's stock never shows a sample row's numbers.
 */
export function stagePanelView(input: {
  rows: readonly GainersTableRow[] | null;
  now: number;
  host: string | null;
  picked: string | null;
  samples: boolean;
  lookup: StageLookup | null;
}): { chips: readonly StageStock[]; stock: StageStock | null; following: boolean; lookup: boolean } {
  const table = (input.rows ?? []).map((row) => stageStockFromRow(row, input.now));
  const chips = table.length ? table.slice(0, STAGE_CHIP_LIMIT) : input.samples ? STAGE_SAMPLE_STOCKS : [];
  const { host, picked } = input;
  const own = picked && picked !== host ? (table.find((stock) => stock.sym === picked) ?? chips.find((stock) => stock.sym === picked)) : undefined;
  if (own) return { chips, stock: own, following: !host, lookup: false };
  if (host) {
    const row = table.find((stock) => stock.sym === host);
    return { chips, stock: row ?? stageStockFromLookup(host, input.lookup), following: true, lookup: !row };
  }
  return { chips, stock: chips[0] ?? null, following: true, lookup: false };
}

/** "00:34:12" since the stage opened. */
export function stageElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(Math.floor(total / 3600))}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}`;
}
