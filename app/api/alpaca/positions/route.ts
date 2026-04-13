import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import { getAlpacaCredsForUser } from "@/lib/brokerKeys";
import type { AlpacaPosition } from "@/types/alpaca";

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
    const positions = await alpacaFetch<AlpacaPosition[]>("/positions", credsResult.creds);
    return NextResponse.json(positions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca positions error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
