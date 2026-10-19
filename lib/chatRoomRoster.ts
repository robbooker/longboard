import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * HEALTH-2026-10-19-1: the Member List without the whole-room scan on every request.
 *
 * longboard_chat_room_members_ordered checks every member's room eligibility on every call (about
 * 0.5 s for social and 1.4 s for shortscout on an idle database, 383 members), and the open list
 * asks again on each presence change and refresh. The eligibility answer is the same for every
 * viewer of a room, so it is worked out here once per room per minute (per server instance, with
 * concurrent asks sharing one computation), in parallel chunks through the cheap
 * longboard_chat_room_member_names function. Everything viewer-specific stays fresh on every request:
 *
 *  - room access and "has a chat member" are checked in the database by a names call made as the
 *    viewer (every request makes at least one, possibly with no ids);
 *  - the viewer's blocks (either direction) are read and removed;
 *  - chat names are read fresh, so renames show at once;
 *  - members the cached answer could not speak for (joined since, or hidden from the member who
 *    happened to fill the cache by a block) are checked as this viewer in that same names call.
 *
 * Ordering, search and the keyset match the SQL function: online first, then lower(name) in
 * code-point order (collate "C"), then id; at most 51 rows so the route can tell if there is more.
 * Returns null whenever this path cannot answer (for example before the names function exists, or
 * a read fails); the route then uses the database function as before.
 */

export type RosterRow = { id: string; display_name: string; sort_rank: number; sort_name: string };
type After = { rank: number; name: string; id: string } | null;
type Roster = { checked: Set<string>; eligible: Set<string>; unknown: Set<string> };

export const ROSTER_TTL_MS = 60_000;
const CHUNK = 50;
const MAX_MEMBERS = 20_000;
const PAGE = 1000;
const AUTH_ERRORS = new Set(["member_required", "room_access_required"]);
const rosters = new Map<string, { at: number; roster: Promise<Roster | { error: string }> }>();

class AuthError extends Error {}

/** Code-point order, which is the byte order of UTF-8 text (Postgres collate "C"). */
function compareC(a: string, b: string) {
  const x = [...a],
    y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}
const compareKey = (a: [number, string, string], b: [number, string, string]) =>
  a[0] - b[0] || compareC(a[1], b[1]) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);

async function namesAs(admin: SupabaseClient, userId: string, room: string, ids: string[]) {
  const { data, error } = await admin.rpc("longboard_chat_room_member_names", {
    p_user_id: userId,
    p_room: room,
    p_ids: ids,
  });
  if (error) {
    const message = String(error.message ?? "");
    if (AUTH_ERRORS.has(message)) throw new AuthError(message);
    throw new Error("names_failed");
  }
  if (!Array.isArray(data)) throw new Error("names_malformed");
  return (data as Array<{ id: unknown }>).map((row) => String(row.id).toLowerCase());
}

/** Members among `ids` this viewer may see listed, checked in parallel chunks of 50. */
async function eligibleAs(admin: SupabaseClient, userId: string, room: string, ids: string[]) {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  if (!chunks.length) chunks.push([]);
  const out = new Set<string>();
  // At most four at once, so a cold cache costs a few short statements, not a burst.
  for (let i = 0; i < chunks.length; i += 4)
    for (const rows of await Promise.all(chunks.slice(i, i + 4).map((c) => namesAs(admin, userId, room, c))))
      for (const id of rows) out.add(id);
  return out;
}

