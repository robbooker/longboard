import { expect, it } from "vitest";
import {
  chatThemeCookie,
  createChatThemeStore,
  gainersThemeOf,
  parseChatTheme,
  resolveChatTheme,
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
function store(saved: ChatTheme = "dark") {
  const writes: ChatTheme[] = [];
  let reads = 0;
  const themes = createChatThemeStore({
    read: () => {
      reads++;
      return saved;
    },
    write: (theme) => writes.push(theme),
  });
  return { themes, writes, reads: () => reads };
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
