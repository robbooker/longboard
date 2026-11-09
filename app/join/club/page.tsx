import type { Metadata } from "next";
import { redirect } from "next/navigation";
import JoinClub from "@/components/members/JoinClub";
import { requireChatUser } from "@/lib/chatAuth";
import { accessHasEntitlement, normalizeEmail } from "@/lib/memberAccess";
import { CHECKOUT_SESSION_RE } from "@/lib/members/join";
import { gainersBody, gainersHead } from "@/lib/fonts/gainersFonts";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join the Booker Stock Club chat",
  description: "Create your Booker Stock Club chat sign-in with the email you bought with.",
  robots: { index: false },
};

/**
 * #384: where the club's thank-you page sends a buyer:
 *   /join/club?session_id={CHECKOUT_SESSION_ID}   (Stripe fills it in on the success URL)
 *   /join/club?email=buyer@example.com            (or just /join/club, they type it)
 */
export default async function JoinClubPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[]; email?: string | string[] }>;
}) {
  const params = await searchParams;
  const auth = await requireChatUser();
  if (auth.ok && accessHasEntitlement(auth.access, "gainers")) redirect("/chat?room=gainers");
  const sessionId = typeof params.session_id === "string" && CHECKOUT_SESSION_RE.test(params.session_id) ? params.session_id : null;
  const email = normalizeEmail(typeof params.email === "string" ? params.email : null);
  return <JoinClub sessionId={sessionId} initialEmail={email} fontClass={`${gainersHead.variable} ${gainersBody.variable}`} />;
}
