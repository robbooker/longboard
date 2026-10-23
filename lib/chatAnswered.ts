import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicChatMessage } from "./publicChat";
import { withCurrentChatNames } from "./chatNameProjection";
import { CHAT_UUID } from "./chatMembers";

/**
 * #301: replies stop at one level. A reply that answered another reply keeps that message in
 * answered_id; the thread read adds who wrote it (`answered`) so the reply can say
 * "replying to <name>". `deleted` when that message was deleted or is gone.
 */
export type ChatAnswered =
  | { id: string; deleted: true }
  | { id: string; deleted?: false; author_label: string; member_id: string | null; bot_slug: string | null };

type AnsweredRow = {
  id: string;
  member_id: string | null;
  bot_slug: string | null;
  author_label: string;
  deleted_at: string | null;
  removed: boolean;
};

/**
 * Server only, after the caller authorized `room` and these replies. Reads answered_id on its own
 * so a deploy that runs before migration 20261023120000 still serves threads (just no labels).
 */
export async function withAnsweredMessages<T extends { id: string }>(
  db: SupabaseClient,
  room: string,
  replies: T[],
): Promise<Array<T & { answered_id?: string | null; answered?: ChatAnswered }>> {
  const ids = replies.map((reply) => reply.id).filter((id) => CHAT_UUID.test(id));
  if (!ids.length) return replies;
  try {
    const links = await db.from("longboard_chat_messages").select("id,answered_id").eq("room_slug", room).in("id", ids);
    if (links.error) return replies;
    const answeredOf = new Map<string, string>();
    for (const row of (links.data ?? []) as Array<{ id: string; answered_id: string | null }>)
      if (row.answered_id && CHAT_UUID.test(row.answered_id)) answeredOf.set(row.id, row.answered_id);
    if (!answeredOf.size) return replies;
    const targets = [...new Set(answeredOf.values())];
    const found = await db
      .from("longboard_chat_messages")
      .select("id,member_id,bot_slug,author_label,deleted_at,removed")
      .eq("room_slug", room)
      .in("id", targets);
    if (found.error) return replies;
    const named = await withCurrentChatNames(db, (found.data ?? []) as AnsweredRow[]);
    const byId = new Map(named.map((row) => [row.id, row]));
    return replies.map((reply) => {
      const target = answeredOf.get(reply.id);
      if (!target) return reply;
      const row = byId.get(target);
      const answered: ChatAnswered =
        !row || row.deleted_at || row.removed
          ? { id: target, deleted: true }
          : { id: target, author_label: row.author_label, member_id: row.member_id, bot_slug: row.bot_slug };
      return { ...reply, answered_id: target, answered };
    });
  } catch {
    /* Labels are a nicety; a failed lookup never blocks an authorized thread. */
    return replies;
  }
}

/**
 * Client: who a reply was answering, preferring the copy on screen (current edits/deletes),
 * then what the read brought. Null for a direct reply, or until the answered message is known.
 */
export function answeredTarget(
  reply: Pick<PublicChatMessage, "answered_id" | "answered">,
  shown: PublicChatMessage[],
): { deleted: true } | { deleted: false; message: Pick<PublicChatMessage, "member_id" | "bot_slug" | "author_label"> } | null {
  const id = reply.answered_id ?? reply.answered?.id;
  if (!id) return null;
  const local = shown.find((message) => message.id === id && !message.pending);
  if (local)
    return local.deleted_at || local.removed ? { deleted: true } : { deleted: false, message: local };
  const answered = reply.answered;
  if (!answered || answered.id !== id) return null;
  return answered.deleted ? { deleted: true } : { deleted: false, message: answered };
}
