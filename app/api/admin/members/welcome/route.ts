import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { deliverWelcome, supabaseWelcomeStore } from "@/lib/members/welcome";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** #390: "Resend welcome" on the Members page: a new welcome email (new one-tap link) now. */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireAdmin(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = createChatAdminClient();
  if (!db) return json({ error: "server_not_configured" }, 503);
  const payload = await request.json().catch(() => null);
  if (typeof payload?.person_id !== "string" || !UUID_RE.test(payload.person_id)) return json({ error: "invalid_id" }, 400);
  const status = await deliverWelcome(supabaseWelcomeStore(db), payload.person_id, "admin");
  if (status === "skipped") return json({ error: "not_found" }, 404);
  if (status === "failed") return json({ error: "send_failed", welcome_status: status }, 502);
  return json({ welcome_status: status });
}
