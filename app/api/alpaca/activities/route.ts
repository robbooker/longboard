import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import type { AlpacaActivity } from "@/types/alpaca";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const activities = await alpacaFetch<AlpacaActivity[]>(
      "/account/activities/FILL?direction=desc&page_size=20"
    );
    return NextResponse.json(activities);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca activities error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
