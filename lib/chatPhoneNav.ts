// UI-PHONE-NAV: on a phone the room and DM list is the home screen and a conversation sits on top
// of it, like Messages or Slack. Tablets and computers keep the sidebar layout.

/** A phone: the narrow layout on a touch screen (a narrow desktop window keeps the sidebar). */
export const CHAT_PHONE_QUERY = "(max-width: 40rem) and (pointer: coarse)";

/** Which screen a history entry shows on a phone. */
export type ChatPhoneScreen = "list" | "conversation";

const KEY = "chatPhone";

/** A link that names a room, DM, thread or message opens that conversation; plain /chat opens the list. */
export function chatPhoneDeepLink(href: string): boolean {
  try {
    const url = new URL(href, "http://localhost");
    return (
      ["room", "dm", "thread"].some((key) => url.searchParams.has(key)) ||
      url.hash.startsWith("#chat-message-")
    );
  } catch {
    return false;
  }
}

export function chatPhoneScreen(state: unknown): ChatPhoneScreen | null {
  const value = state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : null;
  return value === "list" || value === "conversation" ? value : null;
}

/** The history state with the phone screen set, keeping Next's and the reply panel's own fields. */
export function withChatPhoneScreen(state: unknown, screen: ChatPhoneScreen): Record<string, unknown> {
  return { ...(state && typeof state === "object" ? (state as Record<string, unknown>) : {}), [KEY]: screen };
}
