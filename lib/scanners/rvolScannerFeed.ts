import { createClient } from "@supabase/supabase-js";
import {
  fetchCurrentRvolSnapshotCandidates,
  type RvolScannerHit,
  type RvolScannerResult,
} from "@/lib/scanners/rvolScanner";
import {
  applyMonthlyPivots,
  loadCachedMonthlyPivots,
  type MonthlyPivotLoad,
} from "@/lib/scanners/monthlyPivotCache";
import {
  SHARED_INTRADAY_RESOLUTIONS,
  getSharedIntradayScans,
  readShared,
  sharedFreshnessMs,
  singleFlight,
  writeShared,
  type SharedEntry,
  type SharedIntradayResolution,
} from "@/lib/scanners/rvolSharedCache";

// The intraday page feed for /api/command2/rvol-scanner: the shared 1m + 5m scans, today's
// alert history and the monthly pivots, gathered once into a "bundle" that every open tab
// reads. Each request then only slices the bundle (resolution, candidate limit), which gives
// the same rows the route used to compute per request.

type IntradaySignalResolution = SharedIntradayResolution;
export type IntradayResolutionFilter = IntradaySignalResolution | "all";

type AlertHistoryRow = {
  ticker: string;
  signal_resolution?: IntradaySignalResolution | null;
  signal_unix_seconds: number | string;
  signal_time_et: string;
  signal_rvol: number | string;
  signal_price: number | string;
  change_pct: number | string;
  signal_breakout_mode?: RvolScannerHit["breakoutMode"] | null;
  breakout_level?: number | string | null;
  rvol_method?: RvolScannerHit["rvolMethod"] | null;
};

/** One of today's dispatched alerts, rebuilt as a scanner row with current prices. */
export type AlertHistoryHit = {
  /** The stored signal_resolution (null on old rows); the per-resolution views filter on it. */
  storedResolution: string | null;
  /** null for a row the old code skipped (missing price, RVOL or time); it still counts toward the row limit. */
  hit: RvolScannerHit | null;
};

export type IntradayBundle = {
  etDate: string;
  scans: Record<SharedIntradayResolution, RvolScannerResult>;
  /** Newest first, ticker A–Z (the old per-request query order). */
  alertHistory: AlertHistoryHit[];
  pivots: Record<string, MonthlyPivotLoad>;
};

// The old per-request query read at most this many rows (per resolution, or overall for "all").
const ALERT_HISTORY_VIEW_LIMIT = 500;
const ALERT_HISTORY_BUNDLE_LIMIT = 2_000;
const FORCE_REFRESH_MIN_AGE_MS = 15_000;

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intradayResolution(value: unknown): IntradaySignalResolution {
  return value === "5m" ? "5m" : "1m";
}

export function alertHitKey(hit: Pick<RvolScannerHit, "resolution" | "ticker" | "signalUnixSeconds">) {
  return `${hit.resolution}:${hit.ticker}:${hit.signalUnixSeconds}`;
}

async function fetchTodayAlertHistory(etDate: string): Promise<AlertHistoryHit[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const { data, error } = await admin
    .from("rvol_alert_dispatches")
    .select("ticker,signal_resolution,signal_unix_seconds,signal_time_et,signal_rvol,signal_price,change_pct,signal_breakout_mode,breakout_level,rvol_method")
    .eq("et_date", etDate)
    .order("signal_unix_seconds", { ascending: false })
    .order("ticker", { ascending: true })
    .limit(ALERT_HISTORY_BUNDLE_LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as AlertHistoryRow[];
  const currentByTicker = await fetchCurrentRvolSnapshotCandidates(rows.map((row) => row.ticker));
  const hits: AlertHistoryHit[] = [];

  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    const signalUnixSeconds = numberValue(row.signal_unix_seconds);
    const signalPrice = numberValue(row.signal_price);
    const signalRvol = numberValue(row.signal_rvol);
    // Keep the row's slot so the per-resolution 500-row cut matches the old query.
    if (!ticker || !signalUnixSeconds || !signalPrice || !signalRvol) {
      hits.push({ storedResolution: row.signal_resolution ?? null, hit: null });
      continue;
    }

    const current = currentByTicker.get(ticker);
    const changePct = current?.changePct ?? numberValue(row.change_pct) ?? 0;
    const priceNow = current?.priceNow ?? signalPrice;
    const dayHigh = current?.dayHigh ?? Math.max(priceNow, signalPrice);
    const dayVolume = current?.dayVolume ?? 0;

    hits.push({
      storedResolution: row.signal_resolution ?? null,
      hit: {
        ticker,
        change: current?.change ?? 0,
        changePct,
        priceNow,
        dayHigh,
        dayVolume,
        dollarVolume: current?.dollarVolume ?? dayVolume * priceNow,
        updated: current?.updated,
        name: current?.name ?? null,
        referenceType: current?.referenceType ?? null,
        primaryExchange: current?.primaryExchange ?? null,
        resolution: intradayResolution(row.signal_resolution),
        signalTimeEt: row.signal_time_et,
        signalUnixSeconds,
        signalPrice,
        signalRvol,
        breakoutLevel: numberValue(row.breakout_level) ?? 0,
        breakoutMode: row.signal_breakout_mode === "openingRangeHigh" ? "openingRangeHigh" : "premarketHigh",
        rvolMethod: row.rvol_method === "historicalTimeOfDay" ? "historicalTimeOfDay" : "sameDayRolling",
        cumulativeVolumePace: null,
        barsScanned: 0,
      },
    });
  }

  return hits;
}

