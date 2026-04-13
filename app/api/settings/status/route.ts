import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { alpacaFetch } from "@/lib/alpaca-api";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { polygonFetch } from "@/lib/polygon-api";
import { getAlpacaCredsForUser, getTradeZeroCredsForUser } from "@/lib/brokerKeys";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [alpaca, tradezero, polygon] = await Promise.all([
    fetchAlpaca(auth.user.id),
    fetchTradeZero(auth.user.id),
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

async function fetchAlpaca(userId: string) {
  const credsResult = await getAlpacaCredsForUser(userId);
  if (!credsResult.ok) {
    return { status: "missing" as const };
  }
  try {
    const acct = await alpacaFetch<{
      account_number: string;
      equity: string;
      buying_power: string;
    }>("/account", credsResult.creds);
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

async function fetchTradeZero(userId: string) {
  const credsResult = await getTradeZeroCredsForUser(userId);
  if (!credsResult.ok) {
    return { status: "missing" as const };
  }
  const creds = credsResult.creds;
  try {
    const acct = await tzProxyFetch<{
      equity: number;
      buyingPower: number;
    }>(`/account/${creds.accountId}`, creds);
    return {
      status: "ok" as const,
      accountId: creds.accountId,
      equity: acct.equity,
      buyingPower: acct.buyingPower,
    };
  } catch (err) {
    return {
      status: "error" as const,
      accountId: creds.accountId,
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
