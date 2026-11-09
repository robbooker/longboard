// TODO(consolidation): polygonGet + ET helpers below are duplicated from
// lib/morning-email/polygon.ts. The duplication is intentional for the
// chart prototype (feat/chart-prototype-v0) to keep blast radius small.
// Consolidate into a single module in a follow-up cleanup PR — both this
// file and lib/morning-email/polygon.ts should then import from one source.

const POLYGON_BASE = "https://api.polygon.io";

const NY_TZ = "America/New_York";

export async function polygonGet<T>(path: string): Promise<T> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not configured");
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${POLYGON_BASE}${path}${sep}apiKey=${key}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Polygon ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export type PolygonAgg = { t: number; o: number; h: number; l: number; c: number; v: number };

/**
 * #386: every aggregate bar in a range, following next_url: Polygon cuts long ranges (an hour bar
 * history of three years) into pages, and stopping at the first page silently loses history.
 * Polygon includes extended hours in minute and hour bars by default. Bars come back oldest first.
 */
export async function polygonAggsAll(
  ticker: string,
  multiplier: number,
  timespan: "minute" | "hour" | "day",
  from: string | number,
  to: string | number,
  maxPages = 20,
): Promise<PolygonAgg[]> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not configured");
  let url: string | null =
    `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
  const bars: PolygonAgg[] = [];
  for (let page = 0; url && page < maxPages; page++) {
    const res = await fetch(url, { cache: "no-store" });
    // The error names the ticker and status only, never the address (it holds the key).
    if (!res.ok) throw new Error(`Polygon ${ticker} ${multiplier} ${timespan} bars returned ${res.status}`);
    const data = (await res.json()) as { results?: Partial<PolygonAgg>[]; next_url?: string };
    for (const r of data.results ?? []) {
      if ([r.t, r.o, r.h, r.l, r.c].every((n) => typeof n === "number" && Number.isFinite(n)))
        bars.push({ t: r.t!, o: r.o!, h: r.h!, l: r.l!, c: r.c!, v: typeof r.v === "number" ? r.v : 0 });
    }
    url = data.next_url ? `${data.next_url}${data.next_url.includes("?") ? "&" : "?"}apiKey=${key}` : null;
  }
  return bars;
}

export function nyDateParts(d: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallAsUtc - utcMs;
}

// DST-safe ET wall-clock → UTC ms. Two-step iteration so DST transitions resolve correctly.
export function nyClockToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const provisional = guess - tzOffsetMs(guess, NY_TZ);
  const offset = tzOffsetMs(provisional, NY_TZ);
  return guess - offset;
}

export function formatEtTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

export function formatEtDateTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}
