import { getCurrentReport } from "@/lib/morning-report/service";
import type { MorningEmailStock } from "@/lib/morning-email/types";

export type MorningArchiveRow = {
  id: string;
  version_id: string;
  sent_date: string;
  report_date: string;
  subject: string;
  stocks_json: MorningEmailStock[];
  payload: Record<string, unknown>;
  html?: string;
  qa_json?: unknown[];
  generated_by_email: string | null;
  created_at: string;
  generated_at: string;
  prices_updated_at: string | null;
  version_type: string;
  report_schema_version: number;
};

// Re-export the canonical stock + target types under /command2-friendly
// names so downstream consumers don't have to reach across directories.
export type { MorningEmailStock as Stock, PriceTarget, PriceTargets } from "@/lib/morning-email/types";

// morning_email_archive has RLS on with no policies — anon reads return
// zero rows. /command2 is intentionally public during the build phase, so
// the latest snapshot is exposed downstream by design. Service role here
// matches the read pattern already established in
// app/api/admin/morning-email/archive/route.ts.
export async function getLatestMorningArchive(): Promise<MorningArchiveRow | null> {
  const data = await getCurrentReport();
  if (!data) return null;
  return {
    id: data.version_id,
    version_id: data.version_id,
    sent_date: data.sent_date,
    report_date: data.report_date,
    subject: data.subject,
    stocks_json: data.stocks_json,
    payload: data.payload,
    html: data.html,
    qa_json: data.qa_json,
    generated_by_email: data.generated_by_email,
    created_at: data.created_at,
    generated_at: data.generated_at,
    prices_updated_at: data.prices_updated_at,
    version_type: data.version_type,
    report_schema_version: data.report_schema_version,
  };
}
