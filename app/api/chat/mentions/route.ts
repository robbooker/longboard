import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { findChatMember } from "@/lib/chatMembers";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const query = (req.nextUrl.searchParams.get("q") || "").normalize("NFKC");
  if (query.length > 28 || !/^[\p{L}\p{N} _.'‘’-]*$/u.test(query))
    return json({ error: "invalid_query" }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  try {
    if (!(await findChatMember(admin, auth.user.id))) return json({ error: "member_required" }, 403);
    // #330: a bot is suggested only in a room it's in (the composer says which room it's asking for).
    const room = req.nextUrl.searchParams.get("room");
    const bots = await admin.from("chat_bot_accounts").select("account_id, allowed_rooms");
    if (bots.error) return json({ error: "unavailable" }, 503);
    const hidden = ((bots.data ?? []) as Array<{ account_id: string; allowed_rooms: string[] }>)
      .filter((bot) => !room || !bot.allowed_rooms.includes(room))
      .map((bot) => bot.account_id);
    let members = admin
      .from("longboard_chat_members")
      .select("id, display_name")
      .ilike("display_name", `${query.replace(/_/g, "\\_")}%`);
    if (hidden.length) members = members.not("user_id", "in", `(${hidden.join(",")})`);
    const { data, error } = await members.order("display_name").limit(10);
    if (error) return json({ error: "unavailable" }, 503);
    return json({ members: data });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
// #317: which tags in shown messages name a real member, so they can be drawn as links.
// Body: { names: string[] } (lower-cased candidates from mentionCandidates). Answers with the members
// whose display name equals one of them, ignoring case; any other name is simply not returned.
const NAME = /^[\p{L}\p{N} _.'‘’-]{2,28}$/u;
export async function POST(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const body = await req.json().catch(() => null);
  const raw: unknown = body?.names;
  if (!Array.isArray(raw) || raw.length > 60) return json({ error: "invalid_names" }, 400);
  const names = [
    ...new Set(
      raw
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.normalize("NFKC").toLowerCase())
        .filter((name) => NAME.test(name) && !/^\s|\s$/.test(name)),
    ),
  ];
  if (!names.length) return json({ members: [] });
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  try {
    if (!(await findChatMember(admin, auth.user.id))) return json({ error: "member_required" }, 403);
    // Quoted values keep spaces, dots and apostrophes literal; "_" may still act as a one-letter
    // wildcard, so every row is checked for an exact (case-blind) match below.
    const { data, error } = await admin
      .from("longboard_chat_members")
      .select("id, display_name")
      .or(names.map((name) => `display_name.ilike."${name}"`).join(","))
      .limit(names.length * 4);
    if (error) return json({ error: "unavailable" }, 503);
    const wanted = new Set(names);
    const members = (data ?? []).filter((row: { display_name: string }) =>
      wanted.has(row.display_name.normalize("NFKC").toLowerCase()),
    );
    return json({ members });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
