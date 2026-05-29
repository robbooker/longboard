import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  clearArenaProviderApiKey,
  listArenaProviderKeys,
  saveArenaProviderApiKey,
  saveArenaProviderBaseUrl,
} from "@/lib/arena/provider-keys";
import { isArenaProviderKey } from "@/lib/arena/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/arena/providers */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const providers = await listArenaProviderKeys();
    return NextResponse.json({ providers });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

/** POST /api/admin/arena/providers — save api key and/or base URL */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { providerKey?: unknown; apiKey?: unknown; baseUrl?: unknown; clear?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const providerKey = typeof body.providerKey === "string" ? body.providerKey : "";
  if (!isArenaProviderKey(providerKey)) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  try {
    if (body.clear === true) {
      await clearArenaProviderApiKey(providerKey, auth.user.id);
    } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      await saveArenaProviderApiKey(providerKey, body.apiKey, auth.user.id);
    }

    if (body.baseUrl !== undefined) {
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : null;
      await saveArenaProviderBaseUrl(providerKey, baseUrl, auth.user.id);
    }

    const providers = await listArenaProviderKeys();
    return NextResponse.json({ providers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "save_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
