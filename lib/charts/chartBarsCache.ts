import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Resolution } from "@/lib/polygon/bars";
import type { Bar } from "@/lib/polygon/types";

const CHART_BARS_CACHE_TABLE = "chart_bars_cache";
const HISTORICAL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LIVE_CACHE_TTL_MS: Record<Resolution, number> = {
  "1m": 30 * 1000,
  "5m": 60 * 1000,
  "1h": 5 * 60 * 1000,
  "4h": 15 * 60 * 1000,
  "1d": 60 * 60 * 1000,
};

type ChartBarsCacheRow = {
  bars: unknown;
  fetched_at: string;
  expires_at: string;
};

export type CachedChartBarsResult = {
  bars: Bar[];
  fetchedAt: string;
  source: "supabase-cache" | "polygon";
  cache: {
    status: "hit" | "miss" | "unavailable" | "write_failed";
    expiresAt: string | null;
  };
};

type CacheInput = {
  ticker: string;
  etDate: string;
  latestEtDate: string;
  resolution: Resolution;
  lookbackDays: number;
  fetchLive: () => Promise<Bar[]>;
};

let cleanupAfter = 0;

function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function cacheTtlMs(resolution: Resolution, etDate: string, latestEtDate: string): number {
  if (etDate !== latestEtDate) return HISTORICAL_CACHE_TTL_MS;
  return LIVE_CACHE_TTL_MS[resolution];
}

function isBar(value: unknown): value is Bar {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Bar>;
  return (
    typeof row.time === "number" &&
    Number.isFinite(row.time) &&
    typeof row.open === "number" &&
    Number.isFinite(row.open) &&
    typeof row.high === "number" &&
    Number.isFinite(row.high) &&
    typeof row.low === "number" &&
    Number.isFinite(row.low) &&
    typeof row.close === "number" &&
    Number.isFinite(row.close) &&
    typeof row.volume === "number" &&
    Number.isFinite(row.volume)
  );
}

function parseBars(value: unknown): Bar[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(isBar)) return null;
  return value.slice().sort((a, b) => a.time - b.time);
}

async function cleanupExpiredRows(admin: SupabaseClient) {
  const now = Date.now();
  if (now < cleanupAfter) return;
  cleanupAfter = now + 60 * 60 * 1000;
  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  await admin.from(CHART_BARS_CACHE_TABLE).delete().lt("expires_at", cutoff);
}

async function readCachedBars(admin: SupabaseClient, input: CacheInput): Promise<CachedChartBarsResult | null> {
  await cleanupExpiredRows(admin).catch(() => undefined);
  const { data, error } = await admin
    .from(CHART_BARS_CACHE_TABLE)
    .select("bars,fetched_at,expires_at")
    .eq("ticker", input.ticker)
    .eq("resolution", input.resolution)
    .eq("et_date", input.etDate)
    .eq("lookback_days", input.lookbackDays)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  const row = data as ChartBarsCacheRow;
  const bars = parseBars(row.bars);
  if (!bars) return null;
  return {
    bars,
    fetchedAt: row.fetched_at,
    source: "supabase-cache",
    cache: {
      status: "hit",
      expiresAt: row.expires_at,
    },
  };
}

async function writeCachedBars(
  admin: SupabaseClient,
  input: CacheInput,
  bars: Bar[],
): Promise<{ expiresAt: string; error: string | null }> {
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + cacheTtlMs(input.resolution, input.etDate, input.latestEtDate));
  const { error } = await admin.from(CHART_BARS_CACHE_TABLE).upsert(
    {
      ticker: input.ticker,
      resolution: input.resolution,
      et_date: input.etDate,
      lookback_days: input.lookbackDays,
      bars,
      fetched_at: fetchedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: fetchedAt.toISOString(),
    },
    { onConflict: "ticker,resolution,et_date,lookback_days" },
  );

  return {
    expiresAt: expiresAt.toISOString(),
    error: error?.message ?? null,
  };
}

export async function fetchChartBarsWithCache(input: CacheInput): Promise<CachedChartBarsResult> {
  const admin = createAdminClient();
  if (admin) {
    const cached = await readCachedBars(admin, input).catch(() => null);
    if (cached) return cached;
  }

  const bars = await input.fetchLive();
  const fetchedAt = new Date().toISOString();
  if (!admin) {
    return {
      bars,
      fetchedAt,
      source: "polygon",
      cache: {
        status: "unavailable",
        expiresAt: null,
      },
    };
  }

  const write = await writeCachedBars(admin, input, bars).catch((error: unknown) => ({
    expiresAt: null,
    error: error instanceof Error ? error.message : "chart cache write failed",
  }));

  return {
    bars,
    fetchedAt,
    source: "polygon",
    cache: {
      status: write.error ? "write_failed" : "miss",
      expiresAt: write.expiresAt,
    },
  };
}
