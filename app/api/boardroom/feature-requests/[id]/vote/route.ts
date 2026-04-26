import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/boardroom/feature-requests/[id]/vote
 *  Toggles the user's vote on a published request. Two-step:
 *
 *    1. Anon-key client (RLS-aware): SELECT existing vote → INSERT or
 *       DELETE on boardroom_feature_request_votes. RLS policies
 *       "users insert own votes" / "users delete own votes" enforce
 *       user_id = auth.uid().
 *    2. Service-role client: recompute upvote_count by counting votes
 *       and UPDATE boardroom_feature_requests. Members can't write to
 *       boardroom_feature_requests directly (no member-write RLS), so
 *       this denormalized field has to land via service role.
 *
 *  Returns: { voted: boolean, upvote_count: number } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const supabase = await createClient();

  // Step 1a: read existing vote.
  const { data: existing, error: readErr } = await supabase
    .from("boardroom_feature_request_votes")
    .select("user_id")
    .eq("request_id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: "read_failed", message: readErr.message }, { status: 500 });
  }

  // Step 1b: toggle.
  let voted: boolean;
  if (existing) {
    const { error: delErr } = await supabase
      .from("boardroom_feature_request_votes")
      .delete()
      .eq("request_id", id)
      .eq("user_id", auth.user.id);
    if (delErr) {
      return NextResponse.json({ error: "delete_failed", message: delErr.message }, { status: 500 });
    }
    voted = false;
  } else {
    const { error: insErr } = await supabase
      .from("boardroom_feature_request_votes")
      .insert({ request_id: id, user_id: auth.user.id });
    if (insErr) {
      return NextResponse.json({ error: "insert_failed", message: insErr.message }, { status: 500 });
    }
    voted = true;
  }

  // Step 2: service-role recompute. Counts votes and writes the
  // denormalized upvote_count back to the requests row. Counting from
  // source-of-truth here (rather than +1/-1) keeps the count correct
  // under any concurrent races.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const admin = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count, error: countErr } = await admin
    .from("boardroom_feature_request_votes")
    .select("*", { count: "exact", head: true })
    .eq("request_id", id);

  if (countErr) {
    return NextResponse.json({ error: "count_failed", message: countErr.message }, { status: 500 });
  }

  const upvote_count = count ?? 0;
  const { error: updErr } = await admin
    .from("boardroom_feature_requests")
    .update({ upvote_count })
    .eq("id", id);

  if (updErr) {
    return NextResponse.json({ error: "recompute_failed", message: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ voted, upvote_count });
}
