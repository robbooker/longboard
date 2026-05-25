import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";
import pkg from "@/package.json";
import Command2Header from "@/components/command2/Command2Header";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

function extractProjectId(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const [supabase, currentUser] = await Promise.all([
    createClient(),
    getCommand2CurrentUser(),
  ]);
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div id="settings-page" style={{ background: "#F6F2E9", minHeight: "100vh" }}>
      <Command2Header activeTab="settings" currentUser={currentUser} />
      <SettingsClient
        currentUserId={user?.id ?? null}
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
