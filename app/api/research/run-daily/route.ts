import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { briefToSummary } from "@/lib/research-format";
import type { ResearchBrief } from "@/types/research";
import type { GainersData } from "@/types/polygon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Tens-of-seconds budget. 10 tickers × ~10s research in parallel + 3–5s
 *  Anthropic call + <1s DB writes ≈ ~15–20s worst case. 120s leaves
 *  headroom for Polygon/EDGAR hiccups without letting a stuck run hang
 *  forever. */
export const maxDuration = 120;

type Ranking = { ticker: string; rank: number; rank_reason: string };
type DailyResult = {
  rowsWritten: number;
  tickersProcessed: string[];
  errors: string[];
  durationMs: number;
  asOfDate: string;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

/** Calls Anthropic Sonnet with the ranking prompt from the Phase 3E audit.
 *  Returns the parsed ranking objects. Drops hallucinated tickers (any
 *  ticker the model returned that wasn't in the input brief list) and
 *  caps rank_reason at 300 chars. Throws on transport / parse failure so
 *  the caller can downgrade to "write rows without rank" rather than
 *  failing the whole daily run. */
async function rankWithAnthropic(briefs: ResearchBrief[]): Promise<Ranking[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const summaries = briefs.map(briefToSummary).join("\n\n---\n\n");
  const systemPrompt = "You are a ranking assistant for a day trader. You rank a small list of stocks by how attractive each one is as a momentum play for the current trading day. Your rank_reason for each stock is one sentence, specific and concrete. Never refer to external data beyond what's in the brief.";

  const userPrompt = `Rank the following ${briefs.length} stocks from #1 (best momentum play today) to #${briefs.length} (worst). For each stock, give a rank_reason (one sentence, <= 200 chars) that explicitly cites:
  1. the primary catalyst or current price action,
  2. the strongest risk flag (going concern, shelf registration, low cash on hand, extreme % gain suggesting extension),
  3. a setup quality signal (float size, volume vs average) when available.

${summaries}

Respond with ONLY valid JSON, no prose outside the JSON object:

{
  "ranked": [
    { "ticker": "ABC", "rank": 1, "rank_reason": "..." }
  ]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`anthropic ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("no JSON object in anthropic response");

  const parsed = JSON.parse(jsonMatch[0]) as { ranked?: unknown };
  if (!Array.isArray(parsed.ranked)) return [];

  const inputTickers = new Set(briefs.map((b) => b.ticker));
  const out: Ranking[] = [];
  for (const r of parsed.ranked) {
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const ticker = typeof rec.ticker === "string" ? rec.ticker.toUpperCase() : null;
    const rank = typeof rec.rank === "number" && Number.isFinite(rec.rank) ? Math.round(rec.rank) : null;
    const rankReason = typeof rec.rank_reason === "string" ? rec.rank_reason.slice(0, 300) : null;
    if (!ticker || rank === null || rankReason === null) continue;
    if (!inputTickers.has(ticker)) continue;
    out.push({ ticker, rank, rank_reason: rankReason });
  }
  return out;
}

/** Main orchestration. Called from both GET (cron) and POST (manual admin).
 *  All four steps — gainers → per-ticker research → Anthropic rank →
 *  upsert — are designed to partial-succeed: a failure at any layer
 *  downgrades rather than aborts, and errors are collected into the
 *  response so the log surfaces what went wrong without eating the
 *  succeeded rows. */
async function runDaily(origin: string): Promise<DailyResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const asOfDate = todayInET();

  // 1. Small-cap gainers list.
  const gainersRes = await fetch(new URL("/api/gainers", origin), { cache: "no-store" });
  if (!gainersRes.ok) {
    const body = await gainersRes.text();
    throw new Error(`gainers ${gainersRes.status}: ${body.slice(0, 200)}`);
  }
  const gainersData = (await gainersRes.json()) as GainersData;
  const tickers = (gainersData.tickers ?? []).map((t) => t.ticker);

  if (tickers.length === 0) {
    return {
      rowsWritten: 0,
      tickersProcessed: [],
      errors: ["gainers list empty — market closed, holiday, or cap filter excluded everything"],
      durationMs: Date.now() - startedAt,
      asOfDate,
    };
  }

  // 2. Research per ticker, in parallel. Promise.allSettled so one
  //    EDGAR / Perplexity / Exa failure doesn't sink the batch.
  const briefResults = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const res = await fetch(
        new URL(`/api/research?ticker=${encodeURIComponent(ticker)}`, origin),
        { cache: "no-store" }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`research ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as ResearchBrief;
    })
  );

  const briefs: ResearchBrief[] = [];
  briefResults.forEach((r, i) => {
    if (r.status === "fulfilled") briefs.push(r.value);
    else errors.push(`research ${tickers[i]}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
  });

  if (briefs.length === 0) {
    return {
      rowsWritten: 0,
      tickersProcessed: [],
      errors: [...errors, "no briefs succeeded — aborting without DB writes"],
      durationMs: Date.now() - startedAt,
      asOfDate,
    };
  }

  // 3. Rank via Anthropic. Downgrade on failure — rows still get written
  //    with rank_position=null so the research cache is at least populated.
  let rankings: Ranking[] = [];
  try {
    rankings = await rankWithAnthropic(briefs);
  } catch (e) {
    errors.push(`ranking: ${e instanceof Error ? e.message : "failed"}`);
  }
  const rankByTicker = new Map(rankings.map((r) => [r.ticker, r]));

  // 4. Upsert one row per ticker for today. onConflict on the PK makes
  //    this idempotent — a second run in the same day overwrites.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  const admin = adminClient();
  let rowsWritten = 0;
  const processed: string[] = [];

  const writeResults = await Promise.allSettled(
    briefs.map((brief) => {
      const r = rankByTicker.get(brief.ticker);
      const row = {
        ticker: brief.ticker,
        as_of_date: asOfDate,
        rank_position: r?.rank ?? null,
        rank_reason: r?.rank_reason ?? null,
        research: brief as unknown as Record<string, unknown>,
      };
      return admin
        .from("ticker_research")
        .upsert(row, { onConflict: "ticker,as_of_date" });
    })
  );

  writeResults.forEach((w, i) => {
    const tk = briefs[i].ticker;
    if (w.status === "fulfilled") {
      if (w.value.error) errors.push(`upsert ${tk}: ${w.value.error.message}`);
      else {
        rowsWritten++;
        processed.push(tk);
      }
    } else {
      errors.push(`upsert ${tk}: ${w.reason instanceof Error ? w.reason.message : "failed"}`);
    }
  });

  return {
    rowsWritten,
    tickersProcessed: processed,
    errors,
    durationMs: Date.now() - startedAt,
    asOfDate,
  };
}

/** GET handler for Vercel Cron. Vercel sends `Authorization: Bearer
 *  ${CRON_SECRET}` on scheduled invocations. Any request missing or
 *  mismatching that header is rejected — keeps the route from acting
 *  as an unauthenticated trigger to an expensive pipeline. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDaily(req.nextUrl.origin);
    return NextResponse.json({ trigger: "cron", ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "run_failed", message: msg }, { status: 500 });
  }
}

/** POST handler for manual admin trigger (future "Run Now" button on the
 *  /workspace UI in Commit 4). Uses requireAdmin — cron never hits this,
 *  so we don't need to thread CRON_SECRET through the UI. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await runDaily(req.nextUrl.origin);
    return NextResponse.json({ trigger: "manual", triggeredBy: auth.user.email, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "run_failed", message: msg }, { status: 500 });
  }
}
