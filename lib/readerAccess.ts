import { canAccessChatRoom, type ChatEntitlements } from "@/lib/chatAccess";
import { accessHasEntitlement } from "@/lib/memberAccess";

/**
 * #385 Reader: who may open the Reader (the shelf, a book, saving their place). This is the only
 * place that decides it; every Reader route and the /reader page call it.
 *
 * Admins; anyone with the "reader" entitlement (#384: Booker Stock Club, or an admin grant), which
 * requireChatUser already loaded with the sign-in, so this needs no database call; and, so nobody
 * who had the Reader loses it, members who can open the Gainers room. Bot accounts never.
 *
 * The sidebar row sits under the Gainers room, so a member with "reader" but no Gainers room opens
 * the Reader from a /chat?page=reader or /reader/<id> link rather than the sidebar.
 */
export async function canUseReader(userId: string, access: ChatEntitlements): Promise<boolean> {
  void userId;
  if (access.botRooms) return false;
  return access.admin || accessHasEntitlement(access, "reader") || canAccessChatRoom(access, "gainers");
}

/** Who may upload, reorder, hide and delete books: chat admins only. */
export function canManageReader(access: ChatEntitlements): boolean {
  return !access.botRooms && access.admin;
}
