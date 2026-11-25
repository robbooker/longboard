import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { chatLookFromCookies } from "@/lib/chatTheme";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatAdmin } from "@/lib/chatRole";
import { allowedChatRooms } from "@/lib/chatAccess";
import { loadChatBootstrap } from "@/lib/chatBootstrap";
import QuadChat from "@/components/chat/QuadChat";
import { jetbrainsMono } from "@/lib/fonts/chatTerminalFont";
import { stageVideoConfig } from "@/lib/chatStageVideo";
export const dynamic = "force-dynamic";
export const metadata = { title: "Dual View · Rob Booker Chat" };
// #492/#493: two chats side by side. Never sends anyone back to a plain /chat: with Dual view on,
// that page would bring them straight back here (lib/chatDualView.ts).
export default async function DualPage() {
  const auth = await requireChatUser();
  if (!auth.ok) {
    if (auth.status === 401) redirect("/chat/login");
    return (
      <main>
        <h1>Chat access unavailable</h1>
      </main>
    );
  }
  const rooms = allowedChatRooms(auth.access);
  const room = rooms[0];
  if (!room) redirect("/chat?room=social");
  let bootstrap;
  try {
    bootstrap = await loadChatBootstrap(auth, room);
  } catch {
    return (
      <main>
        <h1>Chat temporarily unavailable</h1>
        <p>Please refresh to try again.</p>
      </main>
    );
  }
  if (!bootstrap.member) redirect(`/chat?room=${room}`);
  return (
    <QuadChat
      dual
      key={auth.user.id}
      initialTheme={chatLookFromCookies(await cookies())}
      accountId={auth.user.id}
      bootstrap={bootstrap}
      allowedRooms={rooms}
      serverSession={auth.serverSession}
      isAdmin={isChatAdmin(auth)}
      // #505: live video is set up (LiveKit): a live room's card gets the Watch live button.
      stageVideo={!!stageVideoConfig()}
      room={room}
      popout
      fontVariableClass={jetbrainsMono.variable}
      appVersion={process.env.VERCEL_GIT_COMMIT_SHA || "development"}
    />
  );
}
