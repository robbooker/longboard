import type { Metadata } from "next";
import PracticeClient from "@/components/practice/PracticeClient";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import { getPracticeQueue } from "@/lib/practice/mockQueue";
import type { PracticeAttemptSummary } from "@/lib/practice/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Practice - Longboard",
  description: "Anonymized trading replay simulator.",
};

export const dynamic = "force-dynamic";

type AttemptRow = {
  id: string;
  setup_key: string;
  attempt_number: number;
  completed_at: string | null;
  metrics: { realizedPnl?: number } | null;
};

async function getPracticeAttempts(enabled: boolean): Promise<PracticeAttemptSummary[]> {
  if (!enabled) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("practice_attempts")
    .select("id,setup_key,attempt_number,completed_at,metrics")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return [];

  return ((data ?? []) as AttemptRow[]).map((row) => ({
    id: row.id,
    setupKey: row.setup_key,
    attemptNumber: row.attempt_number,
    completedAt: row.completed_at,
    realizedPnl:
      typeof row.metrics?.realizedPnl === "number" ? row.metrics.realizedPnl : null,
  }));
}

export default async function PracticePage() {
  const currentUser = await getCommand2CurrentUser();

  const [setups, attempts] = await Promise.all([
    Promise.resolve(getPracticeQueue()),
    getPracticeAttempts(Boolean(currentUser)),
  ]);

  return <PracticeClient setups={setups} initialAttempts={attempts} canSave={Boolean(currentUser)} />;
}
