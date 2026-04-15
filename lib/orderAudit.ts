import { createClient } from "@supabase/supabase-js";

/** Shape of an order_audit row as it's built up inside a POST handler.
 *  Most fields optional because we log on both success and failure paths
 *  and not every field is known in every branch. */
export type OrderAuditInput = {
  userId: string;
  userEmail: string;
  broker: "alpaca" | "tradezero";
  action: "submit" | "cancel" | "flatten";
  symbol?: string | null;
  side?: string | null;
  qty?: number | null;
  orderType?: string | null;
  requestBody?: unknown;
  responseStatus?: number | null;
  responseBody?: unknown;
  errorMessage?: string | null;
  durationMs: number;
};

/** Writes one row into order_audit. Service-role client, fire-and-forget:
 *  failures are logged to console but never thrown. An audit write that
 *  fails must not block an order submission that succeeded. */
export async function logOrderAudit(input: OrderAuditInput): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[orderAudit] skipping — supabase env missing");
    return;
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { error } = await admin.from("order_audit").insert({
      user_id: input.userId,
      user_email: input.userEmail,
      broker: input.broker,
      action: input.action,
      symbol: input.symbol ?? null,
      side: input.side ?? null,
      qty: input.qty ?? null,
      order_type: input.orderType ?? null,
      request_body: input.requestBody ?? null,
      response_status: input.responseStatus ?? null,
      response_body: input.responseBody ?? null,
      error_message: input.errorMessage ?? null,
      duration_ms: input.durationMs,
    });
    if (error) {
      console.warn("[orderAudit] insert failed:", error.message);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.warn("[orderAudit] insert threw:", msg);
  }
}

/** Pull the public-safe subset of a parsed order request body for column
 *  fields (symbol/side/qty/orderType). Both broker routes apply different
 *  transformations to the body before forwarding, so this reads from the
 *  client-facing shape: { symbol, qty, side, type } for Alpaca,
 *  { symbol, qty, side, type } for TradeZero pre-transform. */
export function extractOrderFields(body: unknown): {
  symbol: string | null;
  side: string | null;
  qty: number | null;
  orderType: string | null;
} {
  if (!body || typeof body !== "object") {
    return { symbol: null, side: null, qty: null, orderType: null };
  }
  const b = body as Record<string, unknown>;
  const qtyRaw = b.qty ?? b.orderQuantity;
  const qty = typeof qtyRaw === "number" ? qtyRaw : typeof qtyRaw === "string" ? Number(qtyRaw) : null;
  return {
    symbol: typeof b.symbol === "string" ? b.symbol : null,
    side: typeof b.side === "string" ? b.side : null,
    qty: qty != null && Number.isFinite(qty) ? qty : null,
    orderType: typeof b.type === "string" ? b.type : typeof b.orderType === "string" ? b.orderType : null,
  };
}
