import type { Metadata } from "next";
import Command2Header from "@/components/command2/Command2Header";
import RvolScannerClient from "@/components/command2/RvolScannerClient";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

export const metadata: Metadata = {
  title: "Scanner 2 · Longboard",
  description: "Live momentum scanner enriched with missed monthly pivot targets.",
};

export const dynamic = "force-dynamic";

export default async function Scanner2Page() {
  const currentUser = await getCommand2CurrentUser();

  return (
    <>
      <Command2Header activeTab="command" currentUser={currentUser} />
      <RvolScannerClient currentUserId={currentUser?.id ?? null} variant="scanner2" />
    </>
  );
}
