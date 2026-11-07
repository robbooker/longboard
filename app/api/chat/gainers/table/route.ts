import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { easternDay, tableRow, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #371 Gainers Table: one row per stock that alerted in the gainers room today (Eastern), newest
 * alert first, with its saved facts. For the members who can open the gainers room, nobody else.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const db = createChatAdminClient();
  if (!db) return json({ error: "table_unavailable" }, 503);
  const day = easternDay();
  try {
    const { data, error } = await db.rpc("chat_gainers_table", { p_day: day });
    if (error) return json({ error: "table_unavailable" }, 503);
    return json({ day, rows: ((data ?? []) as GainersTableDbRow[]).map(tableRow) });
  } catch {
    return json({ error: "table_unavailable" }, 503);
  }
}
