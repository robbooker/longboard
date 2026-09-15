import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
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
  description: "Main and Social: the member realtime chat rooms for Longboard.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ popout?: string | string[]; room?: string | string[] }>;
}) {
  const params = await searchParams;
  const room = parseChatRoom(params.room) ?? "main";
  const auth = await getCurrentUser();
  if (!auth.ok) {
    if (auth.status === 401) redirect(`/login?next=${encodeURIComponent(`/chat?room=${room}${params.popout === "1" ? "&popout=1" : ""}`)}`);
    return <main style={{ padding: 32 }}><h1>Chat access unavailable</h1><p>Your account could not be verified. Please contact Longboard support.</p></main>;
  }
  if (room === "shortscout" && auth.user.role !== "admin") redirect(`/chat?room=main${params.popout === "1" ? "&popout=1" : ""}`);
  return <PublicChat isAdmin={auth.user.role === "admin"} key={room} room={room} popout={params.popout === "1"} fontVariableClass={michroma.variable} />;
}
