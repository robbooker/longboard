import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IntradayResolution } from "@/lib/polygon/bars";
import type { RvolScannerHit, RvolScannerResult } from "@/lib/scanners/rvolScanner";

export const LONG_TERM_MOMENTUM_TABLE = "long_term_momentum_signals";
export const LONG_TERM_MOMENTUM_CURSOR_TABLE = "long_term_momentum_scan_cursors";
export const LONG_TERM_MOMENTUM_RUN_TABLE = "long_term_momentum_scan_runs";
export const LONG_TERM_MOMENTUM_RESOLUTIONS = ["1h", "4h"] as const satisfies readonly IntradayResolution[];
export const LONG_TERM_MOMENTUM_SCANNER_KEY = "nasdaq-price-gt-1";

type LongTermMomentumResolution = (typeof LONG_TERM_MOMENTUM_RESOLUTIONS)[number];

type LongTermMomentumRow = {
  alert_key: string;
  et_date: string;
  ticker: string;
  name: string | null;
  reference_type: string | null;
  primary_exchange: string | null;
  signal_resolution: LongTermMomentumResolution;
  signal_unix_seconds: number | string;
  signal_time_et: string;
  signal_rvol: number | string;
  signal_price: number | string;
  change_pct: number | string;
  price_now: number | string;
  day_volume: number | string;
  dollar_volume: number | string;
  breakout_mode: RvolScannerHit["breakoutMode"];
  breakout_level: number | string;
  bars_scanned: number | string;
};

type CursorRow = {
  scanner_key: string;
  candidate_offset: number | string;
};

type PersistedRow = {
  alert_key: string;
};

export type LongTermMomentumCacheRead = {
  available: boolean;
  error: string | null;
  hits: RvolScannerHit[];
};

export type LongTermMomentumPersistResult = {
  available: boolean;
  error: string | null;
  attempted: number;
  persisted: number;
};

type RecordRunInput = {
  scannerKey: string;
  status: "ok" | "failed";
  etDate: string;
  candidateOffset: number;
  nextCandidateOffset: number;
  snapshotPool: number;
  candidateLimit: number;
  minPrice: number;
  minMovePct: number;
  maxPrice: number | null;
  primaryExchanges: string[] | null;
  scanned: number;
  signals: number;
  error?: string | null;
  scans?: Array<{ resolution: IntradayResolution; scanned: number; signals: number }>;
};

function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isLongTermResolution(resolution: IntradayResolution): resolution is LongTermMomentumResolution {
  return (LONG_TERM_MOMENTUM_RESOLUTIONS as readonly string[]).includes(resolution);
}

export function longTermMomentumAlertKey(hit: Pick<RvolScannerHit, "resolution" | "ticker" | "signalUnixSeconds">) {
  return `${hit.resolution}:${hit.ticker}:${hit.signalUnixSeconds}`;
}

function hitToRow(etDate: string, hit: RvolScannerHit) {
  return {
    alert_key: longTermMomentumAlertKey(hit),
    et_date: etDate,
    ticker: hit.ticker,
    name: hit.name,
    reference_type: hit.referenceType,
    primary_exchange: hit.primaryExchange,
    signal_resolution: hit.resolution,
    signal_unix_seconds: hit.signalUnixSeconds,
    signal_time_et: hit.signalTimeEt,
    signal_rvol: hit.signalRvol,
    signal_price: hit.signalPrice,
    change_pct: hit.changePct,
    price_now: hit.priceNow,
    day_volume: hit.dayVolume,
    dollar_volume: hit.dollarVolume,
    breakout_mode: hit.breakoutMode,
    breakout_level: hit.breakoutLevel,
    bars_scanned: hit.barsScanned,
    last_seen_at: new Date().toISOString(),
    raw_hit: hit,
  };
}

function rowToHit(row: LongTermMomentumRow): RvolScannerHit {
  const signalResolution = row.signal_resolution;
  return {
    ticker: row.ticker,
    name: row.name,
    referenceType: row.reference_type,
    primaryExchange: row.primary_exchange,
    change: 0,
    changePct: numberValue(row.change_pct),
    priceNow: numberValue(row.price_now),
    dayVolume: numberValue(row.day_volume),
    dollarVolume: numberValue(row.dollar_volume),
    resolution: signalResolution,
    signalTimeEt: row.signal_time_et,
    signalUnixSeconds: numberValue(row.signal_unix_seconds),
    signalPrice: numberValue(row.signal_price),
    signalRvol: numberValue(row.signal_rvol),
    breakoutLevel: numberValue(row.breakout_level),
    breakoutMode: row.breakout_mode,
    rvolMethod: "sameDayRolling",
    cumulativeVolumePace: null,
    barsScanned: numberValue(row.bars_scanned),
  };
}

