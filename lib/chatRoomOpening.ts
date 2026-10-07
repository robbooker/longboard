import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatRoom } from "@/lib/publicChat";

export type RoomOpening = {
  messageId: string | null;
  unreadMessageId: string | null;
  parentId: string | null;
  readThrough: number;
  latestThrough: number;
};
export type ThreadOpening = { messageId: string | null; readThrough: number; latestThrough: number };
export type RoomOpeningResult<T> = { ok: true; body: T } | { ok: false; status: 404 | 503; error: string };

/**
 * Where a member should land in a room (or one thread): the oldest incoming unread,
 * mapped to its visible root. Callers must already have authorized the room and
 * resolved the member from the authenticated account.
 */
export async function readRoomOpening(
  db: SupabaseClient,
  accountId: string,
  memberId: string,
  room: ChatRoom,
): Promise<RoomOpeningResult<RoomOpening>>;
export async function readRoomOpening(
  db: SupabaseClient,
  accountId: string,
  memberId: string,
  room: ChatRoom,
  thread: string,
): Promise<RoomOpeningResult<ThreadOpening>>;
export async function readRoomOpening(
  db: SupabaseClient,
  accountId: string,
  memberId: string,
  room: ChatRoom,
  thread?: string,
): Promise<RoomOpeningResult<RoomOpening | ThreadOpening>> {
  const read = await db
    .from("chat_room_reads")
    .select("through_seq")
    .eq("account_id", accountId)
    .eq("room_slug", room)
    .maybeSingle();
  if (read.error) throw read.error;
  const eligible = () =>
    db
      .from("longboard_chat_messages")
      .select("id,reply_to_id,unread_seq")
      .eq("room_slug", room)
      .eq("removed", false)
      .is("deleted_at", null)
      .or(`member_id.is.null,member_id.neq.${memberId}`)
      .gt("unread_seq", read.data?.through_seq ?? 0);
  // Both bounds depend only on the read marker, so they load together.
  const [oldest, latest] = await Promise.all([
    eligible().order("unread_seq", { ascending: true }).limit(80),
    eligible().order("unread_seq", { ascending: false }).limit(1),
  ]);
  if (oldest.error || latest.error) throw oldest.error || latest.error;
  const latestThrough: number = latest.data?.[0]?.unread_seq ?? 0;
  if (thread) {
    const parent = await db
      .from("longboard_chat_messages")
      .select("id")
      .eq("room_slug", room)
      .eq("removed", false)
      .eq("id", thread)
      .maybeSingle();
    if (parent.error) throw parent.error;
    if (!parent.data) return { ok: false, status: 404, error: "thread_not_found" };
    const children = await eligible()
      .eq("reply_to_id", thread)
      .order("unread_seq", { ascending: true })
      .limit(1);
    if (children.error) throw children.error;
    const first = children.data?.[0];
    return {
      ok: true,
      body: {
        messageId: first?.id ?? null,
        readThrough: first?.id === oldest.data?.[0]?.id ? (first?.unread_seq ?? 0) : 0,
        latestThrough,
      },
    };
  }
  // A removed ancestor can leave a hidden branch. Search a bounded candidate
  // page and cache ancestry; never silently open latest when valid unread may remain.
  type Ancestor = { id: string; reply_to_id: string | null };
  const parents = new Map<string, Ancestor | null>();
  let lookups = 0;
  for (const candidate of oldest.data ?? []) {
    let message: Ancestor | null = candidate;
    const seen = new Set<string>();
    while (message?.reply_to_id) {
      if (seen.has(message.id)) {
        message = null;
        break;
      }
      seen.add(message.id);
      const parentId: string = message.reply_to_id;
      if (!parents.has(parentId)) {
        if (++lookups > 20) return { ok: false, status: 503, error: "opening_unavailable" };
        const parent: { data: Ancestor | null; error: unknown } = await db
          .from("longboard_chat_messages")
          .select("id,reply_to_id")
          .eq("room_slug", room)
          .eq("removed", false)
          .eq("id", parentId)
          .maybeSingle();
        if (parent.error) throw parent.error;
        parents.set(parentId, parent.data);
      }
      message = parents.get(parentId) ?? null;
    }
    if (message)
      return {
        ok: true,
        body: {
          messageId: message.id,
          unreadMessageId: candidate.id,
          parentId: candidate.reply_to_id,
          readThrough: candidate.unread_seq ?? 0,
          latestThrough,
        },
      };
  }
  if (oldest.data?.length) return { ok: false, status: 503, error: "opening_unavailable" };
  return {
    ok: true,
    body: { messageId: null, unreadMessageId: null, parentId: null, readThrough: 0, latestThrough: 0 },
  };
}
