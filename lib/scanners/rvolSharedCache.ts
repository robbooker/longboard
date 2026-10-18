import { getCache } from "@vercel/functions";
import {
  scanRvolBuySignalsForResolutions,
  type RvolScannerResult,
} from "@/lib/scanners/rvolScanner";
import type { IntradayResolution } from "@/lib/polygon/bars";
import { etClockParts } from "@/lib/time/etClock";

// One shared copy of the RVOL scanner results for every open page.
//
// Before this, each open /scanner3, /charts and mini-scanner tab re-ran the full market scan
// every 60 s. Now the 5-minute alert cron stores the scans it already computes, and the page
// route reads that stored copy (Vercel Runtime Cache, shared by every function in the region).
// When the stored copy is older than the freshness window, the first reader recomputes it
// once and stores it again, so at most one scan per window runs no matter how many tabs are
// open. Locally (no Runtime Cache) it falls back to an in-memory copy per server.

const CACHE_VERSION = "v1";
const ENTRY_TTL_SECONDS = 6 * 60 * 60;
// While the market (incl. pre/after hours) is open, results are at most a minute old.
const ACTIVE_FRESH_MS = 60_000;
// Overnight and on weekends the data does not change.
const QUIET_FRESH_MS = 15 * 60_000;

export const SHARED_INTRADAY_RESOLUTIONS = ["1m", "5m"] as const satisfies readonly IntradayResolution[];
export type SharedIntradayResolution = (typeof SHARED_INTRADAY_RESOLUTIONS)[number];

export type SharedEntry<T> = { computedAt: number; value: T };

type CacheLike = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[]; name?: string }): Promise<void>;
};

let cacheOverride: CacheLike | null = null;

/** Test hook: swap the shared store (null restores the real one). */
export function setRvolSharedCacheForTests(cache: CacheLike | null) {
  cacheOverride = cache;
  inFlight.clear();
}

function cache(): CacheLike {
  return cacheOverride ?? (getCache({ namespace: "rvol-scanner" }) as CacheLike);
}

function isMarketActive(now: Date): boolean {
  const parts = etClockParts(Math.floor(now.getTime() / 1000));
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 4 * 60 && minutes < 20 * 60;
}

/** How old a shared result may be before a reader recomputes it. */
export function sharedFreshnessMs(now: Date = new Date()): number {
  return isMarketActive(now) ? ACTIVE_FRESH_MS : QUIET_FRESH_MS;
}

export async function readShared<T>(key: string): Promise<SharedEntry<T> | null> {
  try {
    const value = (await cache().get(`${CACHE_VERSION}:${key}`)) as SharedEntry<T> | undefined | null;
    if (!value || typeof value !== "object" || typeof value.computedAt !== "number") return null;
    return value;
  } catch (error) {
    console.error("rvol_shared_cache_read_failed", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function writeShared<T>(key: string, value: T, computedAt = Date.now()): Promise<void> {
  try {
    await cache().set(`${CACHE_VERSION}:${key}`, { computedAt, value } satisfies SharedEntry<T>, {
      ttl: ENTRY_TTL_SECONDS,
      tags: ["rvol-scanner"],
      name: key.split(":")[0],
    });
  } catch (error) {
    console.error("rvol_shared_cache_write_failed", error instanceof Error ? error.message : error);
  }
}

// One computation per key per server instance at a time; concurrent readers share it.
const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = compute().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function isFresh(entry: SharedEntry<unknown> | null, maxAgeMs: number, now = Date.now()): boolean {
  return Boolean(entry && now - entry.computedAt <= maxAgeMs);
}

function scanKey(etDate: string, resolution: SharedIntradayResolution) {
  return `scan:${etDate}:${resolution}`;
}

/**
 * Stores scans computed with the default intraday options (the alert cron's scans).
 * Never throws: storing is best effort and must not affect alerts.
 */
export async function storeSharedIntradayScans(results: RvolScannerResult[]): Promise<void> {
  await Promise.all(
    results
      .filter((result): result is RvolScannerResult & { resolution: SharedIntradayResolution } =>
        (SHARED_INTRADAY_RESOLUTIONS as readonly string[]).includes(result.resolution),
      )
      .map((result) => writeShared(scanKey(result.etDate, result.resolution), result, Date.parse(result.fetchedAt) || Date.now())),
  );
}

/**
 * The default intraday scans (same options as the alert cron) for each resolution, from the
 * shared store when fresh, otherwise computed once (sharing one market snapshot) and stored.
 */
export async function getSharedIntradayScans(
  etDate: string,
  options: { maxAgeMs?: number } = {},
): Promise<Record<SharedIntradayResolution, RvolScannerResult>> {
  const maxAgeMs = options.maxAgeMs ?? sharedFreshnessMs();
  const entries = await Promise.all(
    SHARED_INTRADAY_RESOLUTIONS.map((resolution) => readShared<RvolScannerResult>(scanKey(etDate, resolution))),
  );
  const out = {} as Record<SharedIntradayResolution, RvolScannerResult>;
  const missing: SharedIntradayResolution[] = [];
  SHARED_INTRADAY_RESOLUTIONS.forEach((resolution, index) => {
    const entry = entries[index];
    if (entry && isFresh(entry, maxAgeMs)) out[resolution] = entry.value;
    else missing.push(resolution);
  });
  if (missing.length === 0) return out;

  const scans = await singleFlight(`scan:${etDate}:${missing.join(",")}`, async () => {
    const results = await scanRvolBuySignalsForResolutions(missing, { etDate });
    await storeSharedIntradayScans(results);
    return results;
  });
  for (const scan of scans) out[scan.resolution as SharedIntradayResolution] = scan;
  return out;
}
