import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WelcomeCard from "@/components/boardroom/WelcomeCard";
import CalendarCard from "@/components/boardroom/CalendarCard";
import TasksCard, { type BoardroomTask } from "@/components/boardroom/TasksCard";
import LatestMeetingCard from "@/components/boardroom/LatestMeetingCard";
import AnnouncementsCard from "@/components/boardroom/AnnouncementsCard";
import RoadmapCard from "@/components/boardroom/RoadmapCard";
import FeatureRequestsCard from "@/components/boardroom/FeatureRequestsCard";
import StatsCard from "@/components/boardroom/StatsCard";

export const dynamic = "force-dynamic";

const font = "var(--font-labels)";
const COHORT_TAG_PREFIX = "boardroom-cohort-";

export default async function BoardroomPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Cohort gate. Each row in user_tags is one membership; a user can hold
  // multiple boardroom-cohort-N tags. v1 renders only the first cohort
  // they hold (cohort-1 in practice). Multi-cohort rendering is deferred
  // until cohort-2 actually exists.
  const { data: tagRows } = await supabase
    .from("user_tags")
    .select("tag")
    .eq("user_id", user.id)
    .like("tag", `${COHORT_TAG_PREFIX}%`);

  const cohorts = (tagRows ?? [])
    .map((r) => r.tag.slice(COHORT_TAG_PREFIX.length))
    .filter((c): c is string => Boolean(c));

  if (cohorts.length === 0) redirect("/");

  const cohort = cohorts[0];                            // e.g. "cohort-1"
  const cohortNumber = cohort.replace(/^cohort-/, "");  // e.g. "1"

  // All six section reads run in parallel. They go through the user's
  // anon-key Supabase client so RLS scopes everything to (a) this
  // cohort and (b) is_published = true. Admins seeing unpublished
  // drafts use the /admin/boardroom service-role surface (Commit 5).
  const [
    welcomeRes,
    eventsRes,
    tasksRes,
    latestMeetingRes,
    announcementsRes,
    roadmapRes,
    featureRequestsRes,
    statsRes,
    userVotesRes,
  ] = await Promise.all([
    supabase.from("boardroom_welcome").select("body_markdown").eq("cohort", cohort).maybeSingle(),
    supabase.from("boardroom_events").select("id, title, subtitle, starts_at, ends_at, rsvp_url")
      .eq("cohort", cohort).gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }).limit(3),
    supabase.from("boardroom_tasks").select("id, title, due_date, is_done")
      .eq("user_id", user.id)
      .order("is_done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("boardroom_meetings").select("id, title, summary, video_url, duration_seconds, tags, meeting_date")
      .eq("cohort", cohort).order("meeting_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("boardroom_announcements").select("id, title, body, kind, posted_at")
      .eq("cohort", cohort).order("posted_at", { ascending: false }).limit(3),
    supabase.from("boardroom_roadmap").select("id, title, status, sort_order")
      .eq("cohort", cohort).order("sort_order", { ascending: true }),
    supabase.from("boardroom_feature_requests").select("id, title, upvote_count")
      .eq("cohort", cohort).order("upvote_count", { ascending: false }).limit(3),
    supabase.from("boardroom_stats")
      .select("total_sales_display, total_sales_subtext, collected_display, collected_subtext, members_display, members_subtext, new_leads_display, new_leads_subtext")
      .eq("cohort", cohort).maybeSingle(),
    // User's votes across all feature requests they've voted on. RLS
    // limits this to own rows. Small payload regardless of cohort
    // size — bounded by how many requests this user has voted on.
    supabase.from("boardroom_feature_request_votes")
      .select("request_id")
      .eq("user_id", user.id),
  ]);

  const votedRequestIds = new Set<string>(
    (userVotesRes.data ?? []).map((v) => v.request_id)
  );

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text-primary)", fontFamily: font }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 64px" }}>
        {/* Header strip */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          marginBottom: 28, paddingBottom: 16, borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <div style={{
              fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3,
              textTransform: "uppercase", marginBottom: 6,
            }}>
              LONGBOARD / PRIVATE
            </div>
            <div style={{ fontSize: 24, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
              Boardroom {cohortNumber}
            </div>
          </div>
          <div style={{
            fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5,
            textTransform: "uppercase", border: "1px solid var(--border)",
            borderRadius: 3, padding: "4px 10px",
          }}>
            Members only · {cohort}
          </div>
        </div>

        {/* Pinned welcome — full width */}
        <Section>
          <WelcomeCard markdown={welcomeRes.data?.body_markdown ?? null} />
        </Section>

        {/* Calendar + My Tasks */}
        <PairedRow>
          <CalendarCard events={eventsRes.data ?? []} />
          <TasksCard initialTasks={(tasksRes.data ?? []) as BoardroomTask[]} />
        </PairedRow>

        {/* Latest Meeting + Announcements (1.4fr / 1fr) */}
        <PairedRow leftWeight={1.4}>
          <LatestMeetingCard meeting={latestMeetingRes.data ?? null} />
          <AnnouncementsCard items={announcementsRes.data ?? []} />
        </PairedRow>

        {/* Roadmap + Feature Requests */}
        <PairedRow>
          <RoadmapCard items={roadmapRes.data ?? []} />
          <FeatureRequestsCard
            items={(featureRequestsRes.data ?? []).map((r) => ({
              ...r,
              userVoted: votedRequestIds.has(r.id),
            }))}
          />
        </PairedRow>

        {/* Stats — full width, bottom */}
        <Section>
          <StatsCard stats={statsRes.data ?? null} />
        </Section>
      </div>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 20 }}>{children}</div>;
}

function PairedRow({
  children, leftWeight = 1,
}: {
  children: React.ReactNode;
  leftWeight?: number;
}) {
  return (
    <div
      className="boardroom-row"
      style={{
        display: "grid",
        gridTemplateColumns: `${leftWeight}fr 1fr`,
        gap: 16,
        marginBottom: 20,
      }}
    >
      {children}
      {/* Mobile collapse to a single column. Inline via a style tag so
       *  this page doesn't depend on a global CSS file change. */}
      <style>{`
        @media (max-width: 720px) {
          .boardroom-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
