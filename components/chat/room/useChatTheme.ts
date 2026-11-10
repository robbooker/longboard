"use client";
import {
  CHAT_PALETTE_KEY,
  CHAT_THEME_KEY,
  chatLookOf,
  chatLookParts,
  chatPaletteCookie,
  chatThemeCookie,
  createChatThemeStore,
  resolveChatTheme,
  type ChatLook,
  type ChatTheme,
} from "@/lib/chatTheme";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatIconName } from "../ChatIcon";
// #420: the colour combinations' colours. Loaded here so every themed surface has them.
import "../chatPalettes.css";

export const CHAT_THEMES: Array<{ value: ChatTheme; label: string; icon: ChatIconName }> = [
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "blade-runner", label: "Blade Runner", icon: "spark" },
  { value: "terminal", label: "Terminal", icon: "terminal" },
];

function saved(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * This device's look: the saved theme (else the system's light or dark), with the saved colour
 * combination on top when it belongs to that theme (#420).
 */
function deviceLook(): ChatLook {
  const theme = resolveChatTheme(
    saved(CHAT_THEME_KEY),
    window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  return chatLookOf(theme, saved(CHAT_PALETTE_KEY)) ?? theme;
}

/** The signed-in account whose saved theme this page follows (#407); null when signed out. */
let account: string | null = null;

/** #407: the one theme every chat surface on this page shares (see createChatThemeStore). */
const store = createChatThemeStore({
  // Fire and forget: the theme is already on screen and cached; the account copy is for other devices.
  saveAccount: (look) => {
    const parts = chatLookParts(look);
    if (!account || !parts) return;
    fetch("/api/chat/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parts),
      keepalive: true,
    }).catch(() => {});
  },
  read: deviceLook,
  // The theme key and cookie keep holding a plain theme (the combination's base), as the gainers
  // pages and older tabs expect; the combination has a key and cookie of its own (#420).
  write: (look) => {
    const parts = chatLookParts(look);
    if (!parts) return;
    try {
      window.localStorage.setItem(CHAT_THEME_KEY, parts.theme);
      if (parts.palette) window.localStorage.setItem(CHAT_PALETTE_KEY, parts.palette);
      else window.localStorage.removeItem(CHAT_PALETTE_KEY);
    } catch {}
    try {
      document.cookie = chatThemeCookie(parts.theme);
      document.cookie = chatPaletteCookie(parts.palette);
    } catch {
      // A page that may not keep cookies still shows the look; only the first paint goes without it.
    }
  },
});

function subscribe(listener: () => void) {
  const stop = store.subscribe(listener);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CHAT_THEME_KEY && event.key !== CHAT_PALETTE_KEY) return;
    // Another tab writes the theme and the combination one after the other: read both once they
    // settle. The event's own value stands for its key, as before; the other key comes from storage.
    const now = (key: string) => (event.key === key ? event.newValue : saved(key));
    clearTimeout(timer);
    // Nothing saved any more (storage was cleared) keeps what is shown.
    timer = setTimeout(() => store.sync(chatLookOf(now(CHAT_THEME_KEY), now(CHAT_PALETTE_KEY))), 50);
  };
  window.addEventListener("storage", onStorage);
  // A reload or leaving the page right after a pick must not lose it (the save waits a moment).
  window.addEventListener("pagehide", store.saveWaiting);
  return () => {
    stop();
    clearTimeout(timer);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pagehide", store.saveWaiting);
  };
}

/**
 * The chat theme: the saved choice, else the system's light/dark preference. Shared by every
 * caller, so the single chat, Quad, Six and their cards always show the same theme.
 * initialLook is the server's copy (the cookies), drawn until the browser's own is read.
 * accountId (signed in): the account's saved theme is read once and followed, and changes are saved there.
 * #420: `look` is what the member picked (a theme or a colour combination). A themed element takes
 * `data-theme={theme}` and `data-palette={palette}`: the combination's base theme, and its name
 * (undefined, so no attribute, for a plain theme). setTheme takes either kind.
 */
export function useChatTheme(initialLook?: ChatLook | null, accountId?: string | null) {
  const look = useSyncExternalStore(subscribe, store.get, () => initialLook ?? "dark");
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    // Keep the cookie (first paint) in step with this device's choice, as before.
    store.persist();
    setThemeReady(true);
  }, []);
  useEffect(() => {
    // #407: once per page and account, read the account's theme; it wins over this device's copy.
    if (!accountId || account === accountId) return;
    account = accountId;
    fetch("/api/chat/theme", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { theme?: unknown; palette?: unknown } | null) => {
        if (body && account === accountId) store.adoptAccount(chatLookOf(body.theme, body.palette));
      })
      .catch(() => {});
  }, [accountId]);
  const parts = chatLookParts(look);
  return {
    theme: parts?.theme ?? "dark",
    palette: parts?.palette ?? undefined,
    look,
    setTheme: store.set,
    themeReady,
  };
}
