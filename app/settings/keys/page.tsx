import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardNav from "@/components/DashboardNav";
import { getUserBrokerKeys } from "@/lib/brokerKeys";
import KeysClient from "./KeysClient";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const initialData = await getUserBrokerKeys(user.id);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <DashboardNav />
      <KeysClient initialData={initialData} />
    </div>
  );
}
