/**
 * #331: one Reply and one reaction button for a run of messages from the same person. The buttons
 * sit by the name on the group's first message and act on the group's most recent message that
 * can still take them (not deleted, not still sending), so the target moves when a newer message
 * arrives or the newest is deleted. `targetId` is null when no message in the group qualifies.
 */
export type GroupActions = { inGroup: boolean; head: boolean; targetId: string | null };

export function chatGroupActions<T extends { id: string }>(
  messages: readonly T[],
  continued: readonly boolean[],
  canTarget: (message: T) => boolean,
): GroupActions[] {
  const result: GroupActions[] = [];
  for (let start = 0; start < messages.length; ) {
    let end = start + 1;
    while (end < messages.length && continued[end]) end++;
    let targetId: string | null = null;
    for (let at = end - 1; at >= start && targetId === null; at--)
      if (canTarget(messages[at])) targetId = messages[at].id;
    for (let at = start; at < end; at++)
      result.push({ inGroup: end - start > 1, head: at === start, targetId });
    start = end;
  }
  return result;
}
