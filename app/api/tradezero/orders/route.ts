import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { requireUser } from "@/lib/auth";
import { getTradeZeroCredsForUser } from "@/lib/brokerKeys";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";

/** Map the client-side Quick Order body to TradeZero's current payload shape.
 *  Client still sends { symbol, qty, price, side, type, route } as strings —
 *  we translate here so the form stays the same. TZ wants numeric qty /
 *  limitPrice, title-case side, title-case orderType, plus timeInForce and
 *  openClose fields. limitPrice is omitted for Market orders. */
function buildTradeZeroOrderPayload(body: Record<string, unknown>): Record<string, unknown> {
  const typeRaw = typeof body.type === "string" ? body.type.toUpperCase() : "LIMIT";
  const orderType = typeRaw === "MARKET" ? "Market" : typeRaw === "STOP" ? "Stop" : "Limit";

  const sideRaw = typeof body.side === "string" ? body.side.toLowerCase() : "buy";
  const side = sideRaw === "sell" ? "Sell" : "Buy";

  const payload: Record<string, unknown> = {
    symbol: body.symbol,
    side,
    orderType,
    orderQuantity: Number(body.qty),
    timeInForce: "Day",
    route: body.route ?? "SMART",
    securityType: typeof body.securityType === "string" && body.securityType.length > 0 ? body.securityType : "Stock",
    // Hardcoded for now — new positions are always Open. Closing-side orders
    // will need this driven off the current position, which is a later pass.
    openClose: "Open",
  };

  if (orderType !== "Market" && body.price !== undefined && body.price !== null && body.price !== "") {
    payload.limitPrice = Number(body.price);
  }

  return payload;
}

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
    // TZ's positions endpoint wraps in { positions: [...] }; orders likely
    // follows the same pattern. Unwrap defensively — support bare array,
    // { orders: [...] }, and (as a last guess) { data: [...] } — so the
    // client always gets a plain array.
    const resp = await tzProxyFetch<unknown>(`/accounts/${creds.accountId}/orders`, creds);
    let orders: unknown[] = [];
    if (Array.isArray(resp)) orders = resp;
    else if (resp && typeof resp === "object") {
      const obj = resp as Record<string, unknown>;
      if (Array.isArray(obj.orders)) orders = obj.orders;
      else if (Array.isArray(obj.data)) orders = obj.data;
    }
    return NextResponse.json(orders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero orders error:", message);
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
    const body = (await req.json()) as Record<string, unknown>;
    const payload = buildTradeZeroOrderPayload(body);
    const order = await tzProxyFetch(`/accounts/${creds.accountId}/order`, creds, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return NextResponse.json(order);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero order submit error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
