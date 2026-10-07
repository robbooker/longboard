import { NextRequest, NextResponse } from "next/server";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { parseChatRoom } from "@/lib/publicChat";
import { projectRoomMessagePins } from "@/lib/chatRoomMessagePins";
export const messagePinsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export function messagePinsError(error: { message: string }) {
  const codes: Record<string, number> = {
    room_forbidden: 403,
    admin_required: 403,
    message_not_found: 404,
    pin_limit: 409,
    invalid_pin: 400,
  };
  return messagePinsJson(
    { error: codes[error.message] ? error.message : "pins_unavailable" },
    codes[error.message] ?? 503,
  );
}
export async function readMessagePins(req: NextRequest, auth: ChatAuthResult) {
  if (!auth.ok) return messagePinsJson({ error: auth.error }, auth.status);
  const room = parseChatRoom(req.nextUrl.searchParams.get("room"));
  if (!room) return messagePinsJson({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return messagePinsJson({ error: "room_forbidden" }, 403);
  const db = createChatAdminClient();
  if (!db) return messagePinsJson({ error: "pins_unavailable" }, 503);
  try {
    const { data, error } = await db.rpc("chat_room_message_pins_list", {
      p_actor: auth.user.id,
      p_room: room,
    });
    return error
      ? messagePinsError(error)
      : messagePinsJson(projectRoomMessagePins(data, auth.user.role === "admin"));
  } catch {
    return messagePinsJson({ error: "pins_unavailable" }, 503);
  }
}
