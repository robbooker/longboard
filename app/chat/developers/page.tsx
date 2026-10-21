import { redirect } from "next/navigation";
import { requireChatUser } from "@/lib/chatAuth";
import ChatDevelopers from "@/components/chat/ChatDevelopers";
export const dynamic = "force-dynamic";
export const metadata = { title: "Chat for developers", referrer: "no-referrer" };

// CHAT-API: signed in through chat in a browser; tokens are listed and made by the client part.
export default async function Developers() {
  const auth = await requireChatUser();
  if (!auth.ok) redirect("/chat/login");
  return <ChatDevelopers />;
}
