// #406 Apps: things in the chat that aren't conversations, listed in their own "Apps" section of the
// sidebar (computer and phone) and offered on Quad panes and Six cards. The Reader is the first.
//
// Adding an app:
//   1. add it to CHAT_APPS below (its sidebar row and its /chat?page=<page> link);
//   2. say who may use it in APP_ACCESS (lib/chatApps.server.ts), the only place that decides it;
//   3. draw it in the chat (PublicChat, by its page id) and on a pane (APP_COMPONENTS in
//      components/chat/cards/cardComponents.tsx; TypeScript fails until it has one).
// Nothing here touches the database or the browser, so it is safe on both sides.

export const CHAT_APPS = [
  {
    id: "reader",
    label: "Reader",
    /** The square mark's letters in the sidebar. */
    initials: "RD",
    /** One line under the name in the Six card picker. */
    description: "Books from Rob: read in this card, your place is saved",
  },
] as const;

export type ChatApp = (typeof CHAT_APPS)[number];
export type ChatAppId = ChatApp["id"];

export function isChatAppId(value: unknown): value is ChatAppId {
  return typeof value === "string" && CHAT_APPS.some((app) => app.id === value);
}

/** The apps in `ids`, in sidebar order; unknown ids are dropped. */
export function chatAppsIn(ids: readonly string[] | null | undefined): ChatApp[] {
  return CHAT_APPS.filter((app) => !!ids?.includes(app.id));
}
