/**
 * #453: the "Unread DMs" button at the top of the chat.
 *
 * The count is the sidebar's own Direct messages total (DirectInbox's `badge`: unread messages
 * plus new message requests, across every conversation that is still available), published here
 * by the sidebar's inbox. The button reads it from this small store, so only the button redraws
 * when the number changes, and the two always agree. No poll and no extra request of its own.
 */

/** The button's text: "1 unread DM", "3 unread DMs"; null when there is nothing unread. */
export function unreadDmsLabel(count: number): string | null {
  const n = unreadDmsCount(count);
  if (n === 0) return null;
  return `${n} unread DM${n === 1 ? "" : "s"}`;
}

/** Whether the button shows: only with at least one unread DM. */
export function showUnreadDmsButton(count: number): boolean {
  return unreadDmsCount(count) > 0;
}

/** The short number for the compact (phone) button: "3", and "99+" past 99. */
export function unreadDmsShort(count: number): string {
  const n = unreadDmsCount(count);
  return n > 99 ? "99+" : String(n);
}

function unreadDmsCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** Fired by the button; the sidebar's inbox opens (unfolds) its DM list and scrolls it into view. */
export const CHAT_SHOW_DMS_EVENT = "chat-show-dms";

let current = 0;
const listeners = new Set<() => void>();

/** The sidebar's inbox calls this whenever its Direct messages total changes. */
export function publishUnreadDms(count: number) {
  const next = unreadDmsCount(count);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeUnreadDms(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readUnreadDms() {
  return current;
}
