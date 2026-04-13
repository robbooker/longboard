import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getBrokerKeyStatus } from "@/lib/brokerKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight read-only endpoint for the dashboard banners. Returns only
 *  whether each broker is configured — no key material, no missing-field
 *  detail. Single table query, no vault decryption. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const status = await getBrokerKeyStatus(auth.user.id);
    return NextResponse.json(status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "status_failed", message: msg }, { status: 500 });
  }
}
