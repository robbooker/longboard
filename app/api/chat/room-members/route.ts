import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { CHAT_UUID } from "@/lib/chatMembers";
import { parseChatRoom } from "@/lib/publicChat";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const params = req.nextUrl.searchParams;
  const room = parseChatRoom(params.get("room"));
  const cursor = params.get("cursor");
  const summary = params.get("summary");
  const raw = params.get("q") ?? "";
  const query = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!params.has("room") || !room || ["room", "cursor", "q", "summary"].some(key => params.getAll(key).length > 1) ||
      (summary !== null && summary !== "1") || (cursor !== null && !CHAT_UUID.test(cursor)) || raw.length > 112 || query.length > 28 || !/^[\p{L}\p{N} _.'-]*$/u.test(query)) {
    return json({ error: "Invalid member list query." }, 400);
  }
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_access_required" }, 403);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "Member list is unavailable. Please try again." }, 503);
  try {
    const { data, error } = summary === "1"
      ? await admin.rpc("longboard_chat_room_member_count", { p_user_id: auth.user.id, p_room: room })
      : await admin.rpc("longboard_chat_room_members", {
        p_user_id: auth.user.id, p_room: room, p_cursor: cursor, p_query: query,
      });
    if (error) return json({ error: error.message === "member_required" ? "Choose your chat name to view members." : error.message === "room_access_required" ? "room_access_required" : "Member list is unavailable. Please try again." }, ["member_required", "room_access_required"].includes(error.message) ? 403 : 503);
    if (summary === "1") {
      if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) return json({ error: "Member list is unavailable. Please try again." }, 503);
      return json({ total: data });
    }
    const rows = (data ?? []) as Array<{ id: string; display_name: string }>;
    // Explicit projection: never expose account IDs, provider metadata or email.
    const members = rows.slice(0, 50).map(member => ({ id: member.id, display_name: member.display_name }));
    return json({ members, nextCursor: rows.length > 50 ? members.at(-1)!.id : null });
  } catch { return json({ error: "Member list is unavailable. Please try again." }, 503); }
}

// POST keeps bounded presence snapshots out of URLs. This is a read-only operation;
// hints only order rows already authorized by the service-only directory RPC.
export async function POST(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let input: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 220000) return json({ error: 'Member list request is too large.' }, 400);
    input = JSON.parse(raw);
  } catch { return json({ error: 'Invalid member list query.' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid member list query.' }, 400);
  const body = input as Record<string, unknown>;
  const room = typeof body.room === 'string' ? parseChatRoom(body.room) : null;
  const rawQuery = body.q ?? '';
  const hints = body.onlineIds ?? [];
  if (!room || typeof rawQuery !== 'string' || rawQuery.length > 112 || !Array.isArray(hints) || hints.length > 5000 ||
      hints.some(id => typeof id !== 'string' || !CHAT_UUID.test(id))) return json({ error: 'Invalid member list query.' }, 400);
  const query = rawQuery.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (query.length > 28 || !/^[\p{L}\p{N} _.'-]*$/u.test(query)) return json({ error: 'Invalid member list query.' }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: 'room_access_required' }, 403);
  const onlineIds = [...new Set((hints as string[]).map(id => id.toLowerCase()))].sort();
  const scope = createHash('sha256').update(JSON.stringify([auth.user.id, room, query, onlineIds])).digest('hex');
  let after: { rank: number; name: string; id: string } | null = null;
  if (body.cursor !== null && body.cursor !== undefined) {
    try {
      if (typeof body.cursor !== 'string' || body.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(body.cursor)) throw new Error();
      const decoded = JSON.parse(Buffer.from(body.cursor, 'base64url').toString('utf8'));
      if (decoded.v !== 1 || decoded.scope !== scope || ![0, 1].includes(decoded.rank) ||
          typeof decoded.name !== 'string' || decoded.name.length > 256 || typeof decoded.id !== 'string' || !CHAT_UUID.test(decoded.id)) throw new Error();
      after = decoded;
    } catch { return json({ error: 'Member list changed. Please start from the first page.' }, 400); }
  }
  const admin = createChatAdminClient();
  if (!admin) return json({ error: 'Member list is unavailable. Please try again.' }, 503);
  try {
    const { data, error } = await admin.rpc('longboard_chat_room_members_ordered', {
      p_user_id: auth.user.id, p_room: room, p_query: query, p_online_ids: onlineIds,
      p_after_rank: after?.rank ?? null, p_after_name: after?.name ?? null, p_after_id: after?.id ?? null,
    });
    if (error) return json({ error: error.message === 'member_required' ? 'Choose your chat name to view members.' : error.message === 'room_access_required' ? 'room_access_required' : 'Member list is unavailable. Please try again.' }, ['member_required', 'room_access_required'].includes(error.message) ? 403 : 503);
    const rows = (data ?? []) as Array<{ id: string; display_name: string; sort_rank: number; sort_name: string }>;
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    const nextCursor = rows.length > 50 && last ? Buffer.from(JSON.stringify({ v: 1, scope, rank: last.sort_rank, name: last.sort_name, id: last.id })).toString('base64url') : null;
    return json({ members: page.map(({ id, display_name }) => ({ id, display_name })), nextCursor });
  } catch { return json({ error: 'Member list is unavailable. Please try again.' }, 503); }
}
