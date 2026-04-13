import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import type { AlpacaPosition } from "@/types/alpaca";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const positions = await alpacaFetch<AlpacaPosition[]>("/positions");
    return NextResponse.json(positions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca positions error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
