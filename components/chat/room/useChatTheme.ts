"use client";
import { chatThemeCookie, type ChatTheme } from "@/lib/chatTheme";
import { useEffect, useState } from "react";
import type { ChatIconName } from "../ChatIcon";

const CHAT_THEME_KEY = "longboard-public-chat-theme-v1";
export const CHAT_THEMES: Array<{ value: ChatTheme; label: string; icon: ChatIconName }> = [
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "blade-runner", label: "Blade Runner", icon: "spark" },
];

/** The chat theme: the saved choice, else the system's light/dark preference. */
export function useChatTheme(initialTheme?: ChatTheme | null) {
  const [theme, setTheme] = useState<ChatTheme>(initialTheme ?? "dark");
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(CHAT_THEME_KEY);
    if (CHAT_THEMES.some((option) => option.value === saved)) {
      setTheme(saved as ChatTheme);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    window.localStorage.setItem(CHAT_THEME_KEY, theme);
    document.cookie = chatThemeCookie(theme);
  }, [theme, themeReady]);
  return { theme, setTheme, themeReady };
}
