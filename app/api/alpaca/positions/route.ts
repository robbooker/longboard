import { NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireAuth } from "@/lib/auth-guard";
import type { AlpacaPosition } from "@/types/alpaca";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const positions = await alpacaFetch<AlpacaPosition[]>("/v2/positions");
    return NextResponse.json(positions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca positions error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