/** Today's alert rows for one view, cut like the old per-request query. */
export function alertHitsForView(
  history: AlertHistoryHit[],
  resolution: IntradayResolutionFilter,
): RvolScannerHit[] {
  const rows = resolution === "all" ? history : history.filter((row) => row.storedResolution === resolution);
  return rows
    .slice(0, ALERT_HISTORY_VIEW_LIMIT)
    .map((row) => row.hit)
    .filter((hit): hit is RvolScannerHit => Boolean(hit));
}

/** Today's alert rows for one view, read directly (for non-default dates and filters). */
export async function fetchTodayAlertHitsForView(
  etDate: string,
  resolution: IntradayResolutionFilter,
): Promise<RvolScannerHit[]> {
  return alertHitsForView(await fetchTodayAlertHistory(etDate), resolution);
}

export function mergeAlertHistoryWithLiveHits(
  liveHits: RvolScannerHit[],
  todayAlertHits: RvolScannerHit[],
): RvolScannerHit[] {
  const bySignal = new Map<string, RvolScannerHit>();
  for (const hit of todayAlertHits) {
    bySignal.set(alertHitKey(hit), hit);
  }
  for (const hit of liveHits) {
    bySignal.set(alertHitKey(hit), hit);
  }
  return Array.from(bySignal.values()).sort((a, b) =>
    b.signalUnixSeconds - a.signalUnixSeconds ||
    b.changePct - a.changePct ||
    a.resolution.localeCompare(b.resolution) ||
    a.ticker.localeCompare(b.ticker),
  );
}

/**
 * The scan as a smaller candidate limit would have produced it. Reference filtering keeps
 * candidates in order and stops at the limit, so a limit-N scan is the first N candidates
 * of the limit-40 scan, with their hits and diagnostics.
 */
export function limitScan(scan: RvolScannerResult, candidateLimit: number): RvolScannerResult {
  if (candidateLimit >= scan.universe.candidateLimit) return scan;
  const candidates = scan.candidates.slice(0, candidateLimit);
  const kept = new Set(candidates.map((candidate) => candidate.ticker));
  return {
    ...scan,
    universe: { ...scan.universe, candidateLimit },
    scanned: candidates.length,
    candidates,
    hits: scan.hits.filter((hit) => kept.has(hit.ticker)),
    diagnostics: scan.diagnostics.filter((diagnostic) => kept.has(diagnostic.ticker)),
  };
}

async function buildIntradayBundle(etDate: string, scanMaxAgeMs: number): Promise<IntradayBundle> {
  const [scans, alertHistory] = await Promise.all([
    getSharedIntradayScans(etDate, { maxAgeMs: scanMaxAgeMs }),
    fetchTodayAlertHistory(etDate),
  ]);
  const tickers = [
    ...SHARED_INTRADAY_RESOLUTIONS.flatMap((resolution) => scans[resolution].hits.map((hit) => hit.ticker)),
    ...alertHistory.flatMap((row) => (row.hit ? [row.hit.ticker] : [])),
  ];
  const pivots = await loadCachedMonthlyPivots(tickers, etDate);
  return { etDate, scans, alertHistory, pivots: Object.fromEntries(pivots) };
}

function bundleKey(etDate: string) {
  return `bundle:${etDate}`;
}

function rebuildBundle(etDate: string, scanMaxAgeMs: number): Promise<SharedEntry<IntradayBundle>> {
  return singleFlight(bundleKey(etDate), async () => {
    const value = await buildIntradayBundle(etDate, scanMaxAgeMs);
    const entry = { computedAt: Date.now(), value };
    await writeShared(bundleKey(etDate), value, entry.computedAt);
    return entry;
  });
}

