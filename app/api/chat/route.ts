import { isRecordingRoom } from "@/lib/publicChat";
import { processChatPushJobs } from "@/lib/chatPush";
import { canAccessChatRoom, canWriteChatRoom } from "@/lib/chatAccess";
import { readPublicRoomState, requestOriginAllowed } from "@/lib/chatAdmin";
import { attachmentIds } from "@/lib/chatAttachments";
import { withAttachmentMedia } from "@/lib/chatAttachmentMedia";
import { requireChatUser } from "@/lib/chatAuth";
import { processBuddyJobs } from "@/lib/chatBuddyJobs";
import { findChatMember } from "@/lib/chatMembers";
import { readRoom } from "@/lib/chatReads/room";
import { parseSummaryCommand } from "@/lib/chatSummaryCommand";
import { parseChatRoom, type ChatRoom } from "@/lib/publicChat";
import { createClient } from "@supabase/supabase-js";
import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { ChatServerTiming } from "@/lib/chatServerTiming";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChatPayload = {
  room?: unknown;
  action?: unknown;
  token?: unknown;
  displayName?: unknown;
  body?: unknown;
  messageId?: unknown;
  replyTo?: unknown;
  active?: unknown;
  attachmentIds?: unknown;
  clientId?: unknown;
};

function json(body: Record<string, unknown>, status = 200, timing?: ChatServerTiming) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(timing ? { "Server-Timing": timing.header() } : {}) },
  });
}

function normalizedBody(value: unknown) {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length >= 1 && body.length <= 600 ? body : null;
}

type SendResult =
  | { status: "sent" | "duplicate"; message: Record<string, unknown> & { id: string; buddy_status?: string } }
  | { status: "paused"; room: Record<string, unknown> }
  | { status: "room_unavailable" | "member_required" | "send_conflict" | "reply_not_found" }
  | { status: "rate_limited"; reason: "window" | "burst" };

// P10: every check and the insert run in one database call (send_chat_room_message).
async function send(
  admin: SupabaseClient,
  userId: string,
  roomSlug: ChatRoom,
  payload: ChatPayload,
  timing: ChatServerTiming,
) {
  let files: string[];
  try {
    files = attachmentIds(payload.attachmentIds);
  } catch {
    return json({ error: "invalid_attachments" }, 400);
  }
  const body = files.length && payload.body === "" ? "" : normalizedBody(payload.body);
  if (body === null) return json({ error: "invalid_message" }, 400);
  if (
    payload.clientId !== undefined &&
    (typeof payload.clientId !== "string" || !UUID_PATTERN.test(payload.clientId))
  )
    return json({ error: "invalid_client_id" }, 400);
  if (
    payload.replyTo !== undefined &&
    payload.replyTo !== null &&
    (typeof payload.replyTo !== "string" || !UUID_PATTERN.test(payload.replyTo))
  )
    return json({ error: "invalid_reply" }, 400);
  if (parseSummaryCommand(body, roomSlug))
    return json({ error: "Use the summary command in the updated chat page. Refresh and try again." }, 400);

  const { data, error } = await timing.time("send", () =>
    admin.rpc("send_chat_room_message", {
      p_user: userId,
      p_room: roomSlug,
      p_body: body,
      p_reply: typeof payload.replyTo === "string" ? payload.replyTo : null,
      p_files: files,
      p_client: typeof payload.clientId === "string" ? payload.clientId : randomUUID(),
    }),
  );
  const result = data as SendResult | null;
  if (error || !result) {
    const attachment = error?.message?.startsWith("attachment_");
    return json(
      {
        error: attachment
          ? "A file is no longer ready. Remove it and attach it again."
          : "message_send_failed",
      },
      attachment ? 409 : 500,
      timing,
    );
  }
  switch (result.status) {
    case "paused":
      return json({ error: "chat_paused", room: result.room }, 423, timing);
    case "room_unavailable":
      return json({ error: "chat_status_unavailable" }, 503, timing);
    case "member_required":
      return json({ error: "member_required", message: "Choose your member chat name first." }, 409, timing);
    case "send_conflict":
      return json({ error: "send_conflict" }, 409, timing);
    case "reply_not_found":
      return json({ error: "reply_not_found" }, 404, timing);
    case "rate_limited":
      return json(
        {
          error: "rate_limited",
          message:
            result.reason === "window"
              ? "Please pause before sending more messages."
              : "Please wait a moment before sending again.",
        },
        429,
        timing,
      );
    case "duplicate":
      return json({ message: result.message }, 200, timing);
  }
  const message = result.message;
  // Fan out the confirmed row so every open window can merge it without polling.
  const { memberships: _badges, ...row } = message;
  // MEDIA-SIZE: messages with files carry their image sizes, read after the response is sent.
  publishRoomEventAfterResponse(
    roomSlug,
    files.length
      ? async () => ({
          kind: "message",
          eventType: "INSERT",
          row: (
            await withAttachmentMedia(admin, { room: roomSlug }, [row as typeof row & { id: string }])
          )[0],
        })
      : { kind: "message", eventType: "INSERT", row },
  );
  after(async () => {
    try {
      await processChatPushJobs();
    } catch {
      /* Cron retries the durable outbox. */
    }
  });
  // The insert trigger has durably queued Buddy in the same transaction.
  // after() accelerates work, but cron recovers if the function stops here.
  if (message.buddy_status === "pending")
    after(async () => {
      try {
        await processBuddyJobs({ messageId: message.id, limit: 1 });
      } catch {
        console.error("[api/chat] Deferred Buddy worker unavailable; durable queue retained");
      }
    });
  return json({ message }, 200, timing);
}

