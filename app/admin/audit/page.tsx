import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AuditClient from "./AuditClient";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
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
      <AuditClient />
    </div>
  );
}
