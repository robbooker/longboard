import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE_MAX_LEN = 200;
const BODY_MAX_LEN = 4000;
const COHORT_TAG_PREFIX = "boardroom-cohort-";

/** POST /api/boardroom/feature-requests
 *  Body: { title, body? }
 *  Submits a request scoped to the user's first cohort. Always lands
 *  with is_published = false; admin moderates via /admin/boardroom
 *  (Commit 5) before it appears on the member-side card. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { title?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
  if (title.length > TITLE_MAX_LEN) {
    return NextResponse.json({ error: "title_too_long", max: TITLE_MAX_LEN }, { status: 400 });
  }

  const bodyText = typeof body.body === "string" ? body.body.trim() : "";
  if (bodyText.length > BODY_MAX_LEN) {
    return NextResponse.json({ error: "body_too_long", max: BODY_MAX_LEN }, { status: 400 });
  }

  const supabase = await createClient();

  // Derive cohort from the user's first boardroom-cohort-* tag. RLS on
  // user_tags scopes the read to own rows. The RLS insert policy on
  // boardroom_feature_requests double-checks this server-side via the
  // exists-subquery — even a hand-crafted body can't write to a cohort
  // the user isn't a member of.
  const { data: tagRows, error: tagErr } = await supabase
    .from("user_tags")
    .select("tag")
    .eq("user_id", auth.user.id)
    .like("tag", `${COHORT_TAG_PREFIX}%`);

  if (tagErr) {
    return NextResponse.json({ error: "cohort_lookup_failed", message: tagErr.message }, { status: 500 });
  }
  const cohort = (tagRows ?? [])
    .map((r) => r.tag.slice("boardroom-".length))
    .filter((c): c is string => Boolean(c))
    .sort()[0];

  if (!cohort) {
    return NextResponse.json({ error: "no_cohort" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("boardroom_feature_requests")
    .insert({
      cohort,
      title,
      body: bodyText || null,
      submitted_by: auth.user.id,
      is_published: false,
      upvote_count: 0,
    })
    .select("id, cohort, title, body, upvote_count, is_published, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
