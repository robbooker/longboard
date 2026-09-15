import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: "invalid_message" }, 400);
  const db = await createClient();
  const { data, error } = await db.rpc("longboard_chat_search_context", { p_message: id });
  if (error) return json({ error: "context_unavailable" }, 503);
  return json({ messages: data ?? [] });
}
