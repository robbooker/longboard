import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ClubWelcome from "@/components/members/ClubWelcome";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { accessHasEntitlement } from "@/lib/memberAccess";
import { GAINERS_PATH, supabaseWelcomeStore, welcomeTokenState } from "@/lib/members/welcome";
import { gainersBody, gainersHead } from "@/lib/fonts/gainersFonts";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Welcome to the Booker Stock Club",
  description: "Open your Booker Stock Club chat.",
  robots: { index: false },
  // The token is in this page's address: never send it on to another site.
  referrer: "no-referrer",
};

/**
 * #390: where the welcome email's button lands: /join/club/welcome?t=<token>. Opening it only
 * checks the token; the "Open the club chat" button here (a POST) is what uses it, so a mail
 * scanner that opens links can't spend it.
 */
export default async function ClubWelcomePage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const params = await searchParams;
  const auth = await requireChatUser();
  if (auth.ok && accessHasEntitlement(auth.access, "gainers")) redirect(GAINERS_PATH);
  const token = typeof params.t === "string" ? params.t : "";
  const db = createChatAdminClient();
  let state: "ready" | "used" | "expired" | "invalid" | "unavailable" = "unavailable";
  if (db) {
    try {
      state = (await welcomeTokenState(supabaseWelcomeStore(db), token)).state;
    } catch {
      state = "unavailable";
    }
  }
  return <ClubWelcome token={state === "invalid" ? null : token} initialState={state} fontClass={`${gainersHead.variable} ${gainersBody.variable}`} />;
}
