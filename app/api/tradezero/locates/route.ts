import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { requireUser } from "@/lib/auth";
import { getTradeZeroCredsForUser } from "@/lib/brokerKeys";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";

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
    const locates = await tzProxyFetch(`/accounts/${creds.accountId}/locates`, creds);
    return NextResponse.json(locates);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero locates error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Order: auth → kill switch → creds. Don't bother decrypting if orders
  // are globally disabled.
  const ks = await isOrderSubmissionEnabled();
  if (!ks.enabled) {
    return NextResponse.json(
      { error: "order_submission_disabled", reason: ks.reason },
      { status: 503 }
    );
  }

  const credsResult = await getTradeZeroCredsForUser(auth.user.id);
  if (!credsResult.ok) {
    return NextResponse.json(
      { error: "broker_not_configured", broker: "tradezero", missing: credsResult.missing },
      { status: 412 }
    );
  }
  const creds = credsResult.creds;

  try {
    const body = await req.json();
    const locate = await tzProxyFetch(`/accounts/${creds.accountId}/locate`, creds, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(locate);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero locate submit error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
