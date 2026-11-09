import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { isEntitlementKey, normalizeEmail } from "@/lib/memberAccess";
import { supabaseMemberStore } from "@/lib/members/memberStore";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function admin(request: NextRequest) {
  if (!requestOriginAllowed(request)) return { error: json({ error: "origin_not_allowed" }, 403) };
  const auth = await requireAdmin(request);
  if (!auth.ok) return { error: json({ error: auth.error }, auth.status) };
  const db = createChatAdminClient();
  if (!db) return { error: json({ error: "server_not_configured" }, 503) };
  return { auth, db };
}

/**
 * #384: grant an entitlement by hand (granted_by 'admin'). The person is made if this email never
 * bought anything. Optional ends_at (ISO date) and note.
 */
export async function POST(request: NextRequest) {
  const gate = await admin(request);
  if (gate.error) return gate.error;
  const { auth, db } = gate;
  const payload = await request.json().catch(() => null);
  const email = normalizeEmail(payload?.email);
  const key = payload?.key;
  if (!email) return json({ error: "email_required" }, 400);
  if (!isEntitlementKey(key)) return json({ error: "invalid_key" }, 400);
  let endsAt: string | null = null;
  if (payload?.ends_at) {
    const parsed = Date.parse(String(payload.ends_at));
    if (!Number.isFinite(parsed) || parsed <= Date.now()) return json({ error: "invalid_end" }, 400);
    endsAt = new Date(parsed).toISOString();
  }
  const note = typeof payload?.note === "string" ? payload.note.trim().slice(0, 500) || null : null;
  try {
    const person = await supabaseMemberStore(db).upsertPerson(email, {});
    const { data, error } = await db
      .from("member_entitlements")
      .insert({
        person_id: person.id,
        entitlement_key: key,
        granted_by: "admin",
        granted_by_user: auth.user.id,
        ends_at: endsAt,
        note,
      })
      .select("*")
      .single();
    if (error) return json({ error: "grant_failed" }, 503);
    return json({ entitlement: data });
  } catch {
    return json({ error: "grant_failed" }, 503);
  }
}

/** #384: revoke one entitlement (any source). A Stripe renewal never brings it back. */
export async function PATCH(request: NextRequest) {
  const gate = await admin(request);
  if (gate.error) return gate.error;
  const { auth, db } = gate;
  const payload = await request.json().catch(() => null);
  if (payload?.action !== "revoke") return json({ error: "invalid_action" }, 400);
  if (typeof payload?.id !== "string" || !UUID_RE.test(payload.id)) return json({ error: "invalid_id" }, 400);
  const reason = typeof payload?.reason === "string" ? payload.reason.trim().slice(0, 200) || "admin" : "admin";
  const { data, error } = await db
    .from("member_entitlements")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: "admin",
      revoked_by_user: auth.user.id,
      revoked_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.id)
    .is("revoked_at", null)
    .select("id");
  if (error) return json({ error: "revoke_failed" }, 503);
  if (!(data ?? []).length) return json({ error: "not_found" }, 404);
  return json({ revoked: payload.id });
}
