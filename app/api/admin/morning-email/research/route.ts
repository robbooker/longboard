import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { enrichStocks } from "@/lib/morning-email/research";
import { researchStockWithClaude } from "@/lib/morning-email/claude-research";
import type { MorningEmailStock, QaMessage } from "@/lib/morning-email/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function selectedEngine(): "claude" | "legacy" {
  return process.env.RESEARCH_ENGINE === "legacy" ? "legacy" : "claude";
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { stocks?: MorningEmailStock[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const stocks = Array.isArray(body.stocks) ? body.stocks : [];
  if (stocks.length === 0) {
    return NextResponse.json(
      { stocks: [], qa: [{ level: "error", message: "No stocks provided. Run Scan Polygon first." }] },
      { status: 400 },
    );
  }

  const engine = selectedEngine();

  if (engine === "legacy") {
    try {
      const result = await enrichStocks(stocks);
      result.qa.unshift({ level: "ok", message: "RESEARCH_ENGINE=legacy — using OpenAI synthesis path." });
      return NextResponse.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return NextResponse.json(
        { stocks, qa: [{ level: "error", message: `Research failed: ${msg}` }] },
        { status: 500 },
      );
    }
  }

  try {
    const outcomes = await Promise.all(stocks.map((s) => researchStockWithClaude(s)));
    const enriched = outcomes.map((o) => o.stock);
    const qa: QaMessage[] = [
      { level: "ok", message: `Researched ${enriched.length} ticker${enriched.length === 1 ? "" : "s"} via Claude Opus 4.7 web search.` },
    ];
    for (const o of outcomes) qa.push(...o.qa);
    return NextResponse.json({ stocks: enriched, qa });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`[morning-email/research] Claude path threw wholesale: ${msg} — falling back to legacy`);
    try {
      const result = await enrichStocks(stocks);
      result.qa.unshift({ level: "warning", message: `Claude research path threw (${msg}); fell back to legacy pipeline.` });
      return NextResponse.json(result);
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : "unknown";
      return NextResponse.json(
        { stocks, qa: [{ level: "error", message: `Both research paths failed: ${msg2}` }] },
        { status: 500 },
      );
    }
  }
}
