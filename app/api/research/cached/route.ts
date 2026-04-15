import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Row as it lives in Postgres. Uses rank_position (rank is reserved). */
type TickerResearchDbRow = {
  ticker: string;
  as_of_date: string;
  rank_position: number | null;
  rank_reason: string | null;
  research: Record<string, unknown>;
  last_price: number | null;
  last_price_updated_at: string | null;
  created_at: string;
};

/** Row as it appears in the JSON response. Aliases rank_position → rank
 *  so the DB-internal name doesn't leak to the UI. Everything else
 *  passes through verbatim. */
type TickerResearchApiRow = {
  ticker: string;
  as_of_date: string;
  rank: number | null;
  rank_reason: string | null;
  research: Record<string, unknown>;
  last_price: number | null;
  last_price_updated_at: string | null;
  created_at: string;
};

function toApiRow(r: TickerResearchDbRow): TickerResearchApiRow {
  return {
    ticker: r.ticker,
    as_of_date: r.as_of_date,
    rank: r.rank_position,
    rank_reason: r.rank_reason,
    research: r.research,
    last_price: r.last_price,
    last_price_updated_at: r.last_price_updated_at,
    created_at: r.created_at,
  };
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Current date in America/New_York as YYYY-MM-DD. We key ticker_research
 *  on the trading day, not UTC, so users loading the page at 11pm ET don't
 *  see "yesterday's UTC day" data. */
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

/** Returns the most recent date present in ticker_research, or null if
 *  the table is empty. Used as the fallback when today has no rows yet
 *  (first deploy, cron hasn't fired, holiday skip). */
async function mostRecentDate(admin: ReturnType<typeof adminClient>): Promise<string | null> {
  const { data, error } = await admin
    .from("ticker_research")
    .select("as_of_date")
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { as_of_date: string }).as_of_date;
}

/** Returns today's cached research for every ranked ticker. If today is
 *  empty (e.g. before the first cron fire of the day), falls back to the
 *  most recent date we have rows for so the UI never ships empty unless
 *  the table is genuinely fresh. Rows come back ordered by rank asc, nulls
 *  last, ticker as secondary. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const admin = adminClient();

  try {
    const today = todayInET();
    const selectCols = "ticker, as_of_date, rank_position, rank_reason, research, last_price, last_price_updated_at, created_at";
    const { data: todaysRows, error: todayErr } = await admin
      .from("ticker_research")
      .select(selectCols)
      .eq("as_of_date", today);
    if (todayErr) throw new Error(todayErr.message);

    let dbRows = (todaysRows ?? []) as TickerResearchDbRow[];
    let asOfDate = today;

    if (dbRows.length === 0) {
      const fallback = await mostRecentDate(admin);
      if (fallback) {
        const { data: olderRows, error: olderErr } = await admin
          .from("ticker_research")
          .select(selectCols)
          .eq("as_of_date", fallback);
        if (olderErr) throw new Error(olderErr.message);
        dbRows = (olderRows ?? []) as TickerResearchDbRow[];
        asOfDate = fallback;
      }
    }

    dbRows.sort((a, b) => {
      const ar = a.rank_position ?? Number.POSITIVE_INFINITY;
      const br = b.rank_position ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return a.ticker < b.ticker ? -1 : 1;
    });

    const rows = dbRows.map(toApiRow);
    return NextResponse.json({ rows, asOfDate, isFallback: rows.length > 0 && asOfDate !== today });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "fetch_failed", message: msg }, { status: 500 });
  }
}
