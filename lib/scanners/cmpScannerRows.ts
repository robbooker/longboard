/**
 * Pure mapping from a runCmpSystem() result to one LB Scanner row.
 * No network, no DB — the server scan (lib/scanners/cmpScanner.ts) feeds it.
 *
 * Only today's events count (the system resets every trading day). An active
 * setup (stage 2-5) wins over a trade that already closed today; with no
 * active setup a closed trade shows as "T1 hit" / "stopped".
 */
import { CMP_STAGE_LABELS, type CmpBar, type CmpEvent, type CmpGrade, type CmpResult } from "@/lib/cmpSystem";

export type CmpScannerStage = "buy" | "dip" | "reclaim" | "pullback" | "t1Hit" | "stopped" | "waiting";

export const CMP_SCANNER_STAGE_LABELS: Record<CmpScannerStage, string> = {
  buy: "BUY",
  dip: "Dip",
  reclaim: "Reclaim",
  pullback: "Pullback",
  t1Hit: "T1 hit",
  stopped: "Stopped",
  waiting: "Waiting",
};

const STAGE_ORDER: Record<CmpScannerStage, number> = {
  buy: 0,
  dip: 1,
  reclaim: 2,
  pullback: 3,
  t1Hit: 4,
  stopped: 5,
  waiting: 6,
};

export type CmpScannerRow = {
  ticker: string;
  name: string | null;
  changePct: number;
  price: number;
  stage: CmpScannerStage;
  /** Plain-language state from the system (e.g. "Waiting for red dip to 9 EMA"). */
  detail: string;
  grade: CmpGrade | null;
  /** Unix seconds of the event that put the ticker in this stage. */
  stageTime: number | null;
  /** Buy price (in trade / closed) or the trigger: break of the dip candle's high (dip). */
  entry: number | null;
  /** Trade stop, or the projected stop while armed on a dip. */
  stop: number | null;
  /** Trade T1, otherwise today's high of day. */
  t1: number | null;
  cmp: number | null;
  ghost: number | null;
  /** (price - level) / level, in %. Negative = under the level. */
  cmpDistPct: number | null;
  ghostDistPct: number | null;
  /** Unix seconds of the last closed bar scanned. */
  barTime: number;
};

export type CmpScannerTicker = { ticker: string; name?: string | null; changePct: number };

const etDateFmtCache = new Map<string, Intl.DateTimeFormat>();

function etDate(unixSeconds: number, timeZone: string): string {
  let fmt = etDateFmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    etDateFmtCache.set(timeZone, fmt);
  }
  return fmt.format(new Date(unixSeconds * 1000));
}

/** Index of the first bar on the same exchange-time-zone day as the last bar. */
export function firstIndexOfLastDay(bars: Pick<CmpBar, "time">[], timeZone: string): number {
  if (bars.length === 0) return 0;
  const day = etDate(bars[bars.length - 1].time, timeZone);
  let i = bars.length - 1;
  while (i > 0 && etDate(bars[i - 1].time, timeZone) === day) i--;
  return i;
}

/** Drop a still-forming last bar: the system evaluates closed bars only. */
export function closedBars<T extends Pick<CmpBar, "time">>(bars: T[], barSeconds: number, nowSeconds: number): T[] {
  const last = bars[bars.length - 1];
  return last && last.time + barSeconds > nowSeconds ? bars.slice(0, -1) : bars;
}

export function distancePct(price: number, level: number | null): number | null {
  if (level === null || !Number.isFinite(level) || level <= 0) return null;
  return ((price - level) / level) * 100;
}

function lastEvent<T extends CmpEvent["type"]>(
  events: CmpEvent[],
  match: (e: CmpEvent) => e is Extract<CmpEvent, { type: T }>,
): Extract<CmpEvent, { type: T }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (match(e)) return e;
  }
  return null;
}

const isType =
  <T extends CmpEvent["type"]>(...types: T[]) =>
  (e: CmpEvent): e is Extract<CmpEvent, { type: T }> =>
    (types as string[]).includes(e.type);

/**
 * v2 stop while armed: lowest low since bounceLow was last cleared (the
 * reclaim bar, or a stage-4 traded-through / timeout reset), less the buffer.
 */
