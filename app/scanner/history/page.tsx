import type { Metadata } from "next";
import Command2Header from "@/components/command2/Command2Header";
import RvolScannerHistoryClient from "@/components/command2/RvolScannerHistoryClient";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

export const metadata: Metadata = {
  title: "RVOL Scanner History · Longboard",
  description: "Historical RVOL scanner signals by trading date.",
};

export const dynamic = "force-dynamic";

export default async function RvolScannerHistoryPage() {
  const currentUser = await getCommand2CurrentUser();

  return (
    <>
      <Command2Header activeTab="command" currentUser={currentUser} />
      <RvolScannerHistoryClient />
    </>
  );
}
