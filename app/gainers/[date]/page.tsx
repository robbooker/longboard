import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { niceDay, parseGainersDay, parseGainersPage } from "@/lib/chatGainersPages";
import GainersPage from "@/components/gainers/GainersPage";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const day = parseGainersDay((await params).date);
  return {
    title: day ? `Gainers Chart Board ${niceDay(day)}` : "Gainers Chart Board",
    robots: { index: false, follow: false },
  };
}

const Message = ({ title, body }: { title: string; body: string }) => (
  <main style={{ padding: 32 }}>
    <h1>{title}</h1>
    <p>{body}</p>
  </main>
);

/** #340: one trading day's gainers page. Open to anyone who can open the LB Review room, nobody else. */
export default async function Page({ params }: { params: Promise<{ date: string }> }) {
  const auth = await requireChatUser();
  if (!auth.ok) {
    if (auth.status === 401) redirect("/chat/login?room=lb-review");
    return <Message title="Chat access unavailable" body="Your account could not be verified. Please contact Longboard support." />;
  }
  if (!canAccessChatRoom(auth.access, "lb-review"))
    return <Message title="Chat access unavailable" body="This page is for chat members." />;
  const day = parseGainersDay((await params).date);
  if (!day) notFound();
  const db = createChatAdminClient();
  const unavailable = <Message title="This page is temporarily unavailable" body="Please refresh to try again." />;
  if (!db) return unavailable;
  const { data, error } = await db.from("chat_gainers_pages").select("data").eq("trading_day", day).maybeSingle();
  if (error) return unavailable;
  if (!data) notFound();
  const page = parseGainersPage(data.data);
  return page ? <GainersPage data={page} /> : unavailable;
}
