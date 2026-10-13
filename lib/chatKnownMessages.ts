/**
 * P8: the history query part that names the room messages a page already holds, so the reader can
 * return deletion evidence for them. A range of room positions replaces up to 200 message IDs;
 * IDs remain the fallback when a row has no position.
 */
export function knownMessagesParam(
  messages: ReadonlyArray<{ id: string; pending?: boolean; unread_seq?: number | null }>,
): string {
  const known = messages.filter((message) => !message.pending).slice(-200);
  if (!known.length) return "ids=";
  let from = Infinity,
    to = -Infinity;
  for (const { unread_seq: seq } of known) {
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0)
      return `ids=${known.map((message) => message.id).join(",")}`;
    from = Math.min(from, seq);
    to = Math.max(to, seq);
  }
  return `known=${from}-${to}`;
}
