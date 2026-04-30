import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HistoryClient from "./HistoryClient";

export const dynamic = "force-dynamic";

export default async function MorningEmailHistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") redirect("/");

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <HistoryClient />
    </div>
  );
}
