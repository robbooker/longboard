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

/** How long a theme change waits before it is saved to the account, so quick clicking saves once. */
export const CHAT_THEME_SAVE_DELAY_MS = 800;

/**
 * #407: one theme for the whole chat app. Every surface on screen (the single chat, each Quad pane
 * and Six card, their headers and dialogs) reads this one store, so a change anywhere repaints them
 * all at once. `read` loads this device's copy and `write` saves it (storage and the first-paint
 * cookie): the device copy is a cache that draws the right theme with no flash. The member's account
 * holds the choice too, so it follows them to other devices: `saveAccount` sends a change there
 * (debounced, never awaited) and `adoptAccount` applies what the account holds once it is read.
 * A change saved in another tab arrives through `sync`.
 */
export function createChatThemeStore(io: {
  read: () => ChatTheme;
  write: (theme: ChatTheme) => void;
  saveAccount?: (theme: ChatTheme) => void;
  schedule?: (run: () => void, ms: number) => () => void;
}) {
  let current: ChatTheme | null = null,
    persisted = false,
    chosenHere = false,
    cancelSave: (() => void) | null = null;
  const schedule =
    io.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get(): ChatTheme {
      if (current === null) current = io.read();
      return current;
    },
    /** The member picked a theme: show it everywhere now, cache it, and save it to the account shortly. */
    set(theme: ChatTheme) {
      if (!parseChatTheme(theme)) return;
      io.write(theme);
      persisted = true;
      chosenHere = true;
      cancelSave?.();
      if (io.saveAccount) {
        const save = io.saveAccount;
        cancelSave = schedule(() => {
          cancelSave = null;
          save(theme);
        }, CHAT_THEME_SAVE_DELAY_MS);
      }
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
    /**
     * The account's saved theme, read after the page loads. When it differs from this device's copy
     * it wins and refreshes the cache, unless the member already picked a theme on this page.
     * Null (never chosen on any device) keeps the device's theme; the first change saves it.
     */
    adoptAccount(saved: unknown) {
      const theme = parseChatTheme(saved);
      if (!theme || chosenHere) return;
      if (theme !== this.get()) {
        current = theme;
        notify();
      }
      io.write(theme);
      persisted = true;
    },
    /** Another tab saved a theme: show it here too, without saving it again. */
    sync(saved: unknown) {
      const theme = parseChatTheme(saved);
      if (!theme) return;
      // That tab saves it to the account; a change still waiting here must not overwrite it.
      cancelSave?.();
      cancelSave = null;
      if (theme === current) return;
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
