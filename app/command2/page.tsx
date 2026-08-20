import type { Metadata } from "next";
import CommandCenterV2 from "@/components/command2/CommandCenterV2";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import {
  getLatestMorningArchive,
  getLatestMorningArchiveWeekSummary,
} from "@/lib/morningArchive";
import { isEtWeekend } from "@/lib/morning-report/schedule";

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

export default async function Command2Page() {
  const requestNow = new Date();
  const initialNowIso = requestNow.toISOString();
  const [snapshot, weekSummary, currentUser] = await Promise.all([
    getLatestMorningArchive(),
    isEtWeekend(requestNow)
      ? getLatestMorningArchiveWeekSummary(requestNow).catch(() => null)
      : Promise.resolve(null),
    getCommand2CurrentUser(),
  ]);

  return (
    <CommandCenterV2
      initialSnapshot={snapshot}
      initialWeekSummary={weekSummary}
      currentUser={currentUser}
      initialNowIso={initialNowIso}
    />
  );
}
