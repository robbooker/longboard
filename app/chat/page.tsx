import PublicChat from "@/components/chat/PublicChat";
import { allowedChatRooms } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { loadChatBootstrap } from "@/lib/chatBootstrap";
export const dynamic = "force-dynamic";
import { parseChatRoom } from "@/lib/publicChat";
import type { Metadata } from "next";
import { Michroma } from "next/font/google";
import { redirect } from "next/navigation";

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
  const auth = await requireChatUser();
  if (!auth.ok) {
    if (auth.status === 401) redirect(`/chat/login?room=${room}${params.popout === "1" ? "&popout=1" : ""}`);
    return <main style={{ padding: 32 }}><h1>Chat access unavailable</h1><p>Your account could not be verified. Please contact Longboard support.</p></main>;
  }
  const rooms=allowedChatRooms(auth.access);
  if(!rooms.includes(room)) redirect(`/chat?room=${rooms[0]??"social"}${params.popout === "1"?"&popout=1":""}`);
  let bootstrap;
  try { bootstrap = await loadChatBootstrap(auth, room); }
  catch { return <main style={{padding:32}}><h1>Chat temporarily unavailable</h1><p>Your chat could not load. Please refresh to try again.</p></main>; }
  return <PublicChat bootstrap={bootstrap} accountId={auth.user.id} roomRealtime={!auth.serverSession && (room === "social" || (room === "main" && !!auth.access.boardroom) || (room === "shortscout" && auth.access.admin))} featureChannel={bootstrap.featureChannel} allowedRooms={rooms} serverSession={auth.serverSession} canLinkShortScout={auth.access.longboard && !auth.access.shortscout} isAdmin={auth.user.role === "admin"} key={`${auth.user.id}:${room}`} room={room} popout={params.popout === "1"} fontVariableClass={michroma.variable} />;
}
