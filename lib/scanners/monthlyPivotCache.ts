import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS,
  scanAllMissedMonthlyPivots,
  selectMonthlyPivotTarget,
  type MissedMonthlyPivot,
  type MonthlyPivotEnrichment,
} from "@/lib/scanners/monthlyPivots";

type CacheRow = {
  et_date: string;
  ticker: string;
  lookback_months: number;
  pivots: unknown;
  computed_at: string;
  updated_at: string;
};

const CACHE_BATCH_SIZE = 8;
let cleanupDate: string | null = null;

function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isPivot(value: unknown): value is MissedMonthlyPivot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.price === "number" &&
    Number.isFinite(row.price) &&
    typeof row.sourceMonth === "string" &&
    typeof row.sourceMonthLabel === "string" &&
    typeof row.activeMonth === "string" &&
    typeof row.activeMonthLabel === "string" &&
    typeof row.activeFromDate === "string" &&
    typeof row.lastCheckedDate === "string"
  );
}

function parsePivots(value: unknown): MissedMonthlyPivot[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(isPivot)) return null;
  return value.slice().sort((a, b) => a.price - b.price);
}

async function cleanupOldRows(admin: SupabaseClient, etDate: string) {
  if (cleanupDate === etDate) return;
  cleanupDate = etDate;
  await admin.from("rvol_monthly_pivot_cache").delete().lt("et_date", etDate);
}

async function readCachedPivots(
  admin: SupabaseClient,
  ticker: string,
  etDate: string,
  lookbackMonths: number,
): Promise<MissedMonthlyPivot[] | null> {
  const { data, error } = await admin
    .from("rvol_monthly_pivot_cache")
    .select("et_date,ticker,lookback_months,pivots,computed_at,updated_at")
    .eq("et_date", etDate)
    .eq("ticker", ticker)
    .eq("lookback_months", lookbackMonths)
    .maybeSingle();

  if (error || !data) return null;
  return parsePivots((data as CacheRow).pivots);
}

async function writeCachedPivots(
  admin: SupabaseClient,
  ticker: string,
  etDate: string,
  lookbackMonths: number,
  pivots: MissedMonthlyPivot[],
) {
  const now = new Date().toISOString();
  await admin.from("rvol_monthly_pivot_cache").upsert(
    {
      et_date: etDate,
      ticker,
      lookback_months: lookbackMonths,
      pivots,
      computed_at: now,
      updated_at: now,
    },
    { onConflict: "et_date,ticker,lookback_months" },
  );
}

async function getDailyPivots(
  admin: SupabaseClient | null,
  ticker: string,
  etDate: string,
  lookbackMonths: number,
): Promise<MissedMonthlyPivot[]> {
  if (admin) {
    const cached = await readCachedPivots(admin, ticker, etDate, lookbackMonths);
    if (cached) return cached;
  }

  const pivots = await scanAllMissedMonthlyPivots(ticker, etDate, { lookbackMonths });

  if (admin) {
    await writeCachedPivots(admin, ticker, etDate, lookbackMonths, pivots);
  }

  return pivots;
}

export type MonthlyPivotLoad = { pivots: MissedMonthlyPivot[] } | { error: string };

/** Loads each ticker's cached (or freshly computed) monthly pivots for the day. */
export async function loadCachedMonthlyPivots(
  tickers: string[],
  throughEtDate: string,
  options: { batchSize?: number; lookbackMonths?: number } = {},
): Promise<Map<string, MonthlyPivotLoad>> {
  const batchSize = options.batchSize ?? CACHE_BATCH_SIZE;
  const lookbackMonths = options.lookbackMonths ?? DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS;
  const admin = createAdminClient();

  if (admin) {
    await cleanupOldRows(admin, throughEtDate).catch(() => undefined);
  }

  const unique = [...new Set(tickers)];
  const loads = new Map<string, MonthlyPivotLoad>();

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const batchLoads = await Promise.all(
      batch.map(async (ticker): Promise<[string, MonthlyPivotLoad]> => {
        try {
          return [ticker, { pivots: await getDailyPivots(admin, ticker, throughEtDate, lookbackMonths) }];
        } catch (error) {
          return [ticker, { error: error instanceof Error ? error.message : "Monthly pivot scan failed." }];
        }
      }),
    );

    for (const [ticker, load] of batchLoads) {
      loads.set(ticker, load);
    }
  }

  return loads;
}

/**
 * Adds the monthly pivot target to each hit. Like before, a ticker's target is picked
 * against the first hit's price for that ticker and shared by all its hits.
 */
export function applyMonthlyPivots<T extends { ticker: string; priceNow: number }>(
  hits: T[],
  loads: Map<string, MonthlyPivotLoad>,
): Array<T & MonthlyPivotEnrichment> {
  const scans = new Map<string, MonthlyPivotEnrichment>();
  for (const hit of hits) {
    if (scans.has(hit.ticker)) continue;
    const load = loads.get(hit.ticker);
    if (!load) continue;
    if ("error" in load) {
      scans.set(hit.ticker, {
        monthlyPivotTarget: null,
        monthlyPivotCount: 0,
        monthlyPivotsAbovePrice: [],
        monthlyPivotError: load.error,
      });
      continue;
    }
    const scan = selectMonthlyPivotTarget(load.pivots, hit.priceNow);
    scans.set(hit.ticker, {
      monthlyPivotTarget: scan.target,
      monthlyPivotCount: scan.countAbovePrice,
      monthlyPivotsAbovePrice: scan.pivotsAbovePrice,
      monthlyPivotError: null,
    });
  }

  return hits.map((hit) => ({
    ...hit,
    ...(scans.get(hit.ticker) ?? {
      monthlyPivotTarget: null,
      monthlyPivotCount: 0,
      monthlyPivotsAbovePrice: [],
      monthlyPivotError: "Monthly pivot scan unavailable.",
    }),
  }));
}

export async function enrichHitsWithCachedMonthlyPivots<T extends { ticker: string; priceNow: number }>(
  hits: T[],
  throughEtDate: string,
  options: { batchSize?: number; lookbackMonths?: number } = {},
): Promise<Array<T & MonthlyPivotEnrichment>> {
  const loads = await loadCachedMonthlyPivots(hits.map((hit) => hit.ticker), throughEtDate, options);
  return applyMonthlyPivots(hits, loads);
}

export async function getCachedMonthlyPivotEnrichment(
  ticker: string,
  currentPrice: number,
  throughEtDate: string,
  options: { lookbackMonths?: number } = {},
): Promise<MonthlyPivotEnrichment> {
  const lookbackMonths = options.lookbackMonths ?? DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS;
  const admin = createAdminClient();

  if (admin) {
    await cleanupOldRows(admin, throughEtDate).catch(() => undefined);
  }

  try {
    const pivots = await getDailyPivots(admin, ticker, throughEtDate, lookbackMonths);
    const scan = selectMonthlyPivotTarget(pivots, currentPrice);
    return {
      monthlyPivotTarget: scan.target,
      monthlyPivotCount: scan.countAbovePrice,
      monthlyPivotsAbovePrice: scan.pivotsAbovePrice,
      monthlyPivotError: null,
    };
  } catch (error) {
    return {
      monthlyPivotTarget: null,
      monthlyPivotCount: 0,
      monthlyPivotsAbovePrice: [],
      monthlyPivotError: error instanceof Error ? error.message : "Monthly pivot scan failed.",
    };
  }
}
