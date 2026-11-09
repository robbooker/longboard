// #385 Reader: saving a member's place a moment after they stop turning pages, and the reading
// settings this browser remembers (theme, text size). No React here so it can be unit tested.
import { CHAT_THEME_KEY, parseChatTheme } from "@/lib/chatTheme";

export type ProgressPoint = { location: string; percent: number };
export type SaveProgress = (point: ProgressPoint, options: { keepalive: boolean }) => Promise<boolean>;
export const PROGRESS_SAVE_DELAY_MS = 1500;

/**
 * Collects page turns and saves only the latest one, `delayMs` after the last turn. flush() saves at
 * once (the tab is being hidden or the book closed); a failed save is kept and tried again with the
 * next turn or flush. The same place twice in a row is not saved again.
 */
export function createProgressSaver(save: SaveProgress, delayMs = PROGRESS_SAVE_DELAY_MS) {
  let pending: ProgressPoint | null = null;
  let lastSaved: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const flush = async (keepalive = false): Promise<void> => {
    clear();
    const point = pending;
    if (!point) return;
    pending = null;
    const key = `${point.location}|${point.percent}`;
    let ok = false;
    try {
      ok = await save(point, { keepalive });
    } catch {
      ok = false;
    }
    if (ok) lastSaved = key;
    else if (!pending) pending = point; // Kept for the next try; a newer turn wins.
  };
  return {
    /** The place the reader opened at counts as saved, so opening a book doesn't write anything. */
    markSaved(point: ProgressPoint) {
      lastSaved = `${point.location}|${point.percent}`;
    },
    update(point: ProgressPoint) {
      if (`${point.location}|${point.percent}` === lastSaved) {
        pending = null;
        clear();
        return;
      }
      pending = point;
      clear();
      timer = setTimeout(() => void flush(false), delayMs);
    },
    flush,
    hasPending: () => pending !== null,
    cancel() {
      clear();
      pending = null;
    },
  };
}

/** Saves a place through the Reader API. Resolves true when the server kept it. */
export function saveProgressRequest(bookId: string, fetcher: typeof fetch = fetch): SaveProgress {
  return async (point, { keepalive }) => {
    const response = await fetcher("/api/chat/reader/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, location: point.location, percent: Math.round(point.percent * 10000) / 10000 }),
      keepalive,
      credentials: "same-origin",
    });
    return response.ok;
  };
}

/** The place to open a book at: the saved one when there is one. */
export function startLocation(saved: { location: string } | null | undefined): string | undefined {
  return saved?.location || undefined;
}

// --- Reading settings, per browser.
export type ReaderTheme = "light" | "sepia" | "dark" | "terminal";
export type ReaderThemeChoice = "auto" | ReaderTheme;
export const READER_THEMES: { value: ReaderThemeChoice; label: string }[] = [
  { value: "auto", label: "Match chat" },
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
  { value: "terminal", label: "Terminal" },
];
export type ReaderPrefs = { theme: ReaderThemeChoice; fontSize: number };
export const READER_PREFS_KEY = "longboard-reader-prefs-v1";
export const FONT_SIZES = [80, 90, 100, 110, 120, 135, 150, 175, 200];
export const DEFAULT_PREFS: ReaderPrefs = { theme: "auto", fontSize: 100 };

export function parsePrefs(raw: string | null | undefined): ReaderPrefs {
  try {
    const value = JSON.parse(raw ?? "null");
    const theme = READER_THEMES.some((t) => t.value === value?.theme) ? (value.theme as ReaderThemeChoice) : "auto";
    const fontSize = FONT_SIZES.includes(value?.fontSize) ? (value.fontSize as number) : 100;
    return { theme, fontSize };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** "Match chat": Light for the light chat theme, Terminal for Terminal, Dark for the dark ones. */
export function themeFromChat(chatTheme: unknown, prefersLight = false): ReaderTheme {
  const theme = parseChatTheme(chatTheme);
  if (theme === "light") return "light";
  if (theme === "terminal") return "terminal";
  if (theme) return "dark";
  return prefersLight ? "light" : "dark";
}
export const readChatTheme = () => {
  try {
    return window.localStorage.getItem(CHAT_THEME_KEY);
  } catch {
    return null;
  }
};

export function stepFontSize(current: number, direction: 1 | -1): number {
  const index = FONT_SIZES.indexOf(current);
  const from = index < 0 ? FONT_SIZES.indexOf(100) : index;
  return FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, from + direction))];
}

/** Colours for each reading theme: the page, its text, links and the reader's own controls. */
export const THEME_COLORS: Record<ReaderTheme, { bg: string; text: string; link: string }> = {
  light: { bg: "#fbfaf6", text: "#1f1d1a", link: "#1d5fa8" },
  sepia: { bg: "#f4ecd8", text: "#4a3b2a", link: "#8a4b12" },
  dark: { bg: "#151515", text: "#ddd7cb", link: "#8fb8e8" },
  terminal: { bg: "#1a1d24", text: "#e6e8ee", link: "#8fd8cc" },
};