export async function GET(request: NextRequest) {
  return readRoom(request, await requireChatUser(request));
}

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);

  const timing = new ChatServerTiming();
  const auth = await requireChatUser(request, timing);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 500);

  let payload: ChatPayload;
  try {
    payload = (await request.json()) as ChatPayload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return json({ error: "invalid_json" }, 400);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const roomSlug = parseChatRoom(payload.room);
  if (!roomSlug) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, roomSlug)) return json({ error: "room_forbidden" }, 403);
  const action = typeof payload.action === "string" ? payload.action : "";
  if (isRecordingRoom(roomSlug) && payload.replyTo != null)
    return json({ error: "Replies are disabled in recording channels." }, 403);
  if (action !== "session" && action !== "react" && !canWriteChatRoom(auth.access, roomSlug))
    return json(
      {
        error:
          roomSlug === "gainers"
            ? "Gainers is a read-only broadcast channel."
            : "Only admins can post in announcement and recording channels.",
      },
      403,
    );

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "send") return send(admin, auth.user.id, roomSlug, payload, timing);

  if (action !== "session") {
    try {
      const room = await readPublicRoomState(admin, roomSlug);
      if (!room.isOpen) return json({ error: "chat_paused", room }, 423);
    } catch {
      return json({ error: "chat_status_unavailable" }, 503);
    }
  }

  let guest: { id: string; display_name: string };
  let memberId: string;
  try {
    const member = await findChatMember(admin, auth.user.id);
    if (!member)
      return json({ error: "member_required", message: "Choose your member chat name first." }, 409);
    guest = member;
    memberId = member.id;
  } catch {
    return json({ error: "member_lookup_failed" }, 503);
  }
  if (action === "register") return json({ error: "member_name_linked" }, 409);
  if (action === "session") return json({ guestId: guest.id, displayName: guest.display_name, memberId });

  if (action === "react") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
    if (!UUID_PATTERN.test(messageId) || typeof payload.active !== "boolean") {
      return json({ error: "invalid_reaction" }, 400);
    }

    const { data: target, error: targetError } = await admin
      .from("longboard_chat_messages")
      .select("id")
      .eq("id", messageId)
      .eq("room_slug", roomSlug)
      .maybeSingle();
    if (targetError) return json({ error: "message_lookup_failed" }, 503);
    if (!target) return json({ error: "message_not_found" }, 404);
    // Reuse the target-before-reaction lock order, including legacy like clients.
    const result = await admin.rpc("set_chat_message_reaction", {
      p_actor: auth.user.id,
      p_room: roomSlug,
      p_conversation: null,
      p_message: messageId,
      p_emoji: "like",
      p_active: payload.active,
    });
    if (result.error)
      return json(
        {
          error: result.error.message === "message_not_found" ? "message_not_found" : "reaction_save_failed",
        },
        result.error.message === "message_not_found" ? 404 : 500,
      );
    publishRoomEventAfterResponse(roomSlug, { kind: "changed", topics: ["reactions"], messageId });
    const { data, error } = await admin
      .from("longboard_chat_reactions")
      .select("message_id, guest_id, active, created_at, updated_at")
      .eq("message_id", messageId)
      .eq("guest_id", guest.id)
      .maybeSingle();
    if (error || !data) return json({ error: "message_not_found" }, 404);
    return json({ reaction: data });
  }

  return json({ error: "unknown_action" }, 400);
}
