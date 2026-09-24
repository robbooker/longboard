import { parseChatRoom } from "@/lib/publicChat";
import LoginForm from "@/components/login/LoginForm";
import { chatLoginFonts } from "@/components/login/chatLoginFonts";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  let chatEntry = false;
  let chatBackHref = "/chat/login";
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    try {
      const target = new URL(next, "https://longboardai.com");
      chatEntry = target.pathname === "/chat";
      if (chatEntry) {
        const room = target.searchParams.get("room");
        const params = new URLSearchParams();
        if (room && parseChatRoom(room)) params.set("room", room);
        if (target.searchParams.get("popout") === "1") params.set("popout", "1");
        chatBackHref += params.size ? `?${params}` : "";
      }
    } catch { /* Keep the standard login for invalid destinations. */ }
  }
  return <LoginForm chatEntry={chatEntry} fontClass={chatEntry ? chatLoginFonts : ""} chatBackHref={chatBackHref} />;
}
