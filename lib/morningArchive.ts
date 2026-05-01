import { createClient } from "@supabase/supabase-js";
import type { MorningEmailStock } from "@/lib/morning-email/types";

export type MorningArchiveRow = {
  id: string;
  sent_date: string;
  subject: string;
  stocks_json: MorningEmailStock[];
  generated_by_email: string | null;
  created_at: string;
};

// Re-export the canonical stock + target types under /command2-friendly
// names so downstream consumers don't have to reach across directories.
export type { MorningEmailStock as Stock, PriceTarget, PriceTargets } from "@/lib/morning-email/types";

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// morning_email_archive has RLS on with no policies — anon reads return
// zero rows. /command2 is intentionally public during the build phase, so
// the latest snapshot is exposed downstream by design. Service role here
// matches the read pattern already established in
// app/api/admin/morning-email/archive/route.ts.
export async function getLatestMorningArchive(): Promise<MorningArchiveRow | null> {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("morning_email_archive")
    .select("id, sent_date, subject, stocks_json, generated_by_email, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    sent_date: data.sent_date as string,
    subject: data.subject as string,
    stocks_json: (data.stocks_json as MorningEmailStock[]) ?? [],
    generated_by_email: (data.generated_by_email as string | null) ?? null,
    created_at: data.created_at as string,
  };
}
