/**
 * PHONE-NOTIFY-PROMPT: whether a phone shows the "notifications are off" icon in the chat header,
 * and what tapping it opens. Decided only from what this browser already knows (permission,
 * the chat service worker's push subscription, the owner record ChatPushSettings keeps) — never
 * from a server request.
 */

/** "settings": the Phone notifications dialog. "install": Add to Home Screen steps (iPhone in a
 * Safari tab, where web push needs the Home Screen app). "denied": re-enable in the phone's settings. */
export type PushPromptState = "hidden" | "settings" | "install" | "denied";

export const PUSH_PROMPT_SNOOZE_KEY = "longboard.chat.push-prompt-snooze.v1";
export const PUSH_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export type PushPromptInput = {
  phone: boolean;
  signedIn: boolean;
  /** Secure context with service workers, PushManager and Notification. */
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  /** This account's chat push is on for this device; null while the browser is still being asked. */
  subscribed: boolean | null;
  ios: boolean;
  standalone: boolean;
  snoozed: boolean;
};

export function pushPromptState(input: PushPromptInput): PushPromptState {
  if (!input.phone || !input.signedIn || input.snoozed) return "hidden";
  // Web push on iPhone needs the Home Screen app (iOS 16.4+); a Safari tab cannot subscribe.
  if (input.ios && !input.standalone) return "install";
  // Nothing this browser can turn on (an installed app on iOS before 16.4, an old browser).
  if (!input.supported || input.permission === "unsupported") return "hidden";
  if (input.permission === "denied") return "denied";
  // Not known yet: stay hidden instead of flashing the icon on a device that is already set up.
  if (input.subscribed === null) return "hidden";
  if (input.permission === "granted" && input.subscribed) return "hidden";
  return "settings";
}

/**
 * Whether this device's chat subscription counts as this account's. Without an owner record
 * (storage cleared or disabled) a subscription is taken as on, so a set-up device is never nagged;
 * a record for another account on this device means it is off for this one.
 */
export function chatPushOnForAccount(
  endpoint: string | null,
  owner: { accountId: string; endpoint: string } | null,
  accountId: string,
): boolean {
  if (!endpoint || !accountId) return false;
  return !owner || owner.accountId === accountId;
}

export function pushPromptSnoozed(storage: Pick<Storage, "getItem"> | null, now: number): boolean {
  try {
    const until = Number(storage?.getItem(PUSH_PROMPT_SNOOZE_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

export function snoozePushPrompt(storage: Pick<Storage, "setItem"> | null, now: number): void {
  try {
    storage?.setItem(PUSH_PROMPT_SNOOZE_KEY, String(now + PUSH_PROMPT_SNOOZE_MS));
  } catch {
    /* Storage can be disabled; the icon then hides for this page only. */
  }
}
