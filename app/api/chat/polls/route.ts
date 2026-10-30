import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { canAccessChatRoom, canWriteChatRoom } from "@/lib/chatAccess";
import { CHAT_UUID } from "@/lib/chatMembers";
import { parseChatRoom, roomRepliesOff, type ChatRoom } from "@/lib/publicChat";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { processChatPushJobs } from "@/lib/chatPush";
import { shapePoll, validatePollDraft, type RawPoll } from "@/lib/chatPolls";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #328 Polls. One POST endpoint, like message-reactions:
//   create {room, question, options[], anonymous, multi, replyTo?, clientId?}  -> {message, poll}
//   read   {room, messageIds[]}                                               -> {polls}
//   vote   {room, messageId, optionIds[]} (empty takes the vote back)          -> {poll}
//   close  {room, messageId} (the creator only)                               -> {poll}
// Results (counts) reach a reader only after they vote or once the poll is closed. Who voted for
// what is never sent for an anonymous poll, to anyone. Changes go out as a "polls" signal on the
// room's realtime channel carrying only the message id; each window re-reads through this route.

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

const ERRORS: Record<string, [number, string]> = {
  member_required: [409, "Choose your member chat name first."],
  chat_paused: [423, "This room is paused."],
  poll_not_found: [404, "That poll can't be found."],
  poll_closed: [409, "This poll is closed."],
  single_choice: [400, "Choose one answer."],
  invalid_option: [400, "That answer isn't in this poll."],
  poll_forbidden: [403, "Only the person who made this poll can close it."],
  invalid_poll: [400, "Add a question and at least two different answers."],
};
function failure(message: string | undefined, fallback: string) {
  const known = message ? ERRORS[message] : undefined;
  return known ? json({ error: message, message: known[1] }, known[0]) : json({ error: fallback }, 503);
}

async function readPolls(db: SupabaseClient, user: string, room: ChatRoom, ids: string[]) {
  const { data, error } = await db.rpc("read_chat_polls", { p_user: user, p_room: room, p_messages: ids });
  if (error || !Array.isArray(data)) return null;
  return (data as RawPoll[]).map(shapePoll);
}

const validIds = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((id) => typeof id === "string" && CHAT_UUID.test(id));

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const p = await req.json().catch(() => null);
  const room = parseChatRoom(p?.room);
  const action = p?.action;
  if (!room || !["create", "read", "vote", "close"].includes(action))
    return json({ error: "invalid_target" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  const user = auth.user.id;

  if (action === "read") {
    if (!validIds(p.messageIds, 100) || !p.messageIds.length) return json({ error: "invalid_target" }, 400);
    const polls = await readPolls(db, user, room, p.messageIds);
    return polls ? json({ polls }) : json({ error: "polls_unavailable" }, 503);
  }

  if (action === "create") {
    if (!canWriteChatRoom(auth.access, room))
      return json({ error: "room_read_only", message: "Only admins can post in this room." }, 403);
    const reply = p.replyTo ?? null;
    if (reply !== null && (typeof reply !== "string" || !CHAT_UUID.test(reply)))
      return json({ error: "invalid_reply" }, 400);
    if (reply && roomRepliesOff(room))
      return json({ error: "replies_off", message: "Replies are off here." }, 403);
    if (p.clientId !== undefined && (typeof p.clientId !== "string" || !CHAT_UUID.test(p.clientId)))
      return json({ error: "invalid_client_id" }, 400);
    const draft = validatePollDraft(p);
    if (!draft.ok) return json({ error: "invalid_poll", message: draft.error }, 400);
    const { data, error } = await db.rpc("create_chat_poll", {
      p_user: user,
      p_room: room,
      p_question: draft.poll.question,
      p_options: draft.poll.options,
      p_anonymous: draft.poll.anonymous,
      p_multi: draft.poll.multi,
      p_reply: reply,
      p_client: typeof p.clientId === "string" ? p.clientId : randomUUID(),
    });
    if (error) return failure(error.message, "poll_create_failed");
    const result = data as {
      status: string;
      message?: Record<string, unknown> & { id: string };
      reason?: string;
    };
    switch (result?.status) {
      case "sent":
      case "duplicate":
        break;
      case "paused":
        return json({ error: "chat_paused", message: "This room is paused." }, 423);
      case "member_required":
        return failure("member_required", "poll_create_failed");
      case "reply_not_found":
        return json({ error: "reply_not_found", message: "That conversation can't be found." }, 404);
      case "rate_limited":
        return json({ error: "rate_limited", message: "Please wait a moment before sending again." }, 429);
      case "send_conflict":
        return json({ error: "send_conflict" }, 409);
      default:
        return json({ error: "poll_create_failed" }, 503);
    }
    const message = result.message!;
    if (result.status === "sent") {
      const { memberships: _badges, ...row } = message;
      publishRoomEventAfterResponse(room, { kind: "message", eventType: "INSERT", row });
      after(async () => {
        try {
          await processChatPushJobs();
        } catch {
          /* Cron retries the durable outbox. */
        }
      });
    }
    const polls = await readPolls(db, user, room, [message.id]);
    return json({ message, poll: polls?.[0] ?? null });
  }

  if (typeof p.messageId !== "string" || !CHAT_UUID.test(p.messageId))
    return json({ error: "invalid_target" }, 400);
  const messageId: string = p.messageId;
  if (action === "vote") {
    if (!validIds(p.optionIds, 10)) return json({ error: "invalid_option" }, 400);
    const { error } = await db.rpc("vote_chat_poll", {
      p_user: user,
      p_room: room,
      p_message: messageId,
      p_options: [...new Set(p.optionIds as string[])],
    });
    if (error) return failure(error.message, "vote_failed");
  } else {
    const { error } = await db.rpc("close_chat_poll", { p_user: user, p_room: room, p_message: messageId });
    if (error) return failure(error.message, "close_failed");
  }
  publishRoomEventAfterResponse(room, { kind: "changed", topics: ["polls"], messageId });
  const polls = await readPolls(db, user, room, [messageId]);
  return json({ poll: polls?.[0] ?? null });
}
