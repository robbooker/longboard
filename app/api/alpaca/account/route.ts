import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import type { AlpacaAccount } from "@/types/alpaca";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const account = await alpacaFetch<AlpacaAccount>("/account");
    return NextResponse.json(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca account error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
