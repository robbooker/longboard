import { describe, expect, it } from "vitest";
import { passwordResetRedirectTo } from "@/lib/passwordResetRedirect";

describe("passwordResetRedirectTo", () => {
  it("returns to the chat address when requested on exactly that origin", () => {
    expect(passwordResetRedirectTo("https://chat.robbooker.com", "https://www.longboardai.com")).toBe(
      "https://chat.robbooker.com/onboarding?mode=reset",
    );
    expect(passwordResetRedirectTo("https://chat.robbooker.com", undefined)).toBe(
      "https://chat.robbooker.com/onboarding?mode=reset",
    );
  });

  it.each([
    "https://www.longboardai.com",
    "https://longboardai.com",
    "https://chat.robbooker.com.evil.example",
    "http://chat.robbooker.com",
    "https://chat.robbooker.com:8443",
    "https://robbooker.com",
    "http://localhost:3000",
  ])("keeps the configured site for %s", (origin) => {
    expect(passwordResetRedirectTo(origin, "https://configured.example")).toBe(
      "https://configured.example/onboarding?mode=reset",
    );
    expect(passwordResetRedirectTo(origin, undefined)).toBe("https://longboardai.com/onboarding?mode=reset");
  });
});