export async function fetchCachedLongTermMomentumSignals(options: {
  etDate: string;
  resolution: IntradayResolution | "all";
  limit?: number;
}): Promise<LongTermMomentumCacheRead> {
  const admin = createAdminClient();
  if (!admin) return { available: false, error: "supabase_not_configured", hits: [] };

  let query = admin
    .from(LONG_TERM_MOMENTUM_TABLE)
    .select(
      "alert_key,et_date,ticker,name,reference_type,primary_exchange,signal_resolution,signal_unix_seconds,signal_time_et,signal_rvol,signal_price,change_pct,price_now,day_volume,dollar_volume,breakout_mode,breakout_level,bars_scanned",
    )
    .eq("et_date", options.etDate)
    .order("signal_unix_seconds", { ascending: false })
    .order("ticker", { ascending: true })
    .limit(options.limit ?? 500);

  if (options.resolution !== "all") {
    if (!isLongTermResolution(options.resolution)) return { available: true, error: null, hits: [] };
    query = query.eq("signal_resolution", options.resolution);
  }

  const { data, error } = await query;
  if (error) return { available: false, error: error.message, hits: [] };

  return {
    available: true,
    error: null,
    hits: ((data ?? []) as LongTermMomentumRow[]).map(rowToHit),
  };
}

export async function persistLongTermMomentumHits(
  hits: RvolScannerHit[],
  etDate: string,
): Promise<LongTermMomentumPersistResult> {
  const admin = createAdminClient();
  if (!admin) return { available: false, error: "supabase_not_configured", attempted: hits.length, persisted: 0 };

  const rows = hits
    .filter((hit) => isLongTermResolution(hit.resolution))
    .map((hit) => hitToRow(etDate, hit));
  if (rows.length === 0) return { available: true, error: null, attempted: 0, persisted: 0 };

  const { data, error } = await admin
    .from(LONG_TERM_MOMENTUM_TABLE)
    .upsert(rows, { onConflict: "alert_key" })
    .select("alert_key");

  if (error) {
    return { available: false, error: error.message, attempted: rows.length, persisted: 0 };
  }

  return {
    available: true,
    error: null,
    attempted: rows.length,
    persisted: ((data ?? []) as PersistedRow[]).length,
  };
}

export async function readLongTermMomentumCursor(scannerKey = LONG_TERM_MOMENTUM_SCANNER_KEY): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;

  const { data, error } = await admin
    .from(LONG_TERM_MOMENTUM_CURSOR_TABLE)
    .select("scanner_key,candidate_offset")
    .eq("scanner_key", scannerKey)
    .maybeSingle();

  if (error || !data) return 0;
  return Math.max(0, Math.floor(numberValue((data as CursorRow).candidate_offset)));
}

export async function writeLongTermMomentumCursor(
  candidateOffset: number,
  scannerKey = LONG_TERM_MOMENTUM_SCANNER_KEY,
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  await admin.from(LONG_TERM_MOMENTUM_CURSOR_TABLE).upsert(
    {
      scanner_key: scannerKey,
      candidate_offset: Math.max(0, Math.floor(candidateOffset)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "scanner_key" },
  );
}

export async function recordLongTermMomentumScanRun(input: RecordRunInput): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  await admin.from(LONG_TERM_MOMENTUM_RUN_TABLE).insert({
    scanner_key: input.scannerKey,
    status: input.status,
    et_date: input.etDate,
    candidate_offset: input.candidateOffset,
    next_candidate_offset: input.nextCandidateOffset,
    snapshot_pool: input.snapshotPool,
    candidate_limit: input.candidateLimit,
    min_price: input.minPrice,
    min_move_pct: input.minMovePct,
    max_price: input.maxPrice,
    primary_exchanges: input.primaryExchanges,
    scanned: input.scanned,
    signals: input.signals,
    error: input.error ?? null,
    scans: input.scans ?? [],
  });
}

export function longTermCachePayload(input: {
  etDate: string;
  fetchedAt?: string;
  resolution: IntradayResolution | "all";
  hits: RvolScannerHit[];
  scannerOptions: Pick<
    RvolScannerResult["universe"],
    | "snapshotPool"
    | "candidateLimit"
    | "candidateOffset"
    | "rawCandidateCount"
    | "minPrice"
    | "minMovePct"
    | "minDayVolume"
    | "maxPrice"
    | "primaryExchanges"
  >;
}) {
  const scans = LONG_TERM_MOMENTUM_RESOLUTIONS.map((resolution) => ({
    resolution,
    scanned: input.hits.filter((hit) => hit.resolution === resolution).length,
    signals: input.hits.filter((hit) => hit.resolution === resolution).length,
  }));

  return {
    etDate: input.etDate,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    source: "supabase-cache",
    resolution: input.resolution,
    universe: input.scannerOptions,
    scanned: input.hits.length,
    hits: input.hits,
    candidates: [],
    scans: input.resolution === "all" ? scans : undefined,
  };
}
