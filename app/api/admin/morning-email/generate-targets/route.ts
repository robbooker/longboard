import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { generateTargetsForStock, type TargetInputStock } from "@/lib/morning-email/anthropic";
import type { PriceTargets } from "@/lib/morning-email/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type GenerateTargetsRequest = {
  stocks?: TargetInputStock[];
};

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: GenerateTargetsRequest = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const stocks = Array.isArray(body.stocks) ? body.stocks : [];
  if (stocks.length === 0) {
    return NextResponse.json({ error: "no_stocks" }, { status: 400 });
  }

  const results = await Promise.allSettled(
    stocks.map(async (s) => ({ ticker: s.ticker, result: await generateTargetsForStock(s) })),
  );

  const targets: Record<string, PriceTargets> = {};
  const errors: Record<string, string> = {};

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { ticker, result } = r.value;
    if (result.ok) targets[ticker] = result.targets;
    else errors[ticker] = result.error;
  }

  return NextResponse.json({ targets, errors });
}
