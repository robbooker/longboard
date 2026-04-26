import { redirect } from "next/navigation";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import BoardroomAdminClient, {
  type BoardroomAdminInitialData,
} from "./BoardroomAdminClient";

export const dynamic = "force-dynamic";

// v1 hardcode: only Cohort 1 exists. When cohort-2 launches, replace
// this with a SELECT DISTINCT on user_tags filtered to boardroom-cohort-*
// and pass `availableCohorts` plus a dropdown into the client.
const COHORT = "cohort-1";

export default async function BoardroomAdminPage() {
  // 1. Admin gate — same shape as /admin/page.tsx.
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin") redirect("/");

  // 2. Service-role parallel fetch of all 7 sections. Bypasses RLS so
  //    admin sees unpublished rows; member-side reads use the anon-key
  //    client which Commit 1's policies keep scoped to is_published.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Boardroom admin: server misconfigured (missing Supabase env)");
  }
  const admin = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [
    welcomeRes,
    eventsRes,
    meetingsRes,
    announcementsRes,
    roadmapRes,
    featureRequestsRes,
    statsRes,
  ] = await Promise.all([
    admin.from("boardroom_welcome").select("*").eq("cohort", COHORT).maybeSingle(),
    admin.from("boardroom_events").select("*").eq("cohort", COHORT).order("starts_at", { ascending: true }),
    admin.from("boardroom_meetings").select("*").eq("cohort", COHORT).order("meeting_date", { ascending: false }),
    admin.from("boardroom_announcements").select("*").eq("cohort", COHORT).order("posted_at", { ascending: false }),
    admin.from("boardroom_roadmap").select("*").eq("cohort", COHORT).order("sort_order", { ascending: true }),
    admin.from("boardroom_feature_requests").select("*").eq("cohort", COHORT).order("upvote_count", { ascending: false }),
    admin.from("boardroom_stats").select("*").eq("cohort", COHORT).maybeSingle(),
  ]);

  const initial: BoardroomAdminInitialData = {
    cohort: COHORT,
    welcome: welcomeRes.data ?? null,
    events: eventsRes.data ?? [],
    meetings: meetingsRes.data ?? [],
    announcements: announcementsRes.data ?? [],
    roadmap: roadmapRes.data ?? [],
    featureRequests: featureRequestsRes.data ?? [],
    stats: statsRes.data ?? null,
  };

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <BoardroomAdminClient initial={initial} />
    </div>
  );
}
