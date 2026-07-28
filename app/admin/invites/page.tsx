import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminClient from "../AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminInvitesPage() {
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
      <AdminClient currentUserId={user.id} view="invites" />
    </div>
  );
}
