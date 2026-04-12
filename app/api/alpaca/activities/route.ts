import { NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireAuth } from "@/lib/auth-guard";
import type { AlpacaActivity } from "@/types/alpaca";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const activities = await alpacaFetch<AlpacaActivity[]>(
      "/v2/account/activities/FILL?direction=desc&page_size=20"
    );
    return NextResponse.json(activities);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca activities error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
