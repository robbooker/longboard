import { createChatAdminClient } from "@/lib/chatAdmin";
import { gainersAuthorized } from "@/lib/chatGainers";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { parseRunnerWatchUpdate, RUNNER_WATCH_MAX_BYTES, runnerWatchReportId } from "@/lib/chatRunnerWatch";
import { composeRunnerWatchPost } from "@/lib/chatRunnerWatchText";
import type { ChatRoom } from "@/lib/publicChat";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const RETRY = { "Retry-After": "3600" };

/**
 * #341: one Runner Risk Watch update from Jake's report. A dedicated secret, never a member cookie or
 * database login. Refused before the body is read without it, and when the secret isn't set at all.
 * The database does the rest under one lock: the off switch, duplicates, limits and the post.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CHAT_RUNNER_WATCH_TOKEN;
  if (!secret || secret.length < 32) return json({ error: "feed_not_configured" }, 503);
  if (!gainersAuthorized(request.headers.get("authorization"), secret)) return json({ error: "unauthorized" }, 401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    return json({ error: "invalid_content_type" }, 415);
  // Bound the streamed request too; Content-Length is not authoritative.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_json" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > RUNNER_WATCH_MAX_BYTES) {
        await reader.cancel();
        return json({ error: "payload_too_large" }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = parseRunnerWatchUpdate(payload);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { update } = parsed;
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "feed_unavailable" }, 503);
  const id = runnerWatchReportId(update.key);
  const origin = request.nextUrl.origin;
  try {
    const { data, error } = await admin.rpc("ingest_chat_runner_watch", {
      p_id: id,
      p_key: update.key,
      p_hash: update.hash,
      p_tickers: update.tickers,
      p_summary: update.summary,
      p_full_text: update.fullText,
      p_post: composeRunnerWatchPost({ ...update, url: `${origin}/runner-watch/${id}` }),
      p_main_post: composeRunnerWatchPost({ ...update, url: `${origin}/runner-watch/${id}`, mainRoom: true }),
      p_alert: update.alert,
      p_sent_at: update.sentAt,
      p_admin_url: `${origin}/admin/runner-watch`,
    });
    if (error) {
      if (error.message.includes("longboard_chat_paused")) return json({ error: "room_paused" }, 423);
      return json({ error: "feed_unavailable" }, 503);
    }
    const result = data as { status: string; reportId?: string; told?: boolean; rooms?: string[]; capped?: string[] };
    switch (result.status) {
      case "posted":
        for (const room of ["runner-watch", ...(result.rooms ?? [])] as ChatRoom[])
          publishRoomEventAfterResponse(room, { kind: "changed", topics: ["history"] });
        if (result.told) publishRoomEventAfterResponse("admins", { kind: "changed", topics: ["history"] });
        return json({
          status: "posted",
          reportId: result.reportId,
          url: `${origin}/runner-watch/${result.reportId}`,
          mainRooms: result.rooms ?? [],
          mainRoomsAtLimit: result.capped ?? [],
        });
      case "duplicate":
        return json({ status: "duplicate", reportId: result.reportId });
      case "saved":
        return json({ status: "saved", reportId: result.reportId });
      case "held":
        if (result.told) publishRoomEventAfterResponse("admins", { kind: "changed", topics: ["history"] });
        return json({ status: "held", error: "too_many_updates", reportId: result.reportId }, 429, RETRY);
      case "refused":
        return json({ status: "refused", error: "too_many_updates" }, 429, RETRY);
      case "off":
        return json({ error: "feed_off" }, 503);
      default:
        return json({ error: "feed_unavailable" }, 503);
    }
  } catch {
    return json({ error: "feed_unavailable" }, 503);
  }
}
