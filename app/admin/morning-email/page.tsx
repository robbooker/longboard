import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MorningEmailClient from "./MorningEmailClient";

export const dynamic = "force-dynamic";

export default async function MorningEmailPage() {
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
    <div style={{ background: "#F6F2E9", minHeight: "100vh" }}>
      <MorningEmailClient />
    </div>
  );
}
