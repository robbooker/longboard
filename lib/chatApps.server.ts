import type { ChatEntitlements } from "@/lib/chatAccess";
import { CHAT_APPS, type ChatAppId } from "@/lib/chatApps";
import { isChatOwner, type OwnerCheckAuth } from "@/lib/chatOwner";
import { canUseReader } from "@/lib/readerAccess";

/** The verified sign-in (requireChatUser's ok result), as the app rules read it. */
export type AppAccessAuth = OwnerCheckAuth & { access: ChatEntitlements };

/**
 * #406 Who may use each app (lib/chatApps.ts), decided on the server from the verified sign-in.
 * The sidebar's Apps section, the Quad and Six pickers and the apps' own routes all follow it.
 */
const APP_ACCESS: Record<ChatAppId, (auth: AppAccessAuth) => Promise<boolean>> = {
  // Admins, the "reader" entitlement (Booker Stock Club) or the Gainers room; never bots.
  reader: (auth) => canUseReader(auth.user.id, auth.access),
  // #468: Rob only (CHAT_OWNER_ACCOUNT_ID, lib/chatOwner.ts): not other admins, members, bots or tokens.
  "trading-desk": async (auth) => isChatOwner(auth),
};

/** The apps this member may use, in sidebar order. */
export async function chatAppsFor(auth: AppAccessAuth): Promise<ChatAppId[]> {
  const allowed = await Promise.all(CHAT_APPS.map((app) => APP_ACCESS[app.id](auth)));
  return CHAT_APPS.filter((_, i) => allowed[i]).map((app) => app.id);
}
