import type { PublicChatMessage } from "./publicChat";

/**
 * #301: replies stop at one level. A reply that answered another reply keeps that message in
 * answered_id; the thread read adds who wrote it (`answered`) so the reply can say
 * "replying to <name>". `deleted` when that message was deleted or is gone.
 */
export type ChatAnswered =
  | { id: string; deleted: true }
  | { id: string; deleted?: false; author_label: string; member_id: string | null; bot_slug: string | null };

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
