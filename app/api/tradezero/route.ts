import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { requireUser } from "@/lib/auth";
import { getTradeZeroCredsForUser } from "@/lib/brokerKeys";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const credsResult = await getTradeZeroCredsForUser(auth.user.id);
  if (!credsResult.ok) {
    return NextResponse.json(
      { error: "broker_not_configured", broker: "tradezero", missing: credsResult.missing },
      { status: 412 }
    );
  }
  const creds = credsResult.creds;

  try {
    const [account, positions] = await Promise.all([
      tzProxyFetch<Record<string, unknown>>(`/account/${creds.accountId}`, creds),
      tzProxyFetch<unknown>(`/accounts/${creds.accountId}/positions`, creds),
    ]);

    return NextResponse.json({
      account,
      positions: Array.isArray(positions) ? positions : [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
