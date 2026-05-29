import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import "./arena-admin.css";
import ArenaAdminClient from "./ArenaAdminClient";

export const dynamic = "force-dynamic";

export default async function ArenaAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin") redirect("/");

  return <ArenaAdminClient />;
}