function roomRoster(
  admin: SupabaseClient,
  userId: string,
  room: string,
  ids: string[],
  blocked: Set<string>,
): Promise<Roster | { error: string }> {
  const now = Date.now();
  const hit = rosters.get(room);
  if (hit && now - hit.at < ROSTER_TTL_MS) return hit.roster;
  const roster = (async () => {
    try {
      const eligible = await eligibleAs(admin, userId, room, ids);
      // This viewer's blocks hid those members from the answer; others must ask for them.
      return { checked: new Set(ids), eligible, unknown: new Set(blocked) };
    } catch (failure) {
      return { error: failure instanceof AuthError ? failure.message : "roster_failed" };
    }
  })();
  rosters.set(room, { at: now, roster });
  // Only a good answer is kept; a denial or failure is worked out again next time.
  void roster.then(
    (value) => "error" in value && rosters.get(room)?.roster === roster && rosters.delete(room),
  );
  return roster;
}

export async function orderedRoomMembers(
  admin: SupabaseClient,
  userId: string,
  room: string,
  query: string,
  onlineIds: string[],
  after: After,
): Promise<{ rows: RosterRow[] } | { error: string } | null> {
  try {
    // Read in pages of 1,000 (the API's row cap would otherwise cut a longer read short silently).
    const everyone: Array<{ id: string; user_id: string; display_name: string | null }> = [];
    for (;;) {
      const page = await admin
        .from("longboard_chat_members")
        .select("id,user_id,display_name")
        .order("id")
        .range(everyone.length, everyone.length + PAGE - 1);
      if (page.error || !Array.isArray(page.data)) return null;
      everyone.push(...page.data);
      if (page.data.length < PAGE) break;
      if (everyone.length >= MAX_MEMBERS) return null;
    }
    const actor = everyone.find((m) => m.user_id === userId)?.id?.toLowerCase();
    // A member without a name is never listed (strpos on a null name is null in the SQL function).
    const all = everyone
      .filter((m) => typeof m.display_name === "string")
      .map((m) => ({ id: String(m.id).toLowerCase(), display_name: m.display_name as string }));
    const blocked = new Set<string>();
    if (actor) {
      const blocks = await admin
        .from("longboard_chat_blocks")
        .select("blocker_id,blocked_id")
        .or(`blocker_id.eq.${actor},blocked_id.eq.${actor}`)
        .limit(5000);
      if (blocks.error || !Array.isArray(blocks.data) || blocks.data.length >= 5000) return null;
      for (const row of blocks.data as Array<{ blocker_id: string; blocked_id: string }>)
        blocked.add(String(row.blocker_id === actor ? row.blocked_id : row.blocker_id).toLowerCase());
    }
    const ids = all.map((m) => m.id);
    const roster = await roomRoster(admin, userId, room, ids, blocked);
    if ("error" in roster) return AUTH_ERRORS.has(roster.error) ? roster : null;
    // Fresh, as this viewer: room access, chat member, and anyone the cached answer cannot speak for.
    const extra = ids.filter((id) => !blocked.has(id) && (!roster.checked.has(id) || roster.unknown.has(id)));
    const extraEligible = await eligibleAs(admin, userId, room, extra);
    const online = new Set(onlineIds);
    const needle = query.toLowerCase();
    const rows = all
      .filter(
        (m) =>
          !blocked.has(m.id) &&
          (extraEligible.has(m.id) || (roster.eligible.has(m.id) && !roster.unknown.has(m.id))) &&
          m.display_name.toLowerCase().includes(needle),
      )
      .map((m) => ({
        id: m.id,
        display_name: m.display_name,
        sort_rank: online.has(m.id) ? 0 : 1,
        sort_name: m.display_name.toLowerCase(),
      }))
      .filter(
        (row) =>
          !after ||
          compareKey(
            [row.sort_rank, row.sort_name, row.id],
            [after.rank, after.name, after.id.toLowerCase()],
          ) > 0,
      )
      .sort((a, b) => compareKey([a.sort_rank, a.sort_name, a.id], [b.sort_rank, b.sort_name, b.id]))
      .slice(0, 51);
    return { rows };
  } catch (failure) {
    return failure instanceof AuthError ? { error: failure.message } : null;
  }
}

/** Tests only: forget kept rosters. */
export function resetRoomRosters() {
  rosters.clear();
}
