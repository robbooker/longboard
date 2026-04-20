// Research bundle for the Long/Short Portfolio morning run. Three
// pieces: top financial news (Exa, last 12h), today's earnings
// (Polygon), and pre-market movers (Polygon snapshot). Econ calendar is
// deferred to Phase 2 per audit Q4.
//
// Each layer is partial-success: a failure records in bundle.errors and
// the layer's data field goes empty rather than the whole bundle
// aborting. Claude gets what we have + the error list; the prompt
// instructs that it can still make a decision (or skip) on partial data.

const POLYGON_BASE = "https://api.polygon.io";

export type TopNewsItem = {
  title: string;
  url: string;
  published_at: string | null;
  highlights: string[];
  source?: string;
};

export type EarningsItem = {
  ticker: string;
  report_date: string;
  when: "pre-market" | "after-hours" | "unknown";
  eps_estimate: number | null;
  revenue_estimate: number | null;
};

export type MoverItem = {
  ticker: string;
  price: number;
  change_pct: number;
  volume: number;
  prev_close: number | null;
};

export type ResearchBundle = {
  as_of: string;                       // ISO UTC timestamp
  as_of_date_et: string;               // YYYY-MM-DD in America/New_York
  top_news: TopNewsItem[];
  earnings_today: EarningsItem[];
  pre_market_movers: MoverItem[];
  errors: string[];
};

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

// ── Top news (Exa) ────────────────────────────────────────────────

async function fetchTopNews(): Promise<TopNewsItem[]> {
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) throw new Error("EXA_API_KEY not configured");

  // Rough "last 12h" window by startPublishedDate; Exa treats this as
  // a soft bound so a few slightly-older items may surface.
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${exaKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        "markets OR stocks OR earnings OR fed site:reuters.com OR site:bloomberg.com OR site:wsj.com",
      type: "neural",
      numResults: 10,
      startPublishedDate: since,
      contents: { highlights: { numSentences: 2, highlightsPerUrl: 2 } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`exa ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      publishedDate?: string;
      highlights?: string[];
    }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    published_at: r.publishedDate ?? null,
    highlights: r.highlights ?? [],
    source: r.url ? safeHostname(r.url) : undefined,
  }));
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// ── Earnings (Finnhub) ────────────────────────────────────────────
// Originally Polygon per the handoff, but /vX/reference/earnings
// returns empty on this plan tier even on active earnings-season
// Mondays. Finnhub's /calendar/earnings is reliable on the free tier
// and returns bmo/amc/dmh timing flags.
//
// Window: yesterday + today in ET. AMC (after-market-close) reports
// from yesterday are the freshest overnight news the morning run can
// act on — handoff calls for them explicitly alongside today's BMO.

function yesterdayInET(): string {
  const now = new Date(Date.now() - 24 * 3600_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

async function fetchEarningsToday(): Promise<EarningsItem[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not configured");

  const today = todayInET();
  const yday = yesterdayInET();

  const res = await fetch(
    `https://finnhub.io/api/v1/calendar/earnings?from=${yday}&to=${today}&token=${key}`,
    { cache: "no-store", signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`finnhub earnings ${res.status}`);

  const data = (await res.json()) as {
    earningsCalendar?: Array<{
      symbol?: string;
      date?: string;
      hour?: string;            // "bmo" | "amc" | "dmh" | ""
      epsEstimate?: number | null;
      revenueEstimate?: number | null;
    }>;
  };

  const rows = data.earningsCalendar ?? [];

  // Keep: everything reported today (any hour) + yesterday-AMC only.
  // Yesterday-BMO / yesterday-DMH is stale news by morning.
  const kept = rows.filter((r) => {
    const d = r.date ?? "";
    if (d === today) return true;
    if (d === yday && (r.hour ?? "").toLowerCase() === "amc") return true;
    return false;
  });

  return kept.map((r) => {
    const h = (r.hour ?? "").toLowerCase();
    const when: EarningsItem["when"] =
      h === "bmo" ? "pre-market" :
      h === "amc" ? "after-hours" :
      "unknown";
    return {
      ticker: (r.symbol ?? "").toUpperCase(),
      report_date: r.date ?? today,
      when,
      eps_estimate: r.epsEstimate ?? null,
      revenue_estimate: r.revenueEstimate ?? null,
    };
  }).filter((r) => r.ticker);
}

// ── Pre-market movers (Polygon snapshot) ──────────────────────────

async function fetchPreMarketMovers(): Promise<MoverItem[]> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not configured");

  const res = await fetch(
    `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${key}`,
    { cache: "no-store", signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) throw new Error(`polygon snapshot ${res.status}`);
  const data = (await res.json()) as {
    tickers?: Array<{
      ticker?: string;
      todaysChange?: number;
      todaysChangePerc?: number;
      day?: { c?: number; v?: number };
      min?: { c?: number; v?: number };
      prevDay?: { c?: number };
    }>;
  };

  const VOL_FLOOR = 100_000;        // minimum "meaningful" pre-market volume
  const PCT_ABS_MIN = 1.0;          // only keep movers >1% either direction

  const moved = (data.tickers ?? [])
    .map((t) => {
      const ticker = t.ticker ?? "";
      const pct = t.todaysChangePerc ?? 0;
      const price = t.min?.c ?? t.day?.c ?? 0;
      const volume = t.day?.v ?? t.min?.v ?? 0;
      const prev = t.prevDay?.c ?? null;
      return { ticker, change_pct: pct, price, volume, prev_close: prev };
    })
    .filter((m) => m.ticker && Math.abs(m.change_pct) >= PCT_ABS_MIN && m.volume >= VOL_FLOOR)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, 25);

  return moved;
}

// ── Assembler ─────────────────────────────────────────────────────

/** Assembles the morning research bundle. Partial-success; any layer
 *  that throws contributes a message to `errors` and its data field
 *  stays empty. Caller should surface `errors.length > 0` to Claude so
 *  it knows the input was incomplete. */
export async function assembleResearchBundle(): Promise<ResearchBundle> {
  const errors: string[] = [];

  const [newsRes, earningsRes, moversRes] = await Promise.allSettled([
    fetchTopNews(),
    fetchEarningsToday(),
    fetchPreMarketMovers(),
  ]);

  const top_news = newsRes.status === "fulfilled" ? newsRes.value : [];
  const earnings_today = earningsRes.status === "fulfilled" ? earningsRes.value : [];
  const pre_market_movers = moversRes.status === "fulfilled" ? moversRes.value : [];

  if (newsRes.status === "rejected") {
    errors.push(`news: ${(newsRes.reason as Error)?.message ?? "failed"}`);
  }
  if (earningsRes.status === "rejected") {
    errors.push(`earnings: ${(earningsRes.reason as Error)?.message ?? "failed"}`);
  }
  if (moversRes.status === "rejected") {
    errors.push(`movers: ${(moversRes.reason as Error)?.message ?? "failed"}`);
  }

  return {
    as_of: new Date().toISOString(),
    as_of_date_et: todayInET(),
    top_news,
    earnings_today,
    pre_market_movers,
    errors,
  };
}