export type BundleRead = {
  entry: SharedEntry<IntradayBundle>;
  /** Set when the copy served is older than the freshness window; call it after responding. */
  refreshInBackground: (() => Promise<unknown>) | null;
};

/**
 * The shared bundle. Fresh copy: served as is. Somewhat stale copy: served now and refreshed
 * in the background. Missing or very stale, or a manual refresh of a copy older than 15 s:
 * rebuilt before answering.
 */
export async function readIntradayBundle(
  etDate: string,
  options: { force?: boolean; now?: number } = {},
): Promise<BundleRead> {
  const now = options.now ?? Date.now();
  const freshMs = sharedFreshnessMs(new Date(now));
  const entry = await readShared<IntradayBundle>(bundleKey(etDate));
  const age = entry ? now - entry.computedAt : Infinity;

  if (!entry || age > freshMs * 5 || (options.force && age > FORCE_REFRESH_MIN_AGE_MS)) {
    // A manual refresh also asks for scans no older than 15 s.
    const scanMaxAgeMs = options.force ? FORCE_REFRESH_MIN_AGE_MS : freshMs;
    return { entry: await rebuildBundle(etDate, scanMaxAgeMs), refreshInBackground: null };
  }
  if (age > freshMs) {
    return { entry, refreshInBackground: () => rebuildBundle(etDate, freshMs) };
  }
  return { entry, refreshInBackground: null };
}

export const MONTHLY_PIVOTS_META = { enabled: true, cached: true, lookbackMonths: 36 } as const;

/** The JSON the route returned for an intraday request, built from the shared bundle. */
export function intradayPayload(
  bundle: IntradayBundle,
  resolution: IntradayResolutionFilter,
  candidateLimit: number,
) {
  const pivots = new Map(Object.entries(bundle.pivots));
  if (resolution !== "all") {
    const scan = limitScan(bundle.scans[resolution], candidateLimit);
    const todayAlertHits = alertHitsForView(bundle.alertHistory, resolution);
    const hits = applyMonthlyPivots(mergeAlertHistoryWithLiveHits(scan.hits, todayAlertHits), pivots);
    return {
      ...scan,
      fetchedAt: scan.fetchedAt,
      mode: "intraday" as const,
      hits,
      liveSignalCount: scan.hits.length,
      todayAlertCount: todayAlertHits.length,
      monthlyPivots: MONTHLY_PIVOTS_META,
    };
  }

  const scans = SHARED_INTRADAY_RESOLUTIONS.map((next) => limitScan(bundle.scans[next], candidateLimit));
  const [firstScan] = scans;
  const combinedLiveHits = scans
    .flatMap((scan) => scan.hits)
    .sort((a, b) =>
      b.changePct - a.changePct ||
      a.signalUnixSeconds - b.signalUnixSeconds ||
      a.resolution.localeCompare(b.resolution) ||
      a.ticker.localeCompare(b.ticker),
    );
  const todayAlertHits = alertHitsForView(bundle.alertHistory, "all");
  const hits = applyMonthlyPivots(mergeAlertHistoryWithLiveHits(combinedLiveHits, todayAlertHits), pivots);
  // "Updated" shows the age of the older of the two scans.
  const fetchedAt = scans.map((scan) => scan.fetchedAt).sort()[0] ?? firstScan.fetchedAt;
  return {
    ...firstScan,
    fetchedAt,
    mode: "intraday" as const,
    resolution,
    scanned: Math.max(...scans.map((scan) => scan.scanned)),
    hits,
    liveSignalCount: combinedLiveHits.length,
    todayAlertCount: todayAlertHits.length,
    scans: scans.map((scan) => ({
      resolution: scan.resolution,
      scanned: scan.scanned,
      signals: scan.hits.length,
    })),
    monthlyPivots: MONTHLY_PIVOTS_META,
  };
}

/**
 * Shared copy of any other scanner response (long-term mode, non-default filters):
 * recomputed at most once per freshness window, or on a manual refresh older than 15 s.
 */
export async function sharedResponse<T>(
  key: string,
  build: () => Promise<T>,
  options: { force?: boolean } = {},
): Promise<{ value: T; computedAt: number }> {
  const now = Date.now();
  const entry = await readShared<T>(`response:${key}`);
  const age = entry ? now - entry.computedAt : Infinity;
  const limit = options.force ? FORCE_REFRESH_MIN_AGE_MS : sharedFreshnessMs(new Date(now));
  if (entry && age <= limit) return { value: entry.value, computedAt: entry.computedAt };
  return singleFlight(`response:${key}`, async () => {
    const value = await build();
    const computedAt = Date.now();
    await writeShared(`response:${key}`, value, computedAt);
    return { value, computedAt };
  });
}
