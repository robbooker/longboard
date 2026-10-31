import RunnerWatchAdmin from "@/components/runner-watch/RunnerWatchAdmin";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata = { title: "Runner Watch settings", robots: { index: false, follow: false } };

/** #341: Rob's off switch, alerts-only, and what the limits have held back. */
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "admin") redirect("/");
  const db = createChatAdminClient();
  const settings = await db?.from("chat_runner_watch_settings").select("enabled,alerts_only,max_per_hour,max_per_day,main_alerts_only,main_max_per_day").maybeSingle();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const posted = await db?.from("chat_runner_watch_reports").select("id", { count: "exact", head: true }).eq("status", "posted").gte("posted_at", since);
  const held = await db?.from("chat_runner_watch_reports").select("id,tickers,summary,received_at").eq("status", "held").order("received_at", { ascending: false }).limit(50);
  if (!settings?.data || settings.error || held?.error)
    return <main style={{ padding: 32 }}><h1>Runner Watch</h1><p>Settings are unavailable. Please refresh to try again.</p></main>;
  return (
    <RunnerWatchAdmin
      enabled={settings.data.enabled}
      alertsOnly={settings.data.alerts_only}
      maxPerHour={settings.data.max_per_hour}
      maxPerDay={settings.data.max_per_day}
      mainAlertsOnly={settings.data.main_alerts_only}
      mainMaxPerDay={settings.data.main_max_per_day}
      postedLastHour={posted?.count ?? 0}
      held={held?.data ?? []}
    />
  );
}
