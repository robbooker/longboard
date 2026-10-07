import { readRoomWindow, roomWindowQuery, ChatWindowError } from "./window";
import { mergeConfirmedMessages } from "@/lib/chatPendingMessages";
import { withMessageMemberships } from "@/lib/chatMembershipProjection";
import { NextRequest, NextResponse } from "next/server";

import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { CHAT_UUID } from "@/lib/chatMembers";
import { parseChatRoom } from "@/lib/publicChat";

import type { ChatAuthResult } from "@/lib/chatAuth";

const MESSAGE_COLUMNS =
  "id,room_slug,guest_id,member_id,author_label,body,bot_slug,reply_to_id,created_at,edited_at,deleted_at,removed,revision,attachment_ids,client_id,buddy_status,unread_seq";

export async function readHistory(req: NextRequest, auth: ChatAuthResult) {
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const room = parseChatRoom(req.nextUrl.searchParams.get("room"));
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const idsParam = req.nextUrl.searchParams.get("ids");
  const knownIds = idsParam ? idsParam.split(",") : [];
  if (knownIds.length > 200 || knownIds.some((id) => !CHAT_UUID.test(id)))
    return json({ error: "invalid_message_ids" }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  let window;
  try {
    window = roomWindowQuery(req.nextUrl.searchParams);
  } catch (e) {
    return json({ error: e instanceof ChatWindowError ? e.message : "invalid_window" }, 400);
  }
  if (window.enabled) {
    try {
      // Deletion evidence does not depend on the window, so both reads run together.
      const [page, deleted] = await Promise.all([
        readRoomWindow(admin, room, null, req.nextUrl.searchParams, MESSAGE_COLUMNS, 80),
        removedKnownMessages(admin, room, knownIds),
      ]);
      if (deleted.error) return json({ error: "unavailable" }, 503);
      const canonical = mergeConfirmedMessages(page.messages, deleted.data ?? []);
      const [reactions, messages] = await Promise.all([
        roomReactions(admin, canonical),
        withMessageMemberships(admin, canonical),
      ]);
      if (reactions.error) return json({ error: "unavailable" }, 503);
      return json({ ...page, messages, reactions: reactions.data ?? [] });
    } catch (e) {
      return json(
        { error: e instanceof ChatWindowError ? e.message : "unavailable" },
        e instanceof ChatWindowError ? e.status : 503,
      );
    }
  }
  const anchor = req.nextUrl.searchParams.get("anchor");
  if (anchor && !CHAT_UUID.test(anchor)) return json({ error: "invalid_anchor" }, 400);
  // Deletion evidence is independent of the latest page, so fetch it alongside.
  const deletedRequest = removedKnownMessages(admin, room, knownIds);
  let latestThrough: number | undefined;
  if (req.nextUrl.searchParams.get("latest") === "1") {
    const latest = await admin
      .from("longboard_chat_messages")
      .select("unread_seq")
      .eq("room_slug", room)
      .eq("removed", false)
      .is("deleted_at", null)
      .order("unread_seq", { ascending: false })
      .limit(1);
    if (latest.error) return json({ error: "unavailable" }, 503);
    latestThrough = latest.data?.[0]?.unread_seq ?? 0;
  }
  let messageQuery = admin
    .from("longboard_chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_slug", room)
    .eq("removed", false)
    .is("reply_to_id", null)
    .order("created_at", { ascending: false })
    .limit(80);
  if (latestThrough !== undefined) messageQuery = messageQuery.lte("unread_seq", latestThrough);
  const messages = await messageQuery;
  if (messages.error) return json({ error: "unavailable" }, 503);
  if (anchor && !messages.data?.some((m) => m.id === anchor)) {
    const retained = await admin
      .from("longboard_chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("room_slug", room)
      .eq("removed", false)
      .eq("id", anchor)
      .is("reply_to_id", null)
      .maybeSingle();
    if (retained.error) return json({ error: "unavailable" }, 503);
    if (retained.data) messages.data?.push(retained.data);
  }
  // Return canonical deletion evidence for rows previously observed by this pane.
  // It stays hidden in the UI but prevents a held send ACK from restoring erased text.
  const deleted = await deletedRequest;
  if (deleted.error) return json({ error: "unavailable" }, 503);
  messages.data?.push(...(deleted.data ?? []));
  const canonical = mergeConfirmedMessages([], messages.data ?? []).reverse();
  const [reactions, withMemberships] = await Promise.all([
    roomReactions(admin, canonical),
    withMessageMemberships(admin, canonical),
  ]);
  if (reactions.error) return json({ error: "unavailable" }, 503);
  return json({
    messages: withMemberships,
    reactions: reactions.data ?? [],
    ...(latestThrough !== undefined ? { latestThrough } : {}),
  });
}

type ChatAdmin = NonNullable<ReturnType<typeof createChatAdminClient>>;

// Async so the query starts immediately: Supabase builders are lazy until awaited.
async function removedKnownMessages(admin: ChatAdmin, room: string, knownIds: string[]) {
  if (!knownIds.length) return { data: [], error: null };
  return await admin
    .from("longboard_chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_slug", room)
    .eq("removed", true)
    .is("reply_to_id", null)
    .in("id", knownIds)
    .limit(200);
}

async function roomReactions(admin: ChatAdmin, canonical: Array<{ id: string; removed?: boolean | null }>) {
  const ids = canonical.filter((m) => !m.removed).map((m) => m.id);
  if (!ids.length) return { data: [], error: null };
  return await admin
    .from("longboard_chat_reactions")
    .select("message_id,guest_id,active,created_at,updated_at")
    .in("message_id", ids);
}
