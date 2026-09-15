import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const room = req.nextUrl.searchParams.get("room") ?? "main";
  if (q.length < 2 || q.length > 200 || !["main", "social", "all"].includes(room)) return json({ error: "invalid_search" }, 400);
  const before = req.nextUrl.searchParams.get("before");
  const beforeId = req.nextUrl.searchParams.get("beforeId");
  if (Boolean(before) !== Boolean(beforeId) || (before && !Number.isFinite(Date.parse(before))) || (beforeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId))) return json({ error: "invalid_cursor" }, 400);
  const db = await createClient();
  const { data, error } = await db.rpc("search_longboard_chat", { p_query: q, p_room: room, p_before: before, p_before_id: beforeId });
  if (error) return json({ error: "search_unavailable" }, 503);
  return json({ messages: (data ?? []).slice(0,20), hasMore: (data?.length ?? 0) > 20 });
}
