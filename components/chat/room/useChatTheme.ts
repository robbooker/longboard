"use client";
import {
  CHAT_THEME_KEY,
  chatThemeCookie,
  createChatThemeStore,
  resolveChatTheme,
  type ChatTheme,
} from "@/lib/chatTheme";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatIconName } from "../ChatIcon";

export const CHAT_THEMES: Array<{ value: ChatTheme; label: string; icon: ChatIconName }> = [
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "blade-runner", label: "Blade Runner", icon: "spark" },
  { value: "terminal", label: "Terminal", icon: "terminal" },
];

function saved(): string | null {
  try {
    return window.localStorage.getItem(CHAT_THEME_KEY);
  } catch {
    return null;
  }
}

/** #407: the one theme every chat surface on this page shares (see createChatThemeStore). */
const store = createChatThemeStore({
  read: () => resolveChatTheme(saved(), window.matchMedia("(prefers-color-scheme: light)").matches),
  write: (theme) => {
    try {
      window.localStorage.setItem(CHAT_THEME_KEY, theme);
    } catch {}
    document.cookie = chatThemeCookie(theme);
  },
});

function subscribe(listener: () => void) {
  const stop = store.subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CHAT_THEME_KEY) store.sync(event.newValue);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    stop();
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The chat theme: the saved choice, else the system's light/dark preference. Shared by every
 * caller, so the single chat, Quad, Six and their cards always show the same theme.
 * initialTheme is the server's copy (the cookie), drawn until the browser's own is read.
 */
export function useChatTheme(initialTheme?: ChatTheme | null) {
  const theme = useSyncExternalStore(subscribe, store.get, () => initialTheme ?? "dark");
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    // Keep the cookie (first paint) in step with this device's choice, as before.
    store.persist();
    setThemeReady(true);
  }, []);
  return { theme, setTheme: store.set, themeReady };
}
