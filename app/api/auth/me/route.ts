import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COHORT_TAG_PREFIX = "boardroom-cohort-";

/** Returns { id, email, role, boardroom_cohorts } for the current user,
 *  or 401 if not signed in. Used by DashboardNav to decide whether to
 *  render the Admin link and the Boardroom dropdown entries. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Pull the user's boardroom-cohort-* tags. RLS on user_tags limits
  // SELECT to the user's own rows, so this is safe under their anon
  // session — same pattern as profiles in requireUser. boardroom_cohorts
  // is the suffix (e.g. "cohort-1") so callers can derive the number
  // for display ("Boardroom 1") without re-parsing the prefix.
  const supabase = await createClient();
  const { data: tagRows } = await supabase
    .from("user_tags")
    .select("tag")
    .eq("user_id", auth.user.id)
    .like("tag", `${COHORT_TAG_PREFIX}%`);

  const boardroom_cohorts = (tagRows ?? [])
    .map((r) => r.tag.slice("boardroom-".length))   // "boardroom-cohort-1" → "cohort-1"
    .filter((c): c is string => Boolean(c))
    .sort();

  return NextResponse.json({ ...auth.user, boardroom_cohorts });
}
