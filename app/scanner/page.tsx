import type { Metadata } from "next";
import Command2Header from "@/components/command2/Command2Header";
import RvolScannerClient from "@/components/command2/RvolScannerClient";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

export const metadata: Metadata = {
  title: "Scanner · Longboard",
  description: "Live RVOL signal scanner for top moving common stocks.",
};

export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  const currentUser = await getCommand2CurrentUser();

  return (
    <>
      <Command2Header activeTab="command" currentUser={currentUser} />
      <RvolScannerClient />
    </>
  );
}
