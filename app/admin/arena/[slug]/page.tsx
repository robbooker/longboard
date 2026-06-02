import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAgentSlug } from "@/lib/arena/agents-store";
import "../arena-admin.css";
import ArenaAgentEditorClient from "./ArenaAgentEditorClient";

export const dynamic = "force-dynamic";

export default async function ArenaAgentAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isAgentSlug(slug)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin") redirect("/");

  return <ArenaAgentEditorClient slug={slug} />;
}
