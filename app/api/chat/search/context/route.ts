import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { allowedChatSearchRooms } from "@/lib/chatAccess";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: "invalid_message" }, 400);
  const db = createChatAdminClient();
  if(!db) return json({error:"context_unavailable"},503);
  const target=await db.from("longboard_chat_messages").select("room_slug").eq("id",id).in("room_slug",allowedChatSearchRooms(auth.access)).maybeSingle();
  if(target.error) return json({error:"context_unavailable"},503);
  if(!target.data) return json({messages:[]});
  const { data, error } = await db.rpc("longboard_chat_search_context", { p_message: id });
  if (error) return json({ error: "context_unavailable" }, 503);
  return json({ messages: data ?? [] });
}
