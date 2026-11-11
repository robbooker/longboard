import Link from "next/link";
import { redirect } from "next/navigation";
import { requireChatUser } from "@/lib/chatAuth";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { parseChatRoom } from "@/lib/publicChat";
import ShortScoutProfileSwitch from "@/components/chat/ShortScoutProfileSwitch";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { shortScoutProfileState } from "@/lib/chatShortScoutProfile";
export const dynamic = "force-dynamic";
export const metadata = { title: "ShortScout membership connection", referrer: "no-referrer" };
export default async function Connected({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; popout?: string }>;
}) {
  const auth = await requireChatUser();
  if (!auth.ok) redirect("/chat/login");
  const params = await searchParams;
  const requested = parseChatRoom(params.room) ?? "social";
  const room = canAccessChatRoom(auth.access, requested) ? requested : "social";
  // #444: once the ShortScout profile was merged into this one there is one profile, no switch.
  const merged = (await shortScoutProfileState(createChatAdminClient(), auth)) === "merged";
  return (
    <main style={{ maxWidth: 680, margin: "40px auto", padding: 24, lineHeight: 1.6 }}>
      <h1>
        {auth.hasSeparateShortScoutProfile ? "ShortScout membership connected" : "ShortScout profile options"}
      </h1>
      <p>
        {merged
          ? "Your ShortScout membership works in this chat profile. Your ShortScout and Longboard chat profiles are now one: your earlier ShortScout messages show under this profile, and signing in with ShortScout opens it too."
          : auth.hasSeparateShortScoutProfile
            ? "You can use your verified ShortScout membership from this Longboard chat profile. Existing profiles and inboxes remain separate."
            : "You can verify your ShortScout membership again from chat. Existing profiles and inboxes remain separate."}
      </p>
      <p>
        <Link href={`/chat?room=${room}${params.popout === "1" ? "&popout=1" : ""}`}>Continue to chat →</Link>
      </p>
      <ShortScoutProfileSwitch
        accountId={auth.user.id}
        canDisconnect={!!auth.hasSeparateShortScoutProfile && !auth.serverSession}
        merged={merged}
      />
    </main>
  );
}
