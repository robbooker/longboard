import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { CHAT_UUID, findChatMember, withAvatarColumn } from "@/lib/chatMembers";
import { allowedChatRooms } from "@/lib/chatAccess";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type MemberRow = { id: string; display_name: string; avatar_path?: string | null };
/** #410: no picture means no field. */
const publicMember = ({ id, display_name, avatar_path }: MemberRow) =>
  typeof avatar_path === "string" ? { id, display_name, avatar_path } : { id, display_name };
/** #439: the database functions are not there yet (the code went live before its migration). */
const functionMissing = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST202" || error.code === "42883" || /chat_tag_/.test(error.message ?? ""));
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
    // #439: one row per member, current names first, then members found by an earlier name
    // (shown under their current name). Falls back to current names only before the migration.
    const suggested = await admin.rpc("chat_tag_suggestions", {
      p_query: query,
      p_hidden: hidden,
      p_limit: 10,
    });
    if (!suggested.error)
      return json({
        members: ((suggested.data ?? []) as Array<MemberRow & { previous_name?: string | null }>).map(
          (row) => ({
            ...publicMember(row),
            ...(typeof row.previous_name === "string" ? { previous_name: row.previous_name } : {}),
          }),
        ),
      });
    if (!functionMissing(suggested.error)) return json({ error: "unavailable" }, 503);
    // #410: suggestions show pictures, read with the names (no extra query).
    const { data, error } = await withAvatarColumn((avatar) => {
      let members = admin
        .from("longboard_chat_members")
        .select(avatar ? "id, display_name, avatar_path" : "id, display_name")
        .ilike("display_name", `${query.replace(/_/g, "\\_")}%`);
      if (hidden.length) members = members.not("user_id", "in", `(${hidden.join(",")})`);
      return members.order("display_name").limit(10);
    });
    if (error) return json({ error: "unavailable" }, 503);
    return json({
      members: (
        (data ?? []) as unknown as Array<{ id: string; display_name: string; avatar_path?: string | null }>
      ).map(({ avatar_path, ...member }) =>
        typeof avatar_path === "string" ? { ...member, avatar_path } : member,
      ),
    });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
// #317: which tags in shown messages name a real member, so they can be drawn as links.
// Body: { names: string[], messages?: string[] } (lower-cased candidates from mentionCandidates, and
// the ids of the room messages shown). Answers with the members whose display name equals one of
// the names, ignoring case; any other name is simply not returned.
// #439: and `tags`: for each listed message, the member each stored tag points to (with their
// current name), so a tag typed under an earlier name still finds the person.
const NAME = /^[\p{L}\p{N} _.'‘’-]{2,28}$/u;
export async function POST(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const body = await req.json().catch(() => null);
  const raw: unknown = body?.names;
  if (!Array.isArray(raw) || raw.length > 60) return json({ error: "invalid_names" }, 400);
  const rawMessages: unknown = body?.messages ?? [];
  if (!Array.isArray(rawMessages) || rawMessages.length > 60) return json({ error: "invalid_messages" }, 400);
  const messages = [
    ...new Set(rawMessages.filter((id): id is string => typeof id === "string" && CHAT_UUID.test(id))),
  ];
  const names = [
    ...new Set(
      raw
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.normalize("NFKC").toLowerCase())
        .filter((name) => NAME.test(name) && !/^\s|\s$/.test(name)),
    ),
  ];
  if (!names.length && !messages.length) return json({ members: [] });
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  try {
    if (!(await findChatMember(admin, auth.user.id))) return json({ error: "member_required" }, 403);
    // #439: stored tags and current names in one read. Messages count only in rooms this reader
    // may open (the rooms their access lists, checked again by the database).
    const looked = await admin.rpc("chat_tag_lookup", {
      p_actor: auth.user.id,
      p_rooms: allowedChatRooms(auth.access),
      p_names: names,
      p_messages: messages,
    });
    if (!looked.error) {
      const members: ReturnType<typeof publicMember>[] = [];
      const tags: Array<{ message_id: string; key: string; member: ReturnType<typeof publicMember> }> = [];
      for (const row of (looked.data ?? []) as Array<
        MemberRow & { message_id: string | null; tag_key: string; member_id: string }
      >) {
        const member = publicMember({ ...row, id: row.member_id });
        if (row.message_id) tags.push({ message_id: row.message_id, key: row.tag_key, member });
        else if (names.includes(row.display_name.normalize("NFKC").toLowerCase())) members.push(member);
      }
      return json({ members, tags });
    }
    if (!functionMissing(looked.error)) return json({ error: "unavailable" }, 503);
    if (!names.length) return json({ members: [] });
    // Quoted values keep spaces, dots and apostrophes literal; "_" may still act as a one-letter
    // wildcard, so every row is checked for an exact (case-blind) match below.
    // #414: a tag opens the larger view of that member, so their picture name is read with them.
    const { data, error } = await withAvatarColumn((avatar) =>
      admin
        .from("longboard_chat_members")
        .select(avatar ? "id, display_name, avatar_path" : "id, display_name")
        .or(names.map((name) => `display_name.ilike."${name}"`).join(","))
        .limit(names.length * 4),
    );
    if (error) return json({ error: "unavailable" }, 503);
    const wanted = new Set(names);
    const members = (
      (data ?? []) as unknown as Array<{ id: string; display_name: string; avatar_path?: string | null }>
    )
      .filter((row) => wanted.has(row.display_name.normalize("NFKC").toLowerCase()))
      .map(({ avatar_path, ...member }) =>
        typeof avatar_path === "string" ? { ...member, avatar_path } : member,
      );
    return json({ members });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
