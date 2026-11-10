import { describe, expect, it } from "vitest";
import {
  CHAT_PALETTES,
  chatLookFromCookies,
  chatLookOf,
  chatLookParts,
  chatPaletteCookie,
  chatThemeCookie,
  createChatThemeStore,
  gainersThemeOf,
  parseChatPalette,
  parseChatTheme,
  resolveChatTheme,
  type ChatLook,
  type ChatTheme,
} from "@/lib/chatTheme";

it("accepts only known chat themes from the cookie", () => {
  expect(parseChatTheme("light")).toBe("light");
  expect(parseChatTheme("blade-runner")).toBe("blade-runner");
  expect(parseChatTheme("terminal")).toBe("terminal");
  for (const value of [undefined, "", "Light", "javascript:alert(1)", "dark;path=/"]) expect(parseChatTheme(value)).toBeNull();
});

it("scopes the theme cookie to chat for a year", () => {
  expect(chatThemeCookie("dark")).toBe("longboard-chat-theme=dark; Path=/chat; Max-Age=31536000; SameSite=Lax");
});

it("maps chat's saved theme to the gainers pages' light and dark", () => {
  expect(gainersThemeOf("light")).toBe("light");
  expect(gainersThemeOf("dark")).toBe("dark");
  expect(gainersThemeOf("blade-runner")).toBe("dark");
  expect(gainersThemeOf("terminal")).toBe("dark");
  for (const value of [null, undefined, "", "Light", "junk"]) expect(gainersThemeOf(value)).toBeNull();
});

it("shows the saved theme, else the system's light or dark", () => {
  expect(resolveChatTheme("terminal", true)).toBe("terminal");
  expect(resolveChatTheme(null, true)).toBe("light");
  expect(resolveChatTheme(null, false)).toBe("dark");
  expect(resolveChatTheme("junk", false)).toBe("dark");
});

// #407: one store for every surface on screen, so Quad and Six cards and their headers change together.
function store(saved: ChatLook = "dark") {
  const writes: ChatLook[] = [],
    accountSaves: ChatLook[] = [];
  let reads = 0,
    pending: (() => void) | null = null;
  const themes = createChatThemeStore({
    read: () => {
      reads++;
      return saved;
    },
    write: (theme) => writes.push(theme),
    saveAccount: (theme) => accountSaves.push(theme),
    schedule: (run) => {
      pending = run;
      return () => {
        pending = null;
      };
    },
  });
  /** The debounce timer fires. */
  const flush = () => {
    const run = pending;
    pending = null;
    run?.();
  };
  return { themes, writes, reads: () => reads, accountSaves, flush };
}

it("reads the saved theme once and shares it with every reader", () => {
  const { themes, reads } = store("terminal");
  expect(themes.get()).toBe("terminal");
  expect(themes.get()).toBe("terminal");
  expect(reads()).toBe(1);
});

it("a change saves the theme and repaints every subscriber at once", () => {
  const { themes, writes } = store("dark");
  const seen: string[] = [];
  const stopA = themes.subscribe(() => seen.push(`a:${themes.get()}`));
  themes.subscribe(() => seen.push(`b:${themes.get()}`));
  themes.set("terminal");
  expect(seen).toEqual(["a:terminal", "b:terminal"]);
  expect(writes).toEqual(["terminal"]);
  stopA();
  themes.set("light");
  expect(seen).toEqual(["a:terminal", "b:terminal", "b:light"]);
  expect(themes.get()).toBe("light");
});

it("saves what is shown once per page, however many cards mount", () => {
  const { themes, writes } = store("terminal");
  let calls = 0;
  themes.subscribe(() => calls++);
  themes.persist();
  themes.persist();
  expect(writes).toEqual(["terminal"]);
  // A card mounting after another tab changed the theme does not write the old one back.
  themes.sync("light");
  themes.persist();
  expect(writes).toEqual(["terminal"]);
  expect(calls).toBe(1);
});

