"use client";

import { useSyncExternalStore } from "react";
import {
  CHAT_PUSH_CHANGED,
  CHAT_PUSH_OWNER_KEY,
  chatPushPlatform,
  isChatWorkerRegistration,
  readPushOwner,
} from "@/lib/chatPushBrowser";
import {
  chatPushOnForAccount,
  PUSH_PROMPT_SNOOZE_KEY,
  pushPromptSnoozed,
  pushPromptState,
  snoozePushPrompt,
  type PushPromptState,
} from "@/lib/chatPushPrompt";

/** PHONE-NOTIFY-PROMPT: what this browser knows about chat push, read once and shared by every
 * header that shows the icon. It is read again only when something says it changed (permission,
 * ChatPushSettings, another tab, coming back to the page) — never on a timer, never from the server. */
type Device = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  ios: boolean;
  standalone: boolean;
  snoozed: boolean;
  owner: { accountId: string; endpoint: string } | null;
  /** The chat worker's push endpoint; undefined until the browser has answered. */
  endpoint: string | null | undefined;
};

let device: Device | null = null;
const listeners = new Set<() => void>();
let stopListening: (() => void) | null = null;
let generation = 0;
/** "Not now" when storage cannot keep it: hidden for the rest of this page. */
let snoozedHere = false;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function standalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone
  );
}

function same(a: Device | null, b: Device) {
  return (
    !!a &&
    a.supported === b.supported &&
    a.permission === b.permission &&
    a.ios === b.ios &&
    a.standalone === b.standalone &&
    a.snoozed === b.snoozed &&
    a.endpoint === b.endpoint &&
    a.owner?.accountId === b.owner?.accountId &&
    a.owner?.endpoint === b.owner?.endpoint
  );
}

function set(next: Device) {
  if (same(device, next)) return;
  device = next;
  for (const listener of listeners) listener();
}

function refresh() {
  const token = ++generation;
  const local = storage();
  const isStandalone = standalone();
  const supported =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const base = {
    supported,
    permission: "Notification" in window ? Notification.permission : ("unsupported" as const),
    ios: chatPushPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints, isStandalone)
      .ios,
    standalone: isStandalone,
    snoozed: snoozedHere || pushPromptSnoozed(local, Date.now()),
    owner: local ? readPushOwner(local) : null,
  };
  // Keep the endpoint already known while the browser is asked again, so the icon does not blink.
  set({ ...base, endpoint: supported ? device?.endpoint : null });
  if (!supported) return;
  void (async () => {
    let endpoint: string | null = null;
    try {
      const registration = await navigator.serviceWorker.getRegistration("/chat");
      const subscription = isChatWorkerRegistration(registration)
        ? await registration.pushManager.getSubscription()
        : null;
      endpoint = subscription?.endpoint ?? null;
    } catch {
      endpoint = null;
    }
    if (token === generation && device) set({ ...device, endpoint });
  })();
}

function start() {
  refresh();
  let stopped = false;
  let permission: PermissionStatus | null = null;
  const visible = () => {
    // Coming back from the phone's Settings app, where notifications may have been allowed.
    if (document.visibilityState === "visible") refresh();
  };
  const stored = (event: StorageEvent) => {
    if (!event.key || event.key === CHAT_PUSH_OWNER_KEY || event.key === PUSH_PROMPT_SNOOZE_KEY) refresh();
  };
  const displayMode = window.matchMedia("(display-mode: standalone)");
  window.addEventListener(CHAT_PUSH_CHANGED, refresh);
  window.addEventListener("storage", stored);
  document.addEventListener("visibilitychange", visible);
  displayMode.addEventListener?.("change", refresh);
  navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((status) => {
      if (stopped) return;
      permission = status;
      status.addEventListener("change", refresh);
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    generation++;
    permission?.removeEventListener("change", refresh);
    window.removeEventListener(CHAT_PUSH_CHANGED, refresh);
    window.removeEventListener("storage", stored);
    document.removeEventListener("visibilitychange", visible);
    displayMode.removeEventListener?.("change", refresh);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  stopListening ??= start();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    stopListening?.();
    stopListening = null;
  };
}
const subscribeNothing = () => () => undefined;
const snapshot = () => device;
const serverSnapshot = () => null;

/** What the phone header's notification icon should do; "hidden" on a computer or once push is on. */
export function usePushPrompt(phone: boolean, accountId: string | undefined): PushPromptState {
  const enabled = phone && !!accountId;
  const current = useSyncExternalStore(enabled ? subscribe : subscribeNothing, snapshot, serverSnapshot);
  if (!enabled || !current) return "hidden";
  return pushPromptState({
    phone,
    signedIn: true,
    supported: current.supported,
    permission: current.permission,
    subscribed:
      current.endpoint === undefined
        ? null
        : chatPushOnForAccount(current.endpoint, current.owner, accountId),
    ios: current.ios,
    standalone: current.standalone,
    snoozed: current.snoozed,
  });
}

/** "Not now": hide the icon on this device for 30 days. */
export function snoozeChatPushPrompt() {
  snoozedHere = true;
  snoozePushPrompt(storage(), Date.now());
  if (listeners.size) refresh();
}

/** The event the icon sends: the Phone notifications dialog, or the sheet with steps. */
export const CHAT_OPEN_PUSH_PROMPT = "chat-open-push-prompt";
export function openPushPrompt(state: Exclude<PushPromptState, "hidden">, from?: HTMLElement | null) {
  window.dispatchEvent(
    state === "settings"
      ? new CustomEvent("chat-open-push-settings", { detail: { source: "prompt" } })
      : new CustomEvent(CHAT_OPEN_PUSH_PROMPT, { detail: { kind: state, from: from ?? undefined } }),
  );
}
