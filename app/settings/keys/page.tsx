import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardNav from "@/components/DashboardNav";

export const dynamic = "force-dynamic";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

export default async function KeysPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text-primary)", fontFamily: font }}>
      <DashboardNav />
      <div style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
          LONGBOARD.AI
        </div>
        <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1, marginBottom: 24 }}>
          Broker API Keys
        </div>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          padding: 20, fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)",
        }}>
          Coming soon. You can use the analysis pages while we finish wiring this up.{" "}
          <Link href="/settings" style={{ color: "var(--accent)", textDecoration: "underline" }}>
            Return to Settings →
          </Link>
        </div>
      </div>
    </div>
  );
}
