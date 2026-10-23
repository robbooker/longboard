import { createChatAdminClient } from "@/lib/chatAdmin";
import { composeWhatsNewNote, parseWhatsNewRequest, whatsNewAuthorized } from "@/lib/chatWhatsNew";
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
  const input = parseWhatsNewRequest(payload);
  if (!input) return json({ error: "invalid_request" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "whats_new_unavailable" }, 503);
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
    const { data, error } = await db.rpc("post_chat_whats_new_note", {
      p_deployment: input.deployment,
      p_body: body,
      p_changes: fresh,
    });
    if (error) {
      if (error.message.includes("whats_new_already_posted")) continue;
      if (error.message.includes("longboard_chat_paused")) return json({ error: "room_paused" }, 423);
      return json({ error: "whats_new_unavailable" }, 503);
    }
    publishRoomEventAfterResponse("whats-new", { kind: "changed", topics: ["history"] });
    return json({
      posted: true,
      messageId: (data as { messageId: string }).messageId,
      announced: fresh.map((change) => change.pr),
      alreadyAnnounced: [...announced],
      body,
    });
  }
  return json({ error: "whats_new_busy" }, 409);
}
