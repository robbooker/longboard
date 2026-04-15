import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import { getAlpacaCredsForUser } from "@/lib/brokerKeys";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";
import { logOrderAudit, extractOrderFields } from "@/lib/orderAudit";
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

  const startedAt = Date.now();
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const fields = extractOrderFields(body);

  try {
    const order = await alpacaFetch<AlpacaOrder>("/orders", credsResult.creds, {
      method: "POST",
      body: JSON.stringify(body),
    });
    logOrderAudit({
      userId: auth.user.id,
      userEmail: auth.user.email,
      broker: "alpaca",
      action: "submit",
      symbol: fields.symbol,
      side: fields.side,
      qty: fields.qty,
      orderType: fields.orderType,
      requestBody: body,
      responseStatus: 200,
      responseBody: order,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(order);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca order submit error:", message);
    logOrderAudit({
      userId: auth.user.id,
      userEmail: auth.user.email,
      broker: "alpaca",
      action: "submit",
      symbol: fields.symbol,
      side: fields.side,
      qty: fields.qty,
      orderType: fields.orderType,
      requestBody: body,
      responseStatus: 500,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
