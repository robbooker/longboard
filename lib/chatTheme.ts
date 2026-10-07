export type ChatTheme = "dark" | "light" | "blade-runner";
export const CHAT_THEME_VALUES: ChatTheme[] = ["dark", "light", "blade-runner"];
/** Mirrors the localStorage choice so the server can render the saved theme on first paint. */
export const CHAT_THEME_COOKIE = "longboard-chat-theme";

export function parseChatTheme(value: unknown): ChatTheme | null {
  return CHAT_THEME_VALUES.find((theme) => theme === value) ?? null;
}

export function chatThemeCookie(theme: ChatTheme): string {
  return `${CHAT_THEME_COOKIE}=${theme}; Path=/chat; Max-Age=31536000; SameSite=Lax`;
}
