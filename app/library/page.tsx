import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Command2Header from "@/components/command2/Command2Header";
import LibraryClient from "@/components/library/LibraryClient";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import { libraryResources } from "@/lib/library/resources";

export const metadata: Metadata = {
  title: "Member Library · Longboard",
  description:
    "Searchable member library for Longboard slides, PDFs, indicator code, videos, replays, and working files.",
};

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const currentUser = await getCommand2CurrentUser();
  if (!currentUser) redirect("/login");

  return (
    <>
      <Command2Header activeTab="library" currentUser={currentUser} />
      <LibraryClient resources={libraryResources} />
    </>
  );
}

