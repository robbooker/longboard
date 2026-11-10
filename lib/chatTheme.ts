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

/**
 * #420: colour combinations for the standard look. A combination changes colours only, on top of
 * the Dark or Light theme named as its base; the fonts, sizes and shapes stay the standard ones.
 * This is the one list of them: Profile settings draws its swatches from it, and the colours
 * themselves live only in components/chat/chatPalettes.css (a unit test keeps the two in step and
 * checks every combination is readable). To add one: a line here and a block there.
 */
export const CHAT_PALETTES = [
  { id: "ocean", label: "Ocean", base: "dark" },
  { id: "plum", label: "Plum", base: "dark" },
  { id: "slate", label: "Slate", base: "dark" },
  { id: "midnight", label: "Midnight", base: "dark" },
  { id: "ember", label: "Ember", base: "dark" },
  { id: "contrast", label: "High contrast", base: "dark" },
  { id: "paper", label: "Paper", base: "light" },
  { id: "rose", label: "Rose", base: "light" },
  { id: "sky", label: "Sky", base: "light" },
  { id: "lavender", label: "Lavender", base: "light" },
] as const satisfies ReadonlyArray<{ id: string; label: string; base: "dark" | "light" }>;
export type ChatPalette = (typeof CHAT_PALETTES)[number];
export type ChatPaletteId = ChatPalette["id"];
/** What the member picked: one of the four themes, or a colour combination (shown on its base theme). */
export type ChatLook = ChatTheme | ChatPaletteId;
/** This browser's copy of the combination; the theme key above keeps holding the base theme. */
export const CHAT_PALETTE_KEY = "longboard-chat-palette-v1";
/** The combination for the server's first paint, beside the theme cookie. */
export const CHAT_PALETTE_COOKIE = "longboard-chat-palette";

export function parseChatPalette(value: unknown): ChatPalette | null {
  return CHAT_PALETTES.find((palette) => palette.id === value) ?? null;
}

/**
 * The look a saved theme and a saved combination add up to. The combination counts only on top of
 * its own base theme: an unknown or removed name, or one left behind under another theme (an older
 * tab or the gainers pages changed the theme), is ignored and the plain theme shows.
 */
export function chatLookOf(theme: unknown, palette: unknown): ChatLook | null {
  const base = parseChatTheme(theme),
    combination = parseChatPalette(palette);
  return combination && combination.base === base ? combination.id : base;
}

/** The saved look as the server reads it from the request's cookies, for the first paint. */
export function chatLookFromCookies(jar: {
  get(name: string): { value: string } | undefined;
}): ChatLook | null {
  return chatLookOf(jar.get(CHAT_THEME_COOKIE)?.value, jar.get(CHAT_PALETTE_COOKIE)?.value);
}

/** A look as the page draws it and storage keeps it: the theme, and the combination on top (if any). */
export function chatLookParts(look: unknown): { theme: ChatTheme; palette: ChatPaletteId | null } | null {
  const combination = parseChatPalette(look);
  if (combination) return { theme: combination.base, palette: combination.id };
  const theme = parseChatTheme(look);
  return theme ? { theme, palette: null } : null;
}

/** Sets the combination cookie, or removes it when the look is a plain theme. */
export function chatPaletteCookie(palette: ChatPaletteId | null): string {
  return `${CHAT_PALETTE_COOKIE}=${palette ?? ""}; Path=/chat; Max-Age=${palette ? 31536000 : 0}; SameSite=Lax`;
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
 * #420: what it holds is a look: one of the themes, or a colour combination.
 */
export function createChatThemeStore(io: {
  read: () => ChatLook;
  write: (look: ChatLook) => void;
  saveAccount?: (look: ChatLook) => void;
  schedule?: (run: () => void, ms: number) => () => void;
}) {
  let current: ChatLook | null = null,
    persisted = false,
    chosenHere = false,
    cancelSave: (() => void) | null = null,
    waiting: ChatLook | null = null;
  const schedule =
    io.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const parse = (value: unknown): ChatLook | null => {
    const parts = chatLookParts(value);
    return parts ? (parts.palette ?? parts.theme) : null;
  };
  return {
    get(): ChatLook {
      if (current === null) current = io.read();
      return current;
    },
    /** The member picked a look: show it everywhere now, cache it, and save it to the account shortly. */
    set(look: ChatLook) {
      if (!parse(look)) return;
      io.write(look);
      persisted = true;
      chosenHere = true;
      cancelSave?.();
      if (io.saveAccount) {
        const save = io.saveAccount;
        waiting = look;
        cancelSave = schedule(() => {
          cancelSave = waiting = null;
          save(look);
        }, CHAT_THEME_SAVE_DELAY_MS);
      }
      if (look === current) return;
      current = look;
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
     * The account's saved look, read after the page loads. When it differs from this device's copy
     * it wins and refreshes the cache, unless the member already picked one on this page.
     * Null (never chosen on any device) keeps the device's look; the first change saves it.
     */
    adoptAccount(saved: unknown) {
      const look = parse(saved);
      if (!look || chosenHere) return;
      if (look !== this.get()) {
        current = look;
        notify();
      }
      io.write(look);
      persisted = true;
    },
    /** Another tab saved a look: show it here too, without saving it again. */
    sync(saved: unknown) {
      const look = parse(saved);
      if (!look) return;
      // That tab saves it to the account; a change still waiting here must not overwrite it.
      cancelSave?.();
      cancelSave = waiting = null;
      if (look === current) return;
      current = look;
      notify();
    },
    /**
     * #420: the page is going away (a reload, or the app put away) with a change still waiting:
     * save it to the account now, so the account's older look does not undo it on the next load.
     */
    saveWaiting() {
      const look = waiting;
      if (look === null) return;
      cancelSave?.();
      cancelSave = waiting = null;
      io.saveAccount?.(look);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
