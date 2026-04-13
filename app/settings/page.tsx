import { createClient } from "@/lib/supabase/server";
import DashboardNav from "@/components/DashboardNav";
import SettingsClient from "./SettingsClient";
import pkg from "@/package.json";

function extractProjectId(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div style={{ background: "#0a0e0c", minHeight: "100vh" }}>
      <DashboardNav />
      <SettingsClient
        email={user?.email ?? ""}
        lastSignIn={user?.last_sign_in_at ?? null}
        serverInfo={{
          supabaseProjectId: extractProjectId(process.env.NEXT_PUBLIC_SUPABASE_URL),
          vercelUrl: process.env.VERCEL_URL ?? null,
          gitSha: process.env.VERCEL_GIT_COMMIT_SHA
            ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
            : null,
          appVersion: pkg.version,
          disableOrderSubmission: process.env.DISABLE_ORDER_SUBMISSION === "true",
        }}
      />
    </div>
  );
}
