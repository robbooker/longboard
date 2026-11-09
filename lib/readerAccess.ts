import type { ChatEntitlements } from "@/lib/chatAccess";

/**
 * #385 Reader: who may open the Reader (the shelf, a book, saving their place). This is the only
 * place that decides it; every Reader route, the /reader page, the sidebar's Apps section and the
 * Quad and Six pickers (lib/chatApps.server.ts) follow it.
 *
 * #406: every signed-in chat member (Rob: "make the reader visible to everyone"). requireChatUser
 * has already checked the sign-in, so this needs no database call. Bot accounts never.
 */
export async function canUseReader(userId: string, access: ChatEntitlements): Promise<boolean> {
  void userId;
  return !access.botRooms;
}

/** Who may upload, reorder, hide and delete books: chat admins only. */
export function canManageReader(access: ChatEntitlements): boolean {
  return !access.botRooms && access.admin;
}
