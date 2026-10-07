import { expect, it } from "vitest";
import { chatThemeCookie, parseChatTheme } from "@/lib/chatTheme";

it("accepts only known chat themes from the cookie", () => {
  expect(parseChatTheme("light")).toBe("light");
  expect(parseChatTheme("blade-runner")).toBe("blade-runner");
  for (const value of [undefined, "", "Light", "javascript:alert(1)", "dark;path=/"]) expect(parseChatTheme(value)).toBeNull();
});

it("scopes the theme cookie to chat for a year", () => {
  expect(chatThemeCookie("dark")).toBe("longboard-chat-theme=dark; Path=/chat; Max-Age=31536000; SameSite=Lax");
});
