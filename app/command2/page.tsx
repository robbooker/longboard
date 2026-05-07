import type { Metadata } from "next";
import CommandCenterV2 from "@/components/command2/CommandCenterV2";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import { getLatestMorningArchive } from "@/lib/morningArchive";

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
  const [snapshot, currentUser] = await Promise.all([
    getLatestMorningArchive(),
    getCommand2CurrentUser(),
  ]);

  return <CommandCenterV2 initialSnapshot={snapshot} currentUser={currentUser} />;
}
