import type { Metadata } from "next";
import CommandCenterV2 from "@/components/command2/CommandCenterV2";
import type { Command2MenuUser } from "@/components/command2/Command2UserMenu";
import { getCurrentUser } from "@/lib/auth";
import { getLatestMorningArchive } from "@/lib/morningArchive";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Command Center · Longboard",
  description:
    "Ranked by conviction. Live tape, AI catalyst reads, risk flags, price targets — and the editorial team in the right rail, walking it as it breaks.",
};

// /command2 reads the latest morning_email_archive row on every request.
// Force dynamic so the server-side initial snapshot is fresh, not stale
// from a build-time prerender. Client-side polling keeps it fresh after
// mount.
export const dynamic = "force-dynamic";

const COHORT_TAG_PREFIX = "boardroom-cohort-";

export default async function Command2Page() {
  const [snapshot, auth] = await Promise.all([
    getLatestMorningArchive(),
    getCurrentUser(),
  ]);

  let currentUser: Command2MenuUser | null = null;

  if (auth.ok) {
    const supabase = await createClient();
    const { data: tagRows } = await supabase
      .from("user_tags")
      .select("tag")
      .eq("user_id", auth.user.id)
      .like("tag", `${COHORT_TAG_PREFIX}%`);

    currentUser = {
      email: auth.user.email,
      role: auth.user.role,
      boardroomCohorts: (tagRows ?? [])
        .map((row) => row.tag.slice("boardroom-".length))
        .filter((cohort): cohort is string => Boolean(cohort))
        .sort(),
    };
  }

  return <CommandCenterV2 initialSnapshot={snapshot} currentUser={currentUser} />;
}
