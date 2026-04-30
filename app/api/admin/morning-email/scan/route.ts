import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { scanMorningMovers } from "@/lib/morning-email/polygon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { forceTickers?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const result = await scanMorningMovers({ forceTickers: body.forceTickers });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { stocks: [], qa: [{ level: "error", message: msg }], live: false },
      { status: 500 },
    );
  }
}
