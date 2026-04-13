import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import { getAlpacaCredsForUser } from "@/lib/brokerKeys";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";
import type { AlpacaOrder } from "@/types/alpaca";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const credsResult = await getAlpacaCredsForUser(auth.user.id);
  if (!credsResult.ok) {
    return NextResponse.json(
      { error: "broker_not_configured", broker: "alpaca", missing: credsResult.missing },
      { status: 412 }
    );
  }

  try {
    const orders = await alpacaFetch<AlpacaOrder[]>("/orders?status=open", credsResult.creds);
    return NextResponse.json(orders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca orders error:", message);
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

  const credsResult = await getAlpacaCredsForUser(auth.user.id);
  if (!credsResult.ok) {
    return NextResponse.json(
      { error: "broker_not_configured", broker: "alpaca", missing: credsResult.missing },
      { status: 412 }
    );
  }

  try {
    const body = await req.json();
    const order = await alpacaFetch<AlpacaOrder>("/orders", credsResult.creds, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(order);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca order submit error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
