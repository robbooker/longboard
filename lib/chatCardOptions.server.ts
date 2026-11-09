import { NextRequest } from "next/server";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { allowedChatRooms, canAccessChatRoom, canUseDirectMessages } from "@/lib/chatAccess";
import { readInbox } from "@/lib/chatReads/inbox";
import type { CardOptions } from "@/lib/chatCards";
import { chatAppsFor } from "@/lib/chatApps.server";

/**
 * #379: what a member can put on a card, decided on the server from their verified access. Quad's
 * options route and the Six layout route both read this, so the picker and the save check agree.
 * When DMs can't be read it hands back the inbox reader's error response (no half-filled options);
 * bot accounts simply have no DMs.
 */
export async function loadCardOptions(
  auth: Extract<ChatAuthResult, { ok: true }>,
): Promise<{ ok: true; options: CardOptions } | { ok: false; response: Response }> {
  let conversations: CardOptions["conversations"] = [];
  if (canUseDirectMessages(auth.access)) {
    const response = await readInbox(new NextRequest("https://chat.internal/api/chat/inbox"), auth);
    if (!response.ok) return { ok: false, response };
    conversations = (await response.json()).conversations ?? [];
  }
  return {
    ok: true,
    options: {
      rooms: allowedChatRooms(auth.access),
      conversations,
      gainersTable: canAccessChatRoom(auth.access, "gainers"),
      // #406: the Reader on a Quad pane or Six card, for the same members the Reader lets in.
      apps: await chatAppsFor(auth.user.id, auth.access),
    },
  };
}
