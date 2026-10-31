import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import RunnerWatchReport from "@/components/runner-watch/RunnerWatchReport";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Runner Risk Watch", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const Message = ({ title, body }: { title: string; body: string }) => (
  <main style={{ padding: 32 }}>
    <h1>{title}</h1>
    <p>{body}</p>
  </main>
);

/**
 * #341: one full report. Open to anyone who can open the Runner Watch room, nobody else. Deleting the
 * chat post takes the page down too. Admins can also read one that hasn't posted, to decide on it.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatUser();
  if (!auth.ok) {
    if (auth.status === 401) redirect("/chat/login?room=runner-watch");
    return <Message title="Chat access unavailable" body="Your account could not be verified. Please contact Longboard support." />;
  }
  if (!canAccessChatRoom(auth.access, "runner-watch"))
    return <Message title="Chat access unavailable" body="This page is for chat members." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = createChatAdminClient();
  const unavailable = <Message title="This page is temporarily unavailable" body="Please refresh to try again." />;
  if (!db) return unavailable;
  const { data: report, error } = await db
    .from("chat_runner_watch_reports")
    .select("tickers,summary,full_text,is_alert,sent_at,received_at,status,message_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return unavailable;
  if (!report) notFound();
  const admin = Boolean(auth.access.admin);
  if (report.status !== "posted") {
    if (!admin) notFound();
  } else if (!admin) {
    if (!report.message_id) notFound();
    const post = await db.from("longboard_chat_messages").select("removed,deleted_at").eq("id", report.message_id).maybeSingle();
    if (post.error) return unavailable;
    if (!post.data || post.data.removed || post.data.deleted_at) notFound();
  }
  return (
    <RunnerWatchReport
      tickers={report.tickers}
      summary={report.summary}
      fullText={report.full_text}
      alert={report.is_alert}
      at={report.sent_at ?? report.received_at}
      notPosted={report.status !== "posted"}
    />
  );
}
