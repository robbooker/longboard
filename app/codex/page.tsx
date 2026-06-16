import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Command2Header from "@/components/command2/Command2Header";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import CodexInboxClient from "./CodexInboxClient";
import "./codex.css";

export const metadata: Metadata = {
  title: "Codex Inbox · Longboard",
  description: "Private Longboard task inbox for sending work to Codex from anywhere.",
};

export const dynamic = "force-dynamic";

export default async function CodexInboxPage() {
  const currentUser = await getCommand2CurrentUser();
  if (!currentUser) redirect("/login");
  if (currentUser.role !== "admin") redirect("/");

  return (
    <>
      <Command2Header activeTab="settings" currentUser={currentUser} />
      <CodexInboxClient userEmail={currentUser.email} />
    </>
  );
}