it("ignores unknown themes and follows a theme saved in another tab without saving it again", () => {
  const { themes, writes } = store("dark");
  let calls = 0;
  themes.subscribe(() => calls++);
  themes.set("sepia" as ChatTheme);
  themes.sync("nonsense");
  expect(themes.get()).toBe("dark");
  themes.sync("terminal");
  expect(themes.get()).toBe("terminal");
  expect(calls).toBe(1);
  expect(writes).toEqual([]);
});

describe("the account copy (#407: the theme follows the member to other devices)", () => {
  it("saves a change to the account once, after quick clicking settles", () => {
    const { themes, accountSaves, flush } = store("dark");
    themes.set("light");
    themes.set("blade-runner");
    themes.set("terminal");
    expect(themes.get()).toBe("terminal");
    expect(accountSaves).toEqual([]);
    flush();
    expect(accountSaves).toEqual(["terminal"]);
  });

  it("the account's theme wins over this device's copy and refreshes it", () => {
    const { themes, writes, accountSaves } = store("dark");
    let repaints = 0;
    themes.subscribe(() => repaints++);
    themes.persist();
    themes.adoptAccount("terminal");
    expect(themes.get()).toBe("terminal");
    expect(writes).toEqual(["dark", "terminal"]);
    expect(repaints).toBe(1);
    expect(accountSaves).toEqual([]);
  });

  it("no saved theme on the account keeps the device's, saved on the first change", () => {
    const { themes, writes, accountSaves, flush } = store("blade-runner");
    themes.adoptAccount(null);
    themes.adoptAccount("not-a-theme");
    expect(themes.get()).toBe("blade-runner");
    expect(writes).toEqual([]);
    themes.set("light");
    flush();
    expect(accountSaves).toEqual(["light"]);
  });

  it("a theme picked on this page before the account answers is kept", () => {
    const { themes, flush, accountSaves } = store("dark");
    themes.set("terminal");
    themes.adoptAccount("light");
    expect(themes.get()).toBe("terminal");
    flush();
    expect(accountSaves).toEqual(["terminal"]);
  });

  it("another tab's change cancels a save still waiting here", () => {
    const { themes, flush, accountSaves } = store("dark");
    themes.set("light");
    themes.sync("terminal");
    flush();
    expect(accountSaves).toEqual([]);
    expect(themes.get()).toBe("terminal");
  });

  it("#420: leaving the page saves a change still waiting, once", () => {
    const { themes, flush, accountSaves } = store("dark");
    themes.saveWaiting();
    expect(accountSaves).toEqual([]);
    themes.set("light");
    themes.set("ocean");
    themes.saveWaiting();
    expect(accountSaves).toEqual(["ocean"]);
    themes.saveWaiting();
    flush();
    expect(accountSaves).toEqual(["ocean"]);
  });

  it("#420: leaving the page saves nothing once the save went out, or another tab took over", () => {
    const { themes, flush, accountSaves } = store("dark");
    themes.set("light");
    flush();
    themes.saveWaiting();
    expect(accountSaves).toEqual(["light"]);
    themes.set("plum");
    themes.sync("terminal");
    themes.saveWaiting();
    expect(accountSaves).toEqual(["light"]);
  });
});

