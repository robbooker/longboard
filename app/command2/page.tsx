import type { Metadata } from "next";
import CommandCenterV2 from "@/components/command2/CommandCenterV2";

export const metadata: Metadata = {
  title: "Command Center · Longboard",
  description:
    "Ranked by conviction. Live tape, AI catalyst reads, risk flags, price targets — and the editorial team in the right rail, walking it as it breaks.",
};

export default function Command2Page() {
  return <CommandCenterV2 />;
}
