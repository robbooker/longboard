import type { Metadata } from "next";
import Command2Header from "@/components/command2/Command2Header";
import RvolScannerMiniClient from "@/components/command2/RvolScannerMiniClient";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

export const metadata: Metadata = {
  title: "Scanner 3 · Longboard",
  description: "Compact pop-out view of the 5m RVOL scanner.",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Scanner3Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const popout = params.popout === "1" || params.view === "popout";
  const currentUser = popout ? null : await getCommand2CurrentUser();

  return (
    <>
      {!popout && <Command2Header activeTab="command" currentUser={currentUser} />}
      <RvolScannerMiniClient popout={popout} />
    </>
  );
}
