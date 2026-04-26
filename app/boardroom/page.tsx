import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
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

  // Admin check — drives the inline pencil affordance on each card and
  // determines whether to use the service-role client for reads.
  // Server-side only; isAdmin propagates as a serialized boolean prop.
  // Tampered isAdmin from the client cannot escalate writes — every
  // /api/admin/boardroom/* route is requireAdmin-gated.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";

  // For admin users, switch to the service-role client so unpublished
  // drafts are visible alongside published rows. Members continue
  // through anon-key + RLS (is_published gate enforced at the policy).
  // Service-role usage is server-side only; this never reaches the
  // browser bundle.
  const reader = isAdmin
    ? (() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) {
          throw new Error("Boardroom: server misconfigured (missing Supabase env)");
        }
        return createServiceClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      })()
    : supabase;

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
    reader.from("boardroom_welcome").select("*").eq("cohort", cohort).maybeSingle(),
    reader.from("boardroom_events").select("*")
      .eq("cohort", cohort).gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }).limit(3),
    supabase.from("boardroom_tasks").select("id, title, due_date, is_done")
      .eq("user_id", user.id)
      .order("is_done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    reader.from("boardroom_meetings").select("*")
      .eq("cohort", cohort).order("meeting_date", { ascending: false }).limit(1).maybeSingle(),
    reader.from("boardroom_announcements").select("*")
      .eq("cohort", cohort).order("posted_at", { ascending: false }).limit(3),
    reader.from("boardroom_roadmap").select("*")
      .eq("cohort", cohort).order("sort_order", { ascending: true }),
    reader.from("boardroom_feature_requests").select("*")
      .eq("cohort", cohort).order("upvote_count", { ascending: false }).limit(3),
    reader.from("boardroom_stats").select("*").eq("cohort", cohort).maybeSingle(),
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
          <WelcomeCard
            cohort={cohort}
            isAdmin={isAdmin}
            markdown={welcomeRes.data?.body_markdown ?? null}
          />
        </Section>

        {/* Calendar + My Tasks */}
        <PairedRow>
          <CalendarCard
            cohort={cohort}
            isAdmin={isAdmin}
            events={eventsRes.data ?? []}
          />
          <TasksCard initialTasks={(tasksRes.data ?? []) as BoardroomTask[]} />
        </PairedRow>

        {/* Latest Meeting + Announcements (1.4fr / 1fr) */}
        <PairedRow leftWeight={1.4}>
          <LatestMeetingCard
            cohort={cohort}
            isAdmin={isAdmin}
            meeting={latestMeetingRes.data ?? null}
          />
          <AnnouncementsCard
            cohort={cohort}
            isAdmin={isAdmin}
            items={announcementsRes.data ?? []}
          />
        </PairedRow>

        {/* Roadmap + Feature Requests */}
        <PairedRow>
          <RoadmapCard
            cohort={cohort}
            isAdmin={isAdmin}
            items={roadmapRes.data ?? []}
          />
          <FeatureRequestsCard
            cohort={cohort}
            isAdmin={isAdmin}
            items={(featureRequestsRes.data ?? []).map((r) => ({
              ...r,
              userVoted: votedRequestIds.has(r.id),
            }))}
          />
        </PairedRow>

        {/* Stats — full width, bottom */}
        <Section>
          <StatsCard
            cohort={cohort}
            isAdmin={isAdmin}
            stats={statsRes.data ?? null}
          />
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
