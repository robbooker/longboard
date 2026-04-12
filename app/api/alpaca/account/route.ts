import { NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireAuth } from "@/lib/auth-guard";
import type { AlpacaAccount } from "@/types/alpaca";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const account = await alpacaFetch<AlpacaAccount>("/account");
    return NextResponse.json(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca account error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
