import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stub for the daily research orchestration. The real implementation
 *  lands in Phase 3E Commit 3 — it will:
 *    1. Call /api/gainers to pull today's small-cap movers.
 *    2. Run the research pipeline (app/api/research/route.ts internals)
 *       for each ticker in parallel.
 *    3. Rank the briefs via Anthropic (Sonnet, same model as /api/analyze).
 *    4. Upsert one ticker_research row per ticker for today.
 *
 *  For Commit 2 the handler just validates admin auth and returns a
 *  placeholder. Vercel Cron wiring in vercel.json is also deferred to
 *  Commit 3 so cron doesn't start firing against a stub. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({
    status: "stub",
    message: "run-daily orchestration lands in Phase 3E Commit 3. Migration + sibling routes are live in Commit 2.",
    triggeredBy: auth.user.email,
    at: new Date().toISOString(),
  });
}
