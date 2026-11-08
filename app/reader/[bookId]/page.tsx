import { requireChatUser } from "@/lib/chatAuth";
import { canUseReader } from "@/lib/readerAccess";
import { READER_UUID } from "@/lib/reader";
import ReaderScreen from "@/components/reader/ReaderScreen";
import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reader", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const Message = ({ title, body }: { title: string; body: string }) => (
  <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }} data-reader-blocked>
    <h1>{title}</h1>
    <p>{body}</p>
    <p>
      <a href="/chat">Back to the chat</a>
    </p>
  </main>
);

/** #385 One book, full screen. Signed-in members with Reader access only; the book itself is checked again by its route. */
export default async function Page({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const auth = await requireChatUser();
  if (!auth.ok) {
    if (auth.status === 401) redirect("/chat/login");
    return <Message title="Reader unavailable" body="Your account could not be verified. Please contact Longboard support." />;
  }
  if (!(await canUseReader(auth.user.id, auth.access)))
    return <Message title="The Reader is for Booker Stock Club members" body="Your membership doesn’t include the Reader." />;
  if (!READER_UUID.test(bookId)) notFound();
  return <ReaderScreen bookId={bookId.toLowerCase()} />;
}
