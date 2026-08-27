import type { Metadata } from "next";
import { Michroma } from "next/font/google";
import PublicChat from "@/components/chat/PublicChat";

const michroma = Michroma({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-chat-blade",
});

export const metadata: Metadata = {
  title: "Longboard Chat",
  description: "The public realtime chat room for Longboard.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ popout?: string | string[] }>;
}) {
  const params = await searchParams;
  return <PublicChat popout={params.popout === "1"} fontVariableClass={michroma.variable} />;
}
