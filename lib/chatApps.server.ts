import type { ChatEntitlements } from "@/lib/chatAccess";
import { CHAT_APPS, type ChatAppId } from "@/lib/chatApps";
import { canUseReader } from "@/lib/readerAccess";

/**
 * #406 Who may use each app (lib/chatApps.ts), decided on the server from the verified sign-in.
 * The sidebar's Apps section, the Quad and Six pickers and the apps' own routes all follow it.
 */
const APP_ACCESS: Record<ChatAppId, (userId: string, access: ChatEntitlements) => Promise<boolean>> = {
  // Admins, the "reader" entitlement (Booker Stock Club) or the Gainers room; never bots.
  reader: canUseReader,
};

/** The apps this member may use, in sidebar order. */
export async function chatAppsFor(userId: string, access: ChatEntitlements): Promise<ChatAppId[]> {
  const allowed = await Promise.all(CHAT_APPS.map((app) => APP_ACCESS[app.id](userId, access)));
  return CHAT_APPS.filter((_, i) => allowed[i]).map((app) => app.id);
}
