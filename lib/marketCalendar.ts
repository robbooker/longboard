// Market-open check for the strategies morning routine. Wraps Polygon's
// /v1/marketstatus/now with a weekend short-circuit and a small
// hardcoded 2026 holiday list as a defense-in-depth fallback for when
// Polygon is unreachable. The cron schedule (Mon–Fri) already excludes
// weekends, so this helper's main job is catching US market holidays.

const POLYGON_BASE = "https://api.polygon.io";

/** Hard-coded 2026 US equity market holidays (NYSE / NASDAQ). Update
 *  annually; used only when the Polygon call fails or is not
 *  configured. Source: NYSE holiday calendar. */
const US_MARKET_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Jr. Day
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed — July 4 falls Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
]);

function todayInET(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function isWeekendET(): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date());
  return weekday === "Sat" || weekday === "Sun";
}

export type MarketStatusResult = {
  open: boolean;
  reason: "weekend" | "holiday" | "closed" | "open" | "extended-hours";
  source: "polygon" | "fallback";
};

/** Returns { open, reason, source }. The `open` flag is true only when
 *  the market is in regular session (9:30–16:00 ET) or extended-hours;
 *  false otherwise. Callers that want a stricter "regular session only"
 *  filter should check reason !== 'extended-hours' as well. */
export async function getMarketStatus(): Promise<MarketStatusResult> {
  if (isWeekendET()) {
    return { open: false, reason: "weekend", source: "fallback" };
  }
  if (US_MARKET_HOLIDAYS_2026.has(todayInET())) {
    return { open: false, reason: "holiday", source: "fallback" };
  }

  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    // No Polygon = fallback-only. Weekday + not-a-listed-holiday → open.
    return { open: true, reason: "open", source: "fallback" };
  }

  try {
    const res = await fetch(
      `${POLYGON_BASE}/v1/marketstatus/now?apiKey=${apiKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`polygon marketstatus ${res.status}`);
    const data = (await res.json()) as { market?: string };
    const market = data.market ?? "closed";
    if (market === "open") {
      return { open: true, reason: "open", source: "polygon" };
    }
    if (market === "extended-hours") {
      return { open: true, reason: "extended-hours", source: "polygon" };
    }
    return { open: false, reason: "closed", source: "polygon" };
  } catch {
    // Network or timeout — fall back to weekday + holiday check only.
    return { open: true, reason: "open", source: "fallback" };
  }
}

/** Thin convenience wrapper matching the name the handoff uses. */
export async function isMarketOpenToday(): Promise<boolean> {
  const status = await getMarketStatus();
  return status.open;
}
