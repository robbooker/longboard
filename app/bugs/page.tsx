import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Command2Header from "@/components/command2/Command2Header";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import BugReportClient from "./BugReportClient";
import "./bugs.css";

export const metadata: Metadata = {
  title: "Report a Bug · Longboard",
  description: "Report a Longboard bug for review by the Longboard team.",
};

export const dynamic = "force-dynamic";

export default async function BugsPage() {
  const currentUser = await getCommand2CurrentUser();
  if (!currentUser) redirect("/login");

  return (
    <>
      <Command2Header activeTab="settings" currentUser={currentUser} />
      <BugReportClient userEmail={currentUser.email} />
    </>
  );
}
