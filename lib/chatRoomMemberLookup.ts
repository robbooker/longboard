import type { SupabaseClient } from "@supabase/supabase-js";

// HEALTH-2026-10-17-1: the exact count checks every member's room eligibility (about 0.5-1.2 s).
// Nothing in the current app asks for it, but windows opened before #369 still poll it, so each
// account's answer is kept for a minute (per server instance) and concurrent asks share one call.
const COUNT_TTL_MS = 60_000;
const counts = new Map<string, { at: number; total: Promise<number | { error: string }> }>();
export function memberCount(admin: SupabaseClient, userId: string, room: string) {
  const key = `${userId}:${room}`;
  const now = Date.now();
  const hit = counts.get(key);
  if (hit && now - hit.at < COUNT_TTL_MS) return hit.total;
  if (counts.size > 2000) for (const [k, v] of counts) if (now - v.at >= COUNT_TTL_MS) counts.delete(k);
  const total = (async () => {
    const { data, error } = await admin.rpc("longboard_chat_room_member_count", {
      p_user_id: userId,
      p_room: room,
    });
    if (error) return { error: String(error.message) };
    if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) return { error: "malformed" };
    return data;
  })();
  counts.set(key, { at: now, total });
  // Only good answers are kept; a denial or failure is asked again next time.
  void total.then(
    (value) => typeof value !== "number" && counts.get(key)?.total === total && counts.delete(key),
    () => counts.get(key)?.total === total && counts.delete(key),
  );
  return total;
}

/** The UUID just before `id` (as Postgres orders UUIDs), for a keyset read that starts at `id`. */
export function uuidBefore(id: string): string | null {
  const value = BigInt("0x" + id.replace(/-/g, ""));
  if (value === BigInt(0)) return null;
  const hex = (value - BigInt(1)).toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const missingFunction = (error: { code?: string; message?: string }) =>
  error.code === "PGRST202" ||
  error.code === "42883" ||
  /could not find the function/i.test(error.message ?? "");

/**
 * Names for a few members of a room (the typing indicator), checked like the member list but only
 * for these members. No badges, no ordering, no paging. Before the 20261017173000 migration, each
 * member is one keyset read of longboard_chat_room_members starting at that member.
 */
export async function memberNames(admin: SupabaseClient, userId: string, room: string, ids: string[]) {
  const { data, error } = await admin.rpc("longboard_chat_room_member_names", {
    p_user_id: userId,
    p_room: room,
    p_ids: ids,
  });
  if (!error) return { rows: (data ?? []) as Array<{ id: string; display_name: string }> };
  if (!missingFunction(error)) return { error: String(error.message) };
  const rows: Array<{ id: string; display_name: string }> = [];
  for (const id of ids) {
    const listed = await admin.rpc("longboard_chat_room_members", {
      p_user_id: userId,
      p_room: room,
      p_cursor: uuidBefore(id),
      p_query: "",
    });
    if (listed.error) return { error: String(listed.error.message) };
    const first = ((listed.data ?? []) as Array<{ id: string; display_name: string }>)[0];
    if (first && first.id.toLowerCase() === id) rows.push({ id: first.id, display_name: first.display_name });
  }
  return { rows };
}

/** Tests only: forget kept counts. */
export function resetMemberCounts() {
  counts.clear();
}
