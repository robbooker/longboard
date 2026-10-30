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

// D-327: unread notifications sit above read ones; each group keeps the chronological order above.
const NOTHING_HELD: ReadonlySet<string> = new Set();

export function isUnreadNotification(item: ChatNotificationItem): boolean {
  return item.kind === "dm" ? item.value.unread > 0 : item.value.read !== true;
}

/**
 * The keys to keep in the unread group while the list stays open: everything held so far plus
 * whatever is unread now. Returns the same set when nothing new is unread, so callers can compare.
 * A row read while the list is open stays held (no jumping); leaving the list starts a new hold.
 */
export function holdUnreadNotifications(
  items: readonly ChatNotificationItem[],
  held: ReadonlySet<string> = NOTHING_HELD,
): ReadonlySet<string> {
  const fresh = items.filter((item) => isUnreadNotification(item) && !held.has(item.key));
  return fresh.length ? new Set([...held, ...fresh.map((item) => item.key)]) : held;
}

/** Unread (or held) rows first, then read rows; a stable split, so both keep their given order. */
export function unreadFirstNotifications(
  items: readonly ChatNotificationItem[],
  held: ReadonlySet<string> = NOTHING_HELD,
): ChatNotificationItem[] {
  const top = (item: ChatNotificationItem) => held.has(item.key) || isUnreadNotification(item);
  return [...items.filter(top), ...items.filter((item) => !top(item))];
}

export const noHeldNotifications = NOTHING_HELD;