function projectedStop(bars: CmpBar[], events: CmpEvent[], result: CmpResult): number | null {
  const s = result.settings;
  if (s.version !== 2) return null;
  let anchor = -1;
  for (const e of events) {
    if (e.type === "reclaim") anchor = e.index;
    else if (e.type === "reset" && e.from === 4 && e.reason !== "lostEMA" && e.reason !== "newDay") anchor = e.index;
  }
  if (anchor < 0 || anchor + 1 >= bars.length) return null;
  let low = Infinity;
  for (let i = anchor + 1; i < bars.length; i++) low = Math.min(low, bars[i].low);
  if (s.includeReclaimLow) {
    const reclaim = lastEvent(events, isType("reclaim"));
    if (reclaim) low = Math.min(low, bars[reclaim.index].low);
  }
  return Number.isFinite(low) ? low * (1 - s.stopBufPct / 100) : null;
}

export function cmpScannerRow(ticker: CmpScannerTicker, bars: CmpBar[], result: CmpResult): CmpScannerRow | null {
  const last = result.bars[result.bars.length - 1];
  const lastBar = bars[bars.length - 1];
  if (!last || !lastBar || result.bars.length !== bars.length) return null;

  const s = result.settings;
  const dayStart = firstIndexOfLastDay(bars, s.timeZone);
  const today = result.events.filter((e) => e.index >= dayStart);
  const price = lastBar.close;

  const row: CmpScannerRow = {
    ticker: ticker.ticker,
    name: ticker.name ?? null,
    changePct: ticker.changePct,
    price,
    stage: "waiting",
    detail: CMP_STAGE_LABELS[last.stage],
    grade: last.grade,
    stageTime: null,
    entry: null,
    stop: null,
    t1: last.hod,
    cmp: last.cmp,
    ghost: last.ghost,
    cmpDistPct: distancePct(price, last.cmp),
    ghostDistPct: distancePct(price, last.ghost),
    barTime: lastBar.time,
  };

  const buy = lastEvent(today, isType("buy"));

  switch (last.stage) {
    case 5:
      if (buy) {
        row.stage = "buy";
        row.stageTime = buy.time;
        row.entry = buy.buy.entry;
        row.stop = buy.buy.stop;
        row.t1 = buy.buy.t1;
        row.grade = buy.buy.grade;
      }
      return row;
    case 4:
      row.stage = "dip";
      row.stageTime = lastEvent(today, isType("dip"))?.time ?? null;
      row.stop = projectedStop(bars, today, result);
      if (last.dipHigh !== null) {
        const trigger = last.dipHigh + s.mintick;
        // The system never buys at or above the CMP, so this dip can't trigger.
        if (s.requireUnderCMP && last.cmp !== null && trigger >= last.cmp) {
          row.detail = "Dip above the CMP: no buy while price is above it";
        } else {
          row.entry = trigger;
        }
      }
      return row;
    case 3:
      row.stage = "reclaim";
      row.stageTime = lastEvent(today, isType("reclaim"))?.time ?? null;
      return row;
    case 2: {
      row.stage = "pullback";
      const since = lastEvent(today, (e): e is Extract<CmpEvent, { type: "pullback" | "reset" }> =>
        e.type === "pullback" || (e.type === "reset" && e.reason === "lostEMA"),
      );
      row.stageTime = since?.time ?? null;
      return row;
    }
    default: {
      row.grade = null;
      const exit = lastEvent(today, isType("target", "stop"));
      if (buy && exit && exit.index >= buy.index) {
        row.stage = exit.type === "target" ? "t1Hit" : "stopped";
        row.stageTime = exit.time;
        row.entry = buy.buy.entry;
        row.stop = buy.buy.stop;
        row.t1 = buy.buy.t1;
        row.grade = buy.buy.grade;
      }
      return row;
    }
  }
}

/**
 * Which top-gainers list to scan. Premarket (weekdays 04:00-09:30 ET) uses the
 * snapshot vs. the prior close; any other time uses Polygon's day-gainers list,
 * which keeps the latest session's movers through after-hours, overnight and
 * weekends. (fetchTopGainers' own "post" mode only ranks after-hours moves and
 * its snapshot path needs live minute volume, so it comes back near-empty
 * once trading stops.)
 */
export function cmpGainersSession(now: Date): "pre" | "market" {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return "market";
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 4 * 60 && minutes < 9 * 60 + 30 ? "pre" : "market";
}

export function sortCmpScannerRows(rows: CmpScannerRow[]): CmpScannerRow[] {
  return rows
    .slice()
    .sort(
      (a, b) =>
        STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
        b.changePct - a.changePct ||
        a.ticker.localeCompare(b.ticker),
    );
}
