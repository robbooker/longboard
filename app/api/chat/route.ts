import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { answerBuddy, hasBuddyMention, type BuddyContextMessage } from "@/lib/chatBuddy";
import { readPublicRoomState, requestOriginAllowed } from "@/lib/chatAdmin";
import { isReservedChatName } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u;
const MAX_MESSAGES_PER_TEN_MINUTES = 30;

type ChatPayload = {
  action?: unknown;
  token?: unknown;
  displayName?: unknown;
  body?: unknown;
  messageId?: unknown;
  active?: unknown;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizedName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 28 || !NAME_PATTERN.test(name) || isReservedChatName(name)) return null;
  return name;
}

function normalizedBody(value: unknown) {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length >= 1 && body.length <= 600 ? body : null;
}

export async function GET() {
  try {
    return json(await readPublicRoomState());
  } catch {
    return json({ error: "chat_status_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 500);

  let payload: ChatPayload;
  try {
    payload = await request.json() as ChatPayload;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = typeof payload.action === "string" ? payload.action : "";
  const token = typeof payload.token === "string" ? payload.token : "";
  if (!UUID_PATTERN.test(token)) return json({ error: "invalid_guest_token" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = createHash("sha256").update(token).digest("hex");

  if (action !== "session") {
    try {
      const room = await readPublicRoomState(admin);
      if (!room.isOpen) return json({ error: "chat_paused", room }, 423);
    } catch {
      return json({ error: "chat_status_unavailable" }, 503);
    }
  }

  if (action === "register") {
    const displayName = normalizedName(payload.displayName);
    if (!displayName) {
      return json({
        error: "invalid_display_name",
        message: "Use a non-reserved name with 2-28 letters, numbers, spaces, apostrophes, periods, underscores, or hyphens.",
      }, 400);
    }

    const { data, error } = await admin
      .from("longboard_chat_guests")
      .upsert({ token_hash: tokenHash, display_name: displayName, updated_at: new Date().toISOString() }, { onConflict: "token_hash" })
      .select("id, display_name")
      .single();

    if (error || !data) return json({ error: "guest_registration_failed" }, 500);
    return json({ guestId: data.id, displayName: data.display_name });
  }

  const { data: guest, error: guestError } = await admin
    .from("longboard_chat_guests")
    .select("id, display_name")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (guestError) return json({ error: "guest_lookup_failed" }, 500);
  if (!guest) return json({ error: "guest_not_registered" }, 401);

  if (action === "session") {
    return json({ guestId: guest.id, displayName: guest.display_name });
  }

  if (action === "send") {
    const body = normalizedBody(payload.body);
    if (!body) return json({ error: "invalid_message" }, 400);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent, error: rateError } = await admin
      .from("longboard_chat_messages")
      .select("created_at")
      .eq("guest_id", guest.id)
      .gte("created_at", tenMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES_PER_TEN_MINUTES);

    if (rateError) return json({ error: "rate_check_failed" }, 500);
    if ((recent?.length ?? 0) >= MAX_MESSAGES_PER_TEN_MINUTES) {
      return json({ error: "rate_limited", message: "Please pause before sending more messages." }, 429);
    }
    if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 1500) {
      return json({ error: "rate_limited", message: "Please wait a moment before sending again." }, 429);
    }

    const { data, error } = await admin
      .from("longboard_chat_messages")
      .insert({ guest_id: guest.id, author_label: guest.display_name, body })
      .select("id, guest_id, author_label, body, bot_slug, reply_to_id, created_at")
      .single();

    if (error || !data) return json({ error: "message_send_failed" }, 500);

    if (!hasBuddyMention(data.body)) return json({ message: data });

    try {
      const { data: existing } = await admin
        .from("longboard_chat_messages")
        .select("id, guest_id, author_label, body, bot_slug, reply_to_id, created_at")
        .eq("bot_slug", "buddy")
        .eq("reply_to_id", data.id)
        .maybeSingle();
      if (existing) return json({ message: data, buddy: existing });

      const { data: contextRows } = await admin
        .from("longboard_chat_messages")
        .select("author_label, body, bot_slug")
        .lt("created_at", data.created_at)
        .order("created_at", { ascending: false })
        .limit(12);
      const context = ((contextRows ?? []) as BuddyContextMessage[]).reverse();
      const answer = await answerBuddy(data.body, context);
      const currentRoom = await readPublicRoomState(admin);
      if (!currentRoom.isOpen) return json({ message: data, buddyError: "chat_paused" });
      const { data: buddy, error: buddyError } = await admin
        .from("longboard_chat_messages")
        .insert({
          guest_id: null,
          author_label: "@Buddy",
          body: answer.text,
          bot_slug: "buddy",
          reply_to_id: data.id,
        })
        .select("id, guest_id, author_label, body, bot_slug, reply_to_id, created_at")
        .single();
      if (!buddyError && buddy) return json({ message: data, buddy });

      if (buddyError?.code === "23505") {
        const { data: duplicate } = await admin
          .from("longboard_chat_messages")
          .select("id, guest_id, author_label, body, bot_slug, reply_to_id, created_at")
          .eq("bot_slug", "buddy")
          .eq("reply_to_id", data.id)
          .maybeSingle();
        if (duplicate) return json({ message: data, buddy: duplicate });
      }
      console.error("[api/chat] Buddy reply insert failed", buddyError);
      return json({ message: data, buddyError: "reply_save_failed" });
    } catch (buddyError) {
      console.error("[api/chat] Buddy response failed", buddyError);
      return json({ message: data, buddyError: "reply_unavailable" });
    }
  }

  if (action === "react") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
    if (!UUID_PATTERN.test(messageId) || typeof payload.active !== "boolean") {
      return json({ error: "invalid_reaction" }, 400);
    }

    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("longboard_chat_reactions")
      .upsert({ message_id: messageId, guest_id: guest.id, active: payload.active, updated_at: now }, { onConflict: "message_id,guest_id" })
      .select("message_id, guest_id, active, created_at, updated_at")
      .single();

    if (error || !data) return json({ error: "reaction_save_failed" }, 500);
    return json({ reaction: data });
  }

  return json({ error: "unknown_action" }, 400);
}
