export type ChatTheme = "dark" | "light" | "blade-runner" | "terminal";
export const CHAT_THEME_VALUES: ChatTheme[] = ["dark", "light", "blade-runner", "terminal"];
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
/** #343: the gainers pages have light and dark only, so Blade Runner and Terminal (#378) show as dark there. Null: nothing saved. */
export function gainersThemeOf(saved: unknown): GainersTheme | null {
  const theme = parseChatTheme(saved);
  return theme === "light" ? "light" : theme ? "dark" : null;
}

/** The theme to show: the saved choice, else the system's light/dark preference. */
export function resolveChatTheme(saved: unknown, prefersLight: boolean): ChatTheme {
  return parseChatTheme(saved) ?? (prefersLight ? "light" : "dark");
}

/**
 * #407: one theme for the whole chat app. Every surface on screen (the single chat, each Quad pane
 * and Six card, their headers and dialogs) reads this one store, so a change anywhere repaints them
 * all at once. `read` loads the saved choice (this device's storage), `write` saves it (storage and
 * the first-paint cookie); a change saved in another tab arrives through `sync`.
 */
export function createChatThemeStore(io: { read: () => ChatTheme; write: (theme: ChatTheme) => void }) {
  let current: ChatTheme | null = null,
    persisted = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get(): ChatTheme {
      if (current === null) current = io.read();
      return current;
    },
    set(theme: ChatTheme) {
      if (!parseChatTheme(theme)) return;
      io.write(theme);
      persisted = true;
      if (theme === current) return;
      current = theme;
      notify();
    },
    /**
     * Save what is shown (the system's preference when nothing was chosen, and the cookie for the next
     * first paint) once per page, however many surfaces mount: a card mounting later must not write
     * back a theme another tab has changed since.
     */
    persist() {
      if (persisted) return;
      persisted = true;
      io.write(this.get());
    },
    /** Another tab saved a theme: show it here too, without saving it again. */
    sync(saved: unknown) {
      const theme = parseChatTheme(saved);
      if (!theme || theme === current) return;
      current = theme;
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
