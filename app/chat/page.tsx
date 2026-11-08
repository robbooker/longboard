import PublicChat from "@/components/chat/PublicChat";
import { CHAT_COLUMN_WIDTHS_SCRIPT } from "@/lib/chatColumnWidths";
import { allowedChatRooms } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatAdmin } from "@/lib/chatRole";
import { loadChatBootstrap } from "@/lib/chatBootstrap";
export const dynamic = "force-dynamic";
import { parseChatRoom } from "@/lib/publicChat";
import type { Metadata } from "next";
import { michroma } from "@/lib/fonts/chatBladeFont";
import { jetbrainsMono } from "@/lib/fonts/chatTerminalFont";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { CHAT_THEME_COOKIE, parseChatTheme } from "@/lib/chatTheme";
import { CHAT_EARLY_DRAFT_SCRIPT } from "@/lib/chatEarlyDraft";

export const metadata: Metadata = {
  title: "Rob Booker Chat",
  description: "Main and Social: the member realtime chat rooms for Longboard.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{
    popout?: string | string[];
    room?: string | string[];
    dm?: string | string[];
    thread?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const room = parseChatRoom(params.room) ?? "main";
  const auth = await requireChatUser();
  if (!auth.ok) {
    if (auth.status === 401) redirect(`/chat/login?room=${room}${params.popout === "1" ? "&popout=1" : ""}`);
    return (
      <main style={{ padding: 32 }}>
        <h1>Chat access unavailable</h1>
        <p>Your account could not be verified. Please contact Longboard support.</p>
      </main>
    );
  }
  const rooms = allowedChatRooms(auth.access);
  if (!rooms.includes(room))
    redirect(`/chat?room=${rooms[0] ?? "social"}${params.popout === "1" ? "&popout=1" : ""}`);
  let bootstrap;
  try {
    bootstrap = await loadChatBootstrap(auth, room);
  } catch {
    return (
      <main style={{ padding: 32 }}>
        <h1>Chat temporarily unavailable</h1>
        <p>Your chat could not load. Please refresh to try again.</p>
      </main>
    );
  }
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: CHAT_EARLY_DRAFT_SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: CHAT_COLUMN_WIDTHS_SCRIPT }} />
      <PublicChat
        initialTheme={parseChatTheme((await cookies()).get(CHAT_THEME_COOKIE)?.value)}
        appVersion={process.env.VERCEL_GIT_COMMIT_SHA || process.env.CHAT_APP_VERSION || "development"}
        bootstrap={bootstrap}
        accountId={auth.user.id}
        roomRealtime={
          !auth.serverSession &&
          (room === "gainers" ||
            room === "social" ||
            room === "developers" ||
            room === "lb-review" ||
            room === "admins" ||
            (room === "main" && !!auth.access.boardroom))
        }
        realtimeRooms={
          auth.serverSession
            ? []
            : rooms.filter(
                (r) =>
                  r === "gainers" ||
                  r === "social" ||
                  r === "developers" ||
                  r === "lb-review" ||
                  r === "admins" ||
                  (r === "main" && auth.access.boardroom),
              )
        }
        hasSeparateShortScoutProfile={auth.hasSeparateShortScoutProfile}
        featureChannel={bootstrap.featureChannel}
        allowedRooms={rooms}
        serverSession={auth.serverSession}
        canLinkShortScout={!auth.serverSession && auth.access.longboard && !auth.access.shortscout}
        isAdmin={isChatAdmin(auth)}
        key={auth.user.id}
        room={room}
        popout={params.popout === "1"}
        phoneList={params.room === undefined && params.dm === undefined && params.thread === undefined}
        fontVariableClass={`${michroma.variable} ${jetbrainsMono.variable}`}
      />
    </>
  );
}
