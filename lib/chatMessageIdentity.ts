import type { PublicChatMessage } from "./publicChat";

// Compare every supplied field, including future fields, rather than maintaining a
// list that could accidentally hide a newly introduced server update.
export function sameChatMessage(a: PublicChatMessage, b: PublicChatMessage): boolean {
  const keys = Object.keys(a) as (keyof PublicChatMessage)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key],
      right = b[key];
    if (Array.isArray(left) && Array.isArray(right))
      return left.length === right.length && left.every((value, index) => value === right[index]);
    return left === right;
  });
}

/** The client ids of saved (not pending) messages. */
export function confirmedClientIds(messages: PublicChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) if (!message.pending && message.client_id) ids.add(message.client_id);
  return ids;
}

/** A pending send whose saved copy carries its client id. */
export function isConfirmedSend(message: PublicChatMessage, confirmed: Set<string>): boolean {
  return !!message.pending && !!message.send_client_id && confirmed.has(message.send_client_id);
}

/** Keep authoritative ordering/deletions and pending sends; reuse unchanged rows. */
export function reconcileRoomMessages(
  current: PublicChatMessage[],
  snapshot: PublicChatMessage[],
): PublicChatMessage[] {
  const existing = new Map(current.map((message) => [message.id, message]));
  const ids = new Set(snapshot.map((message) => message.id));
  const next = snapshot.map((message) => {
    const previous = existing.get(message.id);
    return previous &&
      ((previous.revision ?? 0) > (message.revision ?? 0) || sameChatMessage(previous, message))
      ? previous
      : message;
  });
  // #488: a send whose saved copy is already here (a re-read landed before the send's own
  // answer) is that copy, not a second message: the pending row goes, or it showed twice.
  const confirmed = confirmedClientIds(snapshot);
  for (const message of current)
    if ((message.pending || message.removed) && !ids.has(message.id) && !isConfirmedSend(message, confirmed))
      next.push(message);
  return next.length === current.length && next.every((message, index) => message === current[index])
    ? current
    : next;
}
