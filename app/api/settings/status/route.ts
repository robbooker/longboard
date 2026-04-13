import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { alpacaFetch } from "@/lib/alpaca-api";
import { tzProxyFetch, tzAccountId } from "@/lib/tradezero-api";
import { polygonFetch } from "@/lib/polygon-api";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [alpaca, tradezero, polygon] = await Promise.all([
    fetchAlpaca(),
    fetchTradeZero(),
    fetchPolygon(),
  ]);

  return NextResponse.json({
    alpaca_paper: alpaca,
    tradezero_live: tradezero,
    polygon,
    exa: { status: process.env.EXA_API_KEY ? "configured" : "missing" },
    perplexity: { status: process.env.PERPLEXITY_API_KEY ? "configured" : "missing" },
    anthropic: { status: process.env.ANTHROPIC_API_KEY ? "configured" : "missing" },
  });
}

async function fetchAlpaca() {
  try {
    const acct = await alpacaFetch<{
      account_number: string;
      equity: string;
      buying_power: string;
    }>("/account");
    return {
      status: "ok" as const,
      accountId: acct.account_number,
      equity: parseFloat(acct.equity),
      buyingPower: parseFloat(acct.buying_power),
    };
  } catch (err) {
    return {
      status: "error" as const,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function fetchTradeZero() {
  try {
    const accountId = tzAccountId();
    const acct = await tzProxyFetch<{
      equity: number;
      buyingPower: number;
    }>(`/account/${accountId}`);
    return {
      status: "ok" as const,
      accountId,
      equity: acct.equity,
      buyingPower: acct.buyingPower,
    };
  } catch (err) {
    return {
      status: "error" as const,
      accountId: process.env.TZ_ACCOUNT_ID,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function fetchPolygon() {
  if (!process.env.POLYGON_API_KEY) {
    return { status: "missing" as const };
  }
  try {
    await polygonFetch("/v3/reference/tickers?limit=1");
    return { status: "ok" as const };
  } catch (err) {
    return {
      status: "error" as const,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
