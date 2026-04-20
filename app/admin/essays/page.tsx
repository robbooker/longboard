import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EssaysAdminClient from "./EssaysAdminClient";

export const dynamic = "force-dynamic";

export default async function EssaysAdminPage() {
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
      <EssaysAdminClient />
    </div>
  );
}
