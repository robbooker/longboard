import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BugInboxClient from "./BugInboxClient";
import "./bugs-admin.css";

export const dynamic = "force-dynamic";

export default async function AdminBugsPage() {
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
    <div className="bug-admin-shell">
      <BugInboxClient />
    </div>
  );
}
