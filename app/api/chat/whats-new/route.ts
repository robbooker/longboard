import { createChatAdminClient } from "@/lib/chatAdmin";
import {
  composeWhatsNewNote,
  parseWhatsNewFollowUp,
  parseWhatsNewRequest,
  planWhatsNewFollowUp,
  planWhatsNewPictures,
  whatsNewAuthorized,
  type WhatsNewFollowUp,
} from "@/lib/chatWhatsNew";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * #302: posts one "Booker Chat Updates" note to What's New for the user-visible PRs of a
 * production deploy. Called by .github/workflows/whats-new.yml with WHATS_NEW_TOKEN, never by a
 * member. PRs already announced are left out, so a rerun of the same deploy posts nothing.
 *
 * #443: a change may list uploaded pictures (POST /api/chat/whats-new/pictures). The note carries
 * the first 3; the rest follow right after it. `{ followUp: { pr, pictures } }` posts pictures
 * for a PR that was already announced, once. Without pictures the call is exactly as before.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.WHATS_NEW_TOKEN;
  if (!secret || secret.length < 32) return json({ error: "whats_new_not_configured" }, 503);
  if (!whatsNewAuthorized(request.headers.get("authorization"), secret))
    return json({ error: "unauthorized" }, 401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    return json({ error: "invalid_content_type" }, 415);
  const text = await request.text().catch(() => null);
  if (text === null) return json({ error: "invalid_body" }, 400);
  if (text.length > 65536) return json({ error: "payload_too_large" }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const followUp = parseWhatsNewFollowUp(payload);
  const input = followUp ? null : parseWhatsNewRequest(payload);
  if (!followUp && !input) return json({ error: "invalid_request" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "whats_new_unavailable" }, 503);
  if (followUp) return postFollowUp(db, followUp);
  if (!input) return json({ error: "invalid_request" }, 400);
  // A concurrent run can announce some of these between the read and the post; the post then
  // fails as a whole and the next attempt leaves those out.
  for (let attempt = 0; attempt < 3; attempt++) {
    const known = await db
      .from("chat_whats_new_changes")
      .select("pr_number")
      .in(
        "pr_number",
        input.changes.map((change) => change.pr),
      );
    if (known.error) return json({ error: "whats_new_unavailable" }, 503);
    const announced = new Set((known.data ?? []).map((row: { pr_number: number }) => row.pr_number));
    const fresh = input.changes.filter((change) => !announced.has(change.pr));
    if (!fresh.length) return json({ posted: false, announced: [], alreadyAnnounced: [...announced] });
    const body = composeWhatsNewNote(fresh);
    const { noteFiles, followUps } = planWhatsNewPictures(fresh);
    const pictures = noteFiles.length + followUps.reduce((sum, message) => sum + message.files.length, 0);
    // Without pictures: the three arguments the note has always had.
    const { data, error } = await db.rpc("post_chat_whats_new_note", {
      p_deployment: input.deployment,
      p_body: body,
      p_changes: fresh.map(({ pictures: _pictures, ...change }) => change),
      ...(pictures
        ? {
            p_note_files: noteFiles,
            p_follow_ups: followUps.map((message) => ({ body: message.body, files: message.files })),
          }
        : {}),
    });
    if (error) {
      if (error.message.includes("whats_new_already_posted")) continue;
      if (error.message.includes("longboard_chat_paused")) return json({ error: "room_paused" }, 423);
      if (error.message.includes("invalid_whats_new_pictures"))
        return json({ error: "invalid_pictures" }, 409);
      return json({ error: "whats_new_unavailable" }, 503);
    }
    publishRoomEventAfterResponse("whats-new", { kind: "changed", topics: ["history"] });
    const result = data as { messageId: string; followUpIds?: string[] };
    return json({
      posted: true,
      messageId: result.messageId,
      announced: fresh.map((change) => change.pr),
      alreadyAnnounced: [...announced],
      body,
      ...(pictures ? { pictures, followUpIds: result.followUpIds ?? [] } : {}),
    });
  }
  return json({ error: "whats_new_busy" }, 409);
}

/** #443: pictures for a PR whose note is already in the room, posted once, under its note's text. */
async function postFollowUp(db: SupabaseClient, followUp: WhatsNewFollowUp) {
  const known = await db.from("chat_whats_new_changes").select("pr_number,note").eq("pr_number", followUp.pr);
  if (known.error) return json({ error: "whats_new_unavailable" }, 503);
  const change = known.data?.[0] as { note: string } | undefined;
  if (!change) return json({ error: "not_announced" }, 409);
  const messages = planWhatsNewFollowUp(followUp.pr, change.note, followUp.pictures);
  const { data, error } = await db.rpc("post_chat_whats_new_pictures", {
    p_pr: followUp.pr,
    p_follow_ups: messages.map((message) => ({ body: message.body, files: message.files })),
  });
  if (error) {
    if (error.message.includes("whats_new_pictures_already_posted"))
      return json({ error: "pictures_already_posted" }, 409);
    if (error.message.includes("whats_new_not_announced")) return json({ error: "not_announced" }, 409);
    if (error.message.includes("longboard_chat_paused")) return json({ error: "room_paused" }, 423);
    if (error.message.includes("invalid_whats_new_pictures")) return json({ error: "invalid_pictures" }, 409);
    return json({ error: "whats_new_unavailable" }, 503);
  }
  publishRoomEventAfterResponse("whats-new", { kind: "changed", topics: ["history"] });
  return json({
    posted: true,
    pr: followUp.pr,
    messageIds: (data as { messageIds: string[] }).messageIds,
    bodies: messages.map((message) => message.body),
    pictures: followUp.pictures.length,
  });
}
