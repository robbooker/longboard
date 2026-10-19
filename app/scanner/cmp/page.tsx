import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Command2Header from "@/components/command2/Command2Header";
import CmpScannerClient from "@/components/command2/CmpScannerClient";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

export const metadata: Metadata = {
  title: "LB Scanner · Longboard",
  description: "Top gainers through the CMP system: stage, trigger, stop, T1, CMP and Ghost Pivot.",
};

export const dynamic = "force-dynamic";

export default async function CmpScannerPage() {
  const currentUser = await getCommand2CurrentUser();
  if (!currentUser) redirect("/login");

  return (
    <>
      <Command2Header activeTab="command" currentUser={currentUser} />
      <CmpScannerClient />
    </>
  );
}
