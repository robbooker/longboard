import type { ChatActivity } from "./chatActivity";

export type ChatNotificationItem =
  | { kind: "mention"; key: string; value: ChatActivity["mentions"][number] }
  | { kind: "dm"; key: string; value: ChatActivity["dms"][number] }
  | { kind: "reaction"; key: string; value: NonNullable<ChatActivity["reactions"]>[number] };

function time(createdAt?: string) {
  const parsed = Date.parse(createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

/** Order only the supplied recent sample; full unread counts and read cursors stay untouched. */
export function orderedChatNotifications(data: ChatActivity): ChatNotificationItem[] {
  const items: ChatNotificationItem[] = [
    ...data.mentions.map((value) => ({ kind: "mention" as const, key: `mention:${value.id}`, value })),
    ...data.dms.map((value) => ({ kind: "dm" as const, key: `dm:${value.id}`, value })),
    ...(data.reactions ?? []).map((value) => ({
      kind: "reaction" as const,
      key: `reaction:${value.id}`,
      value,
    })),
  ];
  return items.sort((a, b) => {
    const left = time(a.value.createdAt),
      right = time(b.value.createdAt);
    if (left !== right) return left > right ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
