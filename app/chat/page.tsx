import PublicChat from "@/components/chat/PublicChat";
import { CHAT_COLUMN_WIDTHS_SCRIPT } from "@/lib/chatColumnWidths";
import { allowedChatRooms } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatAdmin } from "@/lib/chatRole";
import { loadChatBootstrap } from "@/lib/chatBootstrap";
import { chatAppsFor } from "@/lib/chatApps.server";
export const dynamic = "force-dynamic";
import { parseChatRoom } from "@/lib/publicChat";
import type { Metadata } from "next";
import { michroma } from "@/lib/fonts/chatBladeFont";
import { jetbrainsMono } from "@/lib/fonts/chatTerminalFont";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { chatLookFromCookies } from "@/lib/chatTheme";
import { CHAT_EARLY_DRAFT_SCRIPT } from "@/lib/chatEarlyDraft";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { shortScoutProfileState } from "@/lib/chatShortScoutProfile";
import { hasDeveloperAccess } from "@/lib/chatDeveloperAccess";

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
    page?: string | string[];
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
  // #441: a page's link (/chat?page=<name>) keeps its page when the member's first room is another one.
  const page =
    typeof params.page === "string" && params.page ? `&page=${encodeURIComponent(params.page)}` : "";
  if (!rooms.includes(room))
    redirect(`/chat?room=${rooms[0] ?? "social"}${params.popout === "1" ? "&popout=1" : ""}${page}`);
  // #454: the Developers link in the sidebar, read alongside the first page (no extra browser request).
  const developerAccess = hasDeveloperAccess(createChatAdminClient(), auth);
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
  // #444: one profile once the linked ShortScout profile was merged into this one.
  const shortScoutProfile = await shortScoutProfileState(createChatAdminClient(), auth);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: CHAT_EARLY_DRAFT_SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: CHAT_COLUMN_WIDTHS_SCRIPT }} />
      <PublicChat
        initialTheme={chatLookFromCookies(await cookies())}
        appVersion={process.env.VERCEL_GIT_COMMIT_SHA || process.env.CHAT_APP_VERSION || "development"}
        bootstrap={bootstrap}
        accountId={auth.user.id}
        roomRealtime={
          !auth.serverSession &&
          (room === "gainers" ||
            room === "social" ||
            room === "developers" ||
            room === "lb-review" ||
            room === "runner-watch" ||
            room === "club" ||
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
                  r === "runner-watch" ||
                  r === "club" ||
                  r === "admins" ||
                  (r === "main" && auth.access.boardroom),
              )
        }
        hasSeparateShortScoutProfile={shortScoutProfile === "separate"}
        shortScoutProfilesMerged={shortScoutProfile === "merged"}
        featureChannel={bootstrap.featureChannel}
        allowedRooms={rooms}
        serverSession={auth.serverSession}
        canLinkShortScout={!auth.serverSession && auth.access.longboard && !auth.access.shortscout}
        isAdmin={isChatAdmin(auth)}
        apps={await chatAppsFor(auth.user.id, auth.access)}
        developerAccess={await developerAccess}
        key={auth.user.id}
        room={room}
        popout={params.popout === "1"}
        phoneList={
          params.room === undefined &&
          params.dm === undefined &&
          params.thread === undefined &&
          params.page === undefined
        }
        fontVariableClass={`${michroma.variable} ${jetbrainsMono.variable}`}
      />
    </>
  );
}
