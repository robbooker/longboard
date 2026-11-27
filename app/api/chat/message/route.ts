import { withMessageMemberships } from "@/lib/chatMembershipProjection";
import { NextRequest, NextResponse } from "next/server";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatAdmin } from "@/lib/chatRole";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { chatWriteNow, clubRefusal } from "@/lib/chatClubLiveServer";
import { CHAT_UUID } from "@/lib/chatMembers";
import { parseChatRoom } from "@/lib/publicChat";
import { CHAT_MESSAGE_MAX_LENGTH, isOverMessageLimit } from "@/lib/chatMessageLimit";
export async function POST(req: NextRequest) {
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const p = await req.json().catch(() => null);
  const room = parseChatRoom(p?.room);
  if (
    !p ||
    !room ||
    typeof p.messageId !== "string" ||
    !CHAT_UUID.test(p.messageId) ||
    !["edit", "delete"].includes(p.action)
  )
    return json({ error: "invalid_action" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  // #535: in Booker Stock Club a member edits or deletes their own post only while a webinar is
  // live there (the same answer as posting). Once it has ended their posts stay as they are.
  const write = await chatWriteNow(auth.access, room, auth);
  if (!write.allowed)
    return json(
      {
        error:
          room === "gainers"
            ? "Gainers is a read-only broadcast channel."
            : room === "club"
              ? clubRefusal(write)
              : room === "whats-new"
                ? "Only admins can change What's New? notes."
                : "Only admins can change announcements and recordings.",
      },
      403,
    );
  if (
    p.action === "edit" &&
    (typeof p.body !== "string" ||
      !p.body.trim() ||
      isOverMessageLimit(p.body) ||
      typeof p.expectedBody !== "string" ||
      p.expectedBody.length > CHAT_MESSAGE_MAX_LENGTH)
  )
    return json({ error: "invalid_message" }, 400);
  if (
    p.expectedRevision !== undefined &&
    (!Number.isInteger(p.expectedRevision) || p.expectedRevision < 0 || p.expectedRevision > 2147483647)
  )
    return json({ error: "invalid_action" }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  // #457: in Booker Stock Club an admin changes only their own posts (never a stock-pick card).
  // #535: now that members post there during a webinar, an admin can also remove a person's post
  // (moderation, as in any room). Never a bot's: the stock-pick cards and the live-video notices
  // are looked up here and left alone.
  let moderator = isChatAdmin(auth);
  if (room === "club" && moderator) {
    moderator = false;
    if (p.action === "delete") {
      const target = await admin.from("longboard_chat_messages").select("guest_id,bot_slug").eq("id", p.messageId).eq("room_slug", "club").maybeSingle();
      moderator = !target.error && !!target.data?.guest_id && !target.data.bot_slug;
    }
  }
  const changes = {
    p_actor: auth.user.id,
    p_message: p.messageId,
    p_action: p.action,
    p_body: p.action === "edit" ? p.body : null,
    p_expected_body: p.action === "edit" ? p.expectedBody : null,
    p_expected_revision: p.expectedRevision ?? null,
  };
  const { data, error } = write.webinar
    ? // #535: a member's own post during a webinar (never as a moderator), with the club's guard told so.
      await admin.rpc("change_chat_club_live_message", changes)
    : await admin.rpc("change_chat_message", { ...changes, p_room: room, p_admin: moderator });
  if (error) {
    const codes: Record<string, number> = {
      room_forbidden: 403,
      message_forbidden: 403,
      club_read_only: 403,
      message_not_found: 404,
      message_changed: 409,
      chat_paused: 423,
      invalid_message: 400,
    };
    return json(
      { error: codes[error.message] ? error.message : "message_update_failed" },
      codes[error.message] ?? 503,
    );
  }
  // Ship the changed row so other windows update instantly; reload only if no row came back.
  const changed = p.action === "delete" ? data?.message : data;
  publishRoomEventAfterResponse(
    room,
    changed?.id
      ? { kind: "message", eventType: "UPDATE", row: changed }
      : { kind: "changed", topics: ["history", "room"] },
  );
  if (p.action === "delete")
    return json({
      ...data,
      message: data.message ? (await withMessageMemberships(admin, [data.message]))[0] : null,
    });
  return json({ message: (await withMessageMemberships(admin, [data]))[0] });
}
