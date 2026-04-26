import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAG_MAX_LEN = 64;
const MAX_EMAILS = 1000;

type BulkTagResult = {
  tag: string;
  matched: string[];     // emails successfully tagged (or already tagged)
  unmatched: string[];   // emails not found in profiles
};

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { tag?: unknown; emails?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  if (!tag) {
    return NextResponse.json({ error: "tag_required" }, { status: 400 });
  }
  if (tag.length > TAG_MAX_LEN) {
    return NextResponse.json({ error: "tag_too_long", max: TAG_MAX_LEN }, { status: 400 });
  }

  if (!Array.isArray(body.emails)) {
    return NextResponse.json({ error: "emails_required" }, { status: 400 });
  }

  // De-dupe + normalize. Lowercased for matching against profiles.email
  // (which is also lowercased on insert per Phase 2A).
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of body.emails) {
    if (typeof raw !== "string") continue;
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    emails.push(e);
  }

  if (emails.length === 0) {
    return NextResponse.json({ error: "no_valid_emails" }, { status: 400 });
  }
  if (emails.length > MAX_EMAILS) {
    return NextResponse.json({ error: "too_many_emails", max: MAX_EMAILS }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Single round-trip lookup of all submitted emails against profiles.
  const { data: profiles, error: lookupErr } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", emails);

  if (lookupErr) {
    return NextResponse.json({ error: "lookup_failed", message: lookupErr.message }, { status: 500 });
  }

  const idByEmail = new Map<string, string>();
  for (const p of profiles ?? []) {
    if (p.email) idByEmail.set(p.email.toLowerCase(), p.id);
  }

  const matched: string[] = [];
  const unmatched: string[] = [];
  const rows: { user_id: string; tag: string; created_by: string }[] = [];

  for (const e of emails) {
    const userId = idByEmail.get(e);
    if (userId) {
      matched.push(e);
      rows.push({ user_id: userId, tag, created_by: auth.user.id });
    } else {
      unmatched.push(e);
    }
  }

  if (rows.length > 0) {
    // Upsert so re-running with the same email list is a no-op rather
    // than a primary-key violation. `matched` still reflects everyone
    // we found a profile for, regardless of pre-existing tag state.
    const { error: insertErr } = await admin
      .from("user_tags")
      .upsert(rows, { onConflict: "user_id,tag" });

    if (insertErr) {
      return NextResponse.json({ error: "insert_failed", message: insertErr.message }, { status: 500 });
    }
  }

  const result: BulkTagResult = { tag, matched, unmatched };
  return NextResponse.json(result);
}
