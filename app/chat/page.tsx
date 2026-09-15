import type { Metadata } from "next";
import { Michroma } from "next/font/google";
import { parseChatRoom } from "@/lib/publicChat";
import PublicChat from "@/components/chat/PublicChat";

const michroma = Michroma({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-chat-blade",
});

export const metadata: Metadata = {
  title: "Longboard Chat",
  description: "Main and Social: the public realtime chat rooms for Longboard.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ popout?: string | string[]; room?: string | string[] }>;
}) {
  const params = await searchParams;
  const room = parseChatRoom(params.room) ?? "main";
  return <PublicChat key={room} room={room} popout={params.popout === "1"} fontVariableClass={michroma.variable} />;
}
