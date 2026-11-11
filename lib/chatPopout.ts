import type { ChatRoom } from "./publicChat";

/**
 * #438: what a pop-out window shows. A room, one DM, or a page (Gainers Table, News Feed, FAQ...).
 * Each gets its own window name, so popping out a second chat opens a second window instead of
 * replacing the first, and popping out the same chat again finds the window already open.
 */
export type ChatPopoutTarget =
  | { kind: "room"; room: ChatRoom }
  | { kind: "dm"; room: ChatRoom; conversationId: string }
  | { kind: "page"; room: ChatRoom; page: string };

function safe(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** The window name: one per room, per DM and per page. */
export function chatPopoutName(target: ChatPopoutTarget): string {
  if (target.kind === "dm") return `rb-chat-dm-${safe(target.conversationId)}`;
  if (target.kind === "page") return `rb-chat-page-${safe(target.page)}`;
  return `rb-chat-${target.room}`;
}

export function chatPopoutPath(target: ChatPopoutTarget): string {
  const params = new URLSearchParams({ popout: "1", room: target.room });
  if (target.kind === "dm") params.set("dm", target.conversationId);
  if (target.kind === "page") params.set("page", target.page);
  return `/chat?${params.toString()}`;
}

/** The windows this page opened, so a second pop-out of the same chat only brings it forward. */
const opened = new Map<string, Window>();

/** Open synchronously from a user click so popup blockers can recognize it. */
export function openChatPopout(input: ChatRoom | ChatPopoutTarget): boolean {
  const target: ChatPopoutTarget = typeof input === "string" ? { kind: "room", room: input } : input;
  const name = chatPopoutName(target);
  const existing = opened.get(name);
  if (existing && !existing.closed) {
    existing.focus();
    return true;
  }
  opened.delete(name);
  // Each new window steps down and left a little, so several pop-outs don't sit exactly on top
  // of each other.
  const open = [...opened.values()].filter((w) => !w.closed).length;
  const step = (open % 6) * 28;
  const width = Math.min(460, Math.max(340, window.screen.availWidth - 32));
  const height = Math.min(780, Math.max(560, window.screen.availHeight - 48));
  const left = Math.max(0, window.screenX + window.outerWidth - width - 24 - step);
  const top = Math.max(0, window.screenY + 36 + step);
  const url = new URL(chatPopoutPath(target), window.location.origin);
  // An empty address first: a window of this name opened before this page last loaded is found
  // and only brought forward, where opening the chat's address would reload it.
  const popup = window.open(
    "",
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`,
  );
  if (!popup) return false;
  let fresh = true;
  try {
    fresh = popup.location.href === "about:blank";
  } catch {
    // Another site in that window: put the chat back in it.
  }
  if (fresh) popup.location.replace(url.toString());
  popup.opener = null;
  opened.set(name, popup);
  popup.focus();
  return true;
}

/** The window title of a pop-out: the chat's own name first, so each window can be told apart. */
export function chatPopoutTitle(name: string): string {
  return `${name} · Rob Booker Chat`;
}
