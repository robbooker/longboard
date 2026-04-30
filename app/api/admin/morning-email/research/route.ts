import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { enrichStocks } from "@/lib/morning-email/research";
import type { MorningEmailStock } from "@/lib/morning-email/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  try {
    const result = await enrichStocks(stocks);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { stocks, qa: [{ level: "error", message: `Research failed: ${msg}` }] },
      { status: 500 },
    );
  }
}
