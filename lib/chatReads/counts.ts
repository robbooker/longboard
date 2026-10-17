import { NextRequest, NextResponse } from "next/server";

import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { CHAT_UUID } from "@/lib/chatMembers";
import { replyThreadSummary, type ReplyThreads } from "@/lib/chatReplyCounts";
import { parseChatRoom } from "@/lib/publicChat";

import type { ChatAuthResult } from "@/lib/chatAuth";

// Until 20261017120000_chat_thread_summaries.sql is applied, read counts only (and look again
// a minute later), so the app works before and after the migration.
let summariesMissingUntil = 0;
const missingFunction = (error: { code?: string; message?: string }) =>
  error.code === "PGRST202" || error.code === "42883" || /chat_thread_summaries/.test(error.message ?? "");

export async function readCounts(req: NextRequest, auth: ChatAuthResult) {
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const room = parseChatRoom(req.nextUrl.searchParams.get("room"));
  const ids = [...new Set((req.nextUrl.searchParams.get("ids") || "").split(",").filter(Boolean))];
  if (!room || ids.length > 80 || ids.some((id) => !CHAT_UUID.test(id)))
    return json({ error: "Invalid conversations." }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "Room not available." }, 403);
  if (!ids.length) return json({ counts: {} });
  const db = createChatAdminClient();
  if (!db) return json({ error: "Counts unavailable." }, 503);
  type Row = { message_id: string; reply_count: number; last_reply_at?: string | null; repliers?: unknown };
  let result: { data: Row[] | null; error: { code?: string; message?: string } | null } = { data: null, error: null };
  if (Date.now() >= summariesMissingUntil) {
    result = await db.rpc("chat_thread_summaries", { p_room: room, p_ids: ids });
    if (result.error && missingFunction(result.error)) summariesMissingUntil = Date.now() + 60_000;
    else if (result.error) return json({ error: "Counts unavailable." }, 503);
  }
  if (Date.now() < summariesMissingUntil) {
    result = await db.rpc("chat_thread_counts", { p_room: room, p_ids: ids });
    if (result.error) return json({ error: "Counts unavailable." }, 503);
  }
  const rows = result.data ?? [];
  const threads: ReplyThreads = {};
  for (const row of rows) {
    const summary = replyThreadSummary(row.last_reply_at, row.repliers);
    if (Number(row.reply_count) > 0 && summary) threads[row.message_id] = summary;
  }
  return json({
    counts: Object.fromEntries(rows.map((row) => [row.message_id, Number(row.reply_count)])),
    ...(Object.keys(threads).length ? { threads } : {}),
  });
}
