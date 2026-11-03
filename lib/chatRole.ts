import type { ChatEntitlements } from "@/lib/chatAccess";

type Viewer = { ok: true; user: { role: "user" | "admin" }; access: Pick<ChatEntitlements, "admin"> } | { ok: false };

/**
 * #354: a chat sign-in session's role. It is the current role of the Longboard profile this chat
 * account is linked to (chat_accounts.longboard_user_id, which only a server-verified Longboard
 * sign-in ever sets), read fresh on every request, so a role change shows straight away. No link,
 * no profile, or any role other than exactly "admin" is an ordinary member.
 */
export function sessionRole(context: { longboard: boolean; role: string | null }): "user" | "admin" {
  return context.longboard && context.role === "admin" ? "admin" : "user";
}

/**
 * #354: the one chat admin check. Every sign-in path (Longboard, chat sign-in session, API token)
 * sets the role and the admin entitlement together, so longboardai.com and chat.robbooker.com
 * give the same answer.
 */
export function isChatAdmin(auth: Viewer): boolean {
  return auth.ok && auth.user.role === "admin" && auth.access.admin === true;
}
