import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAuthResult } from "@/lib/chatAuth";

/**
 * #454: whether the sidebar shows the Developers link (/chat/developers). It asks the database the
 * same question the developers page does (list_chat_api_tokens, 20261021120000_chat_api_tokens.sql):
 * the chat account has a row in chat_api_access and is linked to Longboard. Read once on the server
 * with the chat's first page, so the browser makes no extra request.
 */

/** The link's name and where it goes: personal settings (your API keys and agents), not the Developers room. */
export const DEVELOPERS_LINK_LABEL = "My agents & API keys";
export const DEVELOPERS_PAGE_HREF = "/chat/developers";

/** Who may be asked at all: a browser sign-in. Bots, agents and API-token requests never get the link. */
export function developerLinkCandidate(auth: ChatAuthResult): auth is Extract<ChatAuthResult, { ok: true }> {
  return auth.ok && !!auth.user.id && !auth.access.botRooms && !auth.agent && !auth.apiToken;
}

/** The visibility rule on the database's answer: only an explicit `access: true` shows the link. */
export function developerLinkAllowed(answer: unknown): boolean {
  return !!answer && typeof answer === "object" && (answer as { access?: unknown }).access === true;
}

/** Reads the invite for this sign-in; a failed read hides the link. */
export async function hasDeveloperAccess(admin: SupabaseClient | null, auth: ChatAuthResult): Promise<boolean> {
  if (!admin || !developerLinkCandidate(auth)) return false;
  try {
    const { data, error } = await admin.rpc("list_chat_api_tokens", { actor: auth.user.id });
    return !error && developerLinkAllowed(data);
  } catch {
    return false;
  }
}
