import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch, tzAccountId } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const orders = await tzProxyFetch(`/accounts/${tzAccountId()}/orders`);
    return NextResponse.json(orders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero orders error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const ks = await isOrderSubmissionEnabled();
  if (!ks.enabled) {
    return NextResponse.json(
      { error: "order_submission_disabled", reason: ks.reason },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    if (!body.securityType) {
      body.securityType = "Stock";
    }
    const order = await tzProxyFetch(`/accounts/${tzAccountId()}/order`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(order);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero order submit error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
