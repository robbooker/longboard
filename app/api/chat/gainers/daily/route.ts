import { createChatAdminClient } from "@/lib/chatAdmin";
import { gainersAuthorized } from "@/lib/chatGainers";
import { parseGainersDay, parseGainersPage } from "@/lib/chatGainersPages";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BYTES = 3_000_000;
const PAGE_ROWS = 1000;

/** #340: this token only reaches this route, and this route only reaches gainers alerts and daily pages. */
function refused(request: NextRequest) {
  const secret = process.env.CHAT_GAINERS_DAILY_TOKEN;
  if (!secret || secret.length < 32) return json({ error: "daily_not_configured" }, 503);
  if (!gainersAuthorized(request.headers.get("authorization"), secret))
    return json({ error: "unauthorized" }, 401);
  return null;
}

/** GET ?alerts=YYYY-MM-DD: one Eastern day's gainers room alerts, for the nightly job. Read-only. */
export async function GET(request: NextRequest) {
  const denied = refused(request);
  if (denied) return denied;
  const day = parseGainersDay(request.nextUrl.searchParams.get("alerts"));
  if (!day) return json({ error: "invalid_day" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "daily_unavailable" }, 503);
  const bounds = await db.rpc("chat_gainers_day_bounds", { p_day: day });
  if (bounds.error || !bounds.data) return json({ error: "daily_unavailable" }, 503);
  const { start, finish } = bounds.data as { start: string; finish: string };
  const rows: Array<{ ts: string; body: string }> = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await db
      .from("longboard_chat_messages")
      .select("created_at,body")
      .eq("room_slug", "gainers")
      .is("reply_to_id", null)
      .eq("removed", false)
      .gte("created_at", start)
      .lt("created_at", finish)
      .order("created_at")
      .order("id")
      .range(from, from + PAGE_ROWS - 1);
    if (error) return json({ error: "daily_unavailable" }, 503);
    for (const row of data ?? []) rows.push({ ts: row.created_at, body: row.body });
    if ((data ?? []).length < PAGE_ROWS) break;
  }
  return json({ day, rows });
}

/** POST: saves one day's page. A rerun for the same day replaces it. */
export async function POST(request: NextRequest) {
  const denied = refused(request);
  if (denied) return denied;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    return json({ error: "invalid_content_type" }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_json" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
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
  const page = parseGainersPage(payload);
  if (!page) return json({ error: "invalid_page" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "daily_unavailable" }, 503);
  const { error } = await db
    .from("chat_gainers_pages")
    .upsert(
      { trading_day: page.day, data: page, updated_at: new Date().toISOString() },
      { onConflict: "trading_day" },
    );
  if (error) return json({ error: "daily_unavailable" }, 503);
  return json({ saved: true, day: page.day });
}
