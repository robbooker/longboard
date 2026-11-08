import { canAccessChatRoom, type ChatEntitlements } from "@/lib/chatAccess";

/**
 * #385 Reader: who may open the Reader (the shelf, a book, saving their place). This is the only
 * place that decides it; every Reader route and the /reader page call it.
 *
 * Today: admins, and members who can open the Gainers room (the same rule as the Gainers Table and
 * News Feed). Bot accounts never: they only ever have their listed rooms and no books.
 *
 * TODO(#384, PR #553): once the members/entitlements system merges, make the body one line:
 *   return accessHasEntitlement(access, "reader");
 * (import { accessHasEntitlement } from "@/lib/memberAccess"; requireChatUser loads the keys, so
 * there is no extra query; `await hasEntitlement(userId, "reader")` works too). The sidebar's Reader
 * row still follows the Gainers room until then; the routes are what enforce access.
 */
export async function canUseReader(userId: string, access: ChatEntitlements): Promise<boolean> {
  void userId; // For hasEntitlement(userId, "reader") after #384, if that form is used.
  return !access.botRooms && (access.admin || canAccessChatRoom(access, "gainers"));
}

/** Who may upload, reorder, hide and delete books: chat admins only. */
export function canManageReader(access: ChatEntitlements): boolean {
  return !access.botRooms && access.admin;
}
