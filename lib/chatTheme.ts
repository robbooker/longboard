export type ChatTheme = "dark" | "light" | "blade-runner";
export const CHAT_THEME_VALUES: ChatTheme[] = ["dark", "light", "blade-runner"];
/** Where chat keeps the choice in this browser. The gainers pages read and write it too (#343). */
export const CHAT_THEME_KEY = "longboard-public-chat-theme-v1";
/** Mirrors the localStorage choice so the server can render the saved theme on first paint. */
export const CHAT_THEME_COOKIE = "longboard-chat-theme";

export function parseChatTheme(value: unknown): ChatTheme | null {
  return CHAT_THEME_VALUES.find((theme) => theme === value) ?? null;
}

export function chatThemeCookie(theme: ChatTheme): string {
  return `${CHAT_THEME_COOKIE}=${theme}; Path=/chat; Max-Age=31536000; SameSite=Lax`;
}

export type GainersTheme = "light" | "dark";
/** #343: the gainers pages have light and dark only, so Blade Runner shows as dark there. Null: nothing saved. */
export function gainersThemeOf(saved: unknown): GainersTheme | null {
  const theme = parseChatTheme(saved);
  return theme === "light" ? "light" : theme ? "dark" : null;
}
