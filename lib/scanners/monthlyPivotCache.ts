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

export async function enrichHitsWithCachedMonthlyPivots<T extends { ticker: string; priceNow: number }>(
  hits: T[],
  throughEtDate: string,
  options: { batchSize?: number; lookbackMonths?: number } = {},
): Promise<Array<T & MonthlyPivotEnrichment>> {
  const batchSize = options.batchSize ?? CACHE_BATCH_SIZE;
  const lookbackMonths = options.lookbackMonths ?? DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS;
  const admin = createAdminClient();

  if (admin) {
    await cleanupOldRows(admin, throughEtDate).catch(() => undefined);
  }

  const unique = new Map<string, { ticker: string; priceNow: number }>();
  for (const hit of hits) {
    if (!unique.has(hit.ticker)) {
      unique.set(hit.ticker, { ticker: hit.ticker, priceNow: hit.priceNow });
    }
  }

  const scans = new Map<string, MonthlyPivotEnrichment>();
  const tickers = [...unique.values()];

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const batchScans = await Promise.all(
      batch.map(async (row): Promise<[string, MonthlyPivotEnrichment]> => {
        try {
          const pivots = await getDailyPivots(admin, row.ticker, throughEtDate, lookbackMonths);
          const scan = selectMonthlyPivotTarget(pivots, row.priceNow);
          return [
            row.ticker,
            {
              monthlyPivotTarget: scan.target,
              monthlyPivotCount: scan.countAbovePrice,
              monthlyPivotError: null,
            },
          ];
        } catch (error) {
          return [
            row.ticker,
            {
              monthlyPivotTarget: null,
              monthlyPivotCount: 0,
              monthlyPivotError: error instanceof Error ? error.message : "Monthly pivot scan failed.",
            },
          ];
        }
      }),
    );

    for (const [ticker, scan] of batchScans) {
      scans.set(ticker, scan);
    }
  }

  return hits.map((hit) => ({
    ...hit,
    ...(scans.get(hit.ticker) ?? {
      monthlyPivotTarget: null,
      monthlyPivotCount: 0,
      monthlyPivotError: "Monthly pivot scan unavailable.",
    }),
  }));
}