describe("colour combinations (#420: colours only, on top of the Dark or Light theme)", () => {
  it("accepts only the listed combinations", () => {
    expect(parseChatPalette("ocean")).toMatchObject({ id: "ocean", base: "dark" });
    expect(parseChatPalette("paper")).toMatchObject({ id: "paper", base: "light" });
    for (const value of [undefined, null, "", "Ocean", "dark", "sepia", "ocean;path=/", 7])
      expect(parseChatPalette(value)).toBeNull();
  });

  it("a combination counts only on top of its own base theme", () => {
    expect(chatLookOf("dark", "ocean")).toBe("ocean");
    expect(chatLookOf("light", "paper")).toBe("paper");
    expect(chatLookOf("light", null)).toBe("light");
    expect(chatLookOf("terminal", undefined)).toBe("terminal");
    // Left behind under another theme (an older tab or the gainers pages changed the theme).
    expect(chatLookOf("light", "ocean")).toBe("light");
    expect(chatLookOf("blade-runner", "ocean")).toBe("blade-runner");
    expect(chatLookOf("terminal", "paper")).toBe("terminal");
  });

  it("an unknown or removed combination falls back to the plain theme", () => {
    expect(chatLookOf("dark", "sepia")).toBe("dark");
    expect(chatLookOf("light", "javascript:alert(1)")).toBe("light");
    expect(chatLookOf("junk", "ocean")).toBeNull();
    expect(chatLookOf(null, null)).toBeNull();
  });

  it("splits a look into the theme the page draws and the combination on top", () => {
    expect(chatLookParts("ocean")).toEqual({ theme: "dark", palette: "ocean" });
    expect(chatLookParts("lavender")).toEqual({ theme: "light", palette: "lavender" });
    expect(chatLookParts("terminal")).toEqual({ theme: "terminal", palette: null });
    expect(chatLookParts("sepia")).toBeNull();
    expect(chatLookParts(undefined)).toBeNull();
    for (const palette of CHAT_PALETTES) expect(chatLookOf(palette.base, palette.id)).toBe(palette.id);
  });

  it("the theme a combination is stored under still maps to the gainers pages' light and dark", () => {
    for (const palette of CHAT_PALETTES) expect(gainersThemeOf(chatLookParts(palette.id)?.theme)).toBe(palette.base);
  });

  it("scopes the combination cookie to chat, and removes it for a plain theme", () => {
    expect(chatPaletteCookie("ocean")).toBe("longboard-chat-palette=ocean; Path=/chat; Max-Age=31536000; SameSite=Lax");
    expect(chatPaletteCookie(null)).toBe("longboard-chat-palette=; Path=/chat; Max-Age=0; SameSite=Lax");
  });

  it("reads the first paint's look from the two cookies", () => {
    const jar = (values: Record<string, string>) => ({
      get: (name: string) => (name in values ? { value: values[name] } : undefined),
    });
    expect(chatLookFromCookies(jar({ "longboard-chat-theme": "light", "longboard-chat-palette": "rose" }))).toBe("rose");
    expect(chatLookFromCookies(jar({ "longboard-chat-theme": "terminal", "longboard-chat-palette": "rose" }))).toBe("terminal");
    expect(chatLookFromCookies(jar({ "longboard-chat-theme": "dark", "longboard-chat-palette": "gone" }))).toBe("dark");
    expect(chatLookFromCookies(jar({ "longboard-chat-palette": "rose" }))).toBeNull();
    expect(chatLookFromCookies(jar({}))).toBeNull();
  });

  it("the store shows, saves and shares a combination like a theme", () => {
    const { themes, writes, accountSaves, flush } = store("dark");
    const seen: string[] = [];
    themes.subscribe(() => seen.push(themes.get()));
    themes.set("ocean");
    themes.set("paper");
    expect(seen).toEqual(["ocean", "paper"]);
    expect(writes).toEqual(["ocean", "paper"]);
    flush();
    expect(accountSaves).toEqual(["paper"]);
    // Picking one of the four themes replaces the combination.
    themes.set("blade-runner");
    flush();
    expect(themes.get()).toBe("blade-runner");
    expect(accountSaves).toEqual(["paper", "blade-runner"]);
  });

  it("follows the account's combination and another tab's, and ignores unknown names", () => {
    const { themes, writes, accountSaves } = store("dark");
    themes.adoptAccount("plum");
    expect(themes.get()).toBe("plum");
    expect(writes).toEqual(["plum"]);
    themes.sync("sky");
    expect(themes.get()).toBe("sky");
    themes.sync("sepia");
    themes.set("sepia" as ChatLook);
    themes.adoptAccount("sepia");
    expect(themes.get()).toBe("sky");
    expect(writes).toEqual(["plum"]);
    expect(accountSaves).toEqual([]);
  });

  it("starts from a combination saved on this device", () => {
    const { themes, writes } = store("lavender");
    expect(themes.get()).toBe("lavender");
    themes.persist();
    expect(writes).toEqual(["lavender"]);
  });
});
