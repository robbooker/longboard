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
    // TZ responds with { positions: [...] } — unwrap to a bare array so the
    // client doesn't need to know about the envelope. Bare-array fallback
    // handles the defensive case where TZ ever reverts to array-at-root.
    const resp = await tzProxyFetch<{ positions?: unknown[] } | unknown[]>(`/accounts/${creds.accountId}/positions`, creds);
    const positions = Array.isArray(resp) ? resp : Array.isArray(resp?.positions) ? resp.positions : [];
    return NextResponse.json(positions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero positions error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
