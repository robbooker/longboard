import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { embedChatText } from "@/lib/chatEmbeddings";
import { createChatAdminClient } from "@/lib/chatAdmin";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const room = req.nextUrl.searchParams.get("room") ?? "main";
  if (q.length < 2 || q.length > 200 || !["main", "social", "all"].includes(room)) return json({ error: "invalid_search" }, 400);
  const mode = req.nextUrl.searchParams.get("mode") ?? "keywords";
  if (!["keywords", "meaning"].includes(mode)) return json({error:"invalid_search_mode"},400);
  const before = req.nextUrl.searchParams.get("before");
  const beforeId = req.nextUrl.searchParams.get("beforeId");
  if (Boolean(before) !== Boolean(beforeId) || (before && !Number.isFinite(Date.parse(before))) || (beforeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId))) return json({ error: "invalid_cursor" }, 400);
  const db = await createClient();
  if (mode === "meaning") {
    if (before || beforeId) return json({error:"invalid_cursor"},400);
    try {
      const admin = createChatAdminClient();
      if (!admin) return json({error:"search_unavailable"},503);
      const budget = await admin.rpc("take_longboard_chat_search_budget",{p_user:auth.user.id});
      if (budget.error) return json({error:"search_unavailable"},503);
      if (budget.data !== true) return json({error:"search_rate_limited"},429);
      const {vectors,tokens} = await embedChatText([q]);
      console.info("[chat-search-embedding]",{tokens,model:"text-embedding-3-small"});
      const {data,error} = await db.rpc("search_longboard_chat_semantic",{p_query:q,p_embedding:JSON.stringify(vectors[0]),p_room:room});
      if (error) return json({error:"search_unavailable"},503);
      return json({messages:data ?? [],hasMore:false});
    } catch { return json({error:"search_unavailable"},503); }
  }
  const { data, error } = await db.rpc("search_longboard_chat", { p_query: q, p_room: room, p_before: before, p_before_id: beforeId });
  if (error) return json({ error: "search_unavailable" }, 503);
  return json({ messages: (data ?? []).slice(0,20), hasMore: (data?.length ?? 0) > 20 });
}
