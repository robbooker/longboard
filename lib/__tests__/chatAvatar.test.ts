import { describe, expect, it } from "vitest";
import { chatAvatarColor, chatInitials } from "@/lib/chatAvatar";

describe("chatInitials", () => {
  it("uses up to two words", () => {
    expect(chatInitials("Jammie Ferguson")).toBe("JF");
    expect(chatInitials("bob")).toBe("B");
    expect(chatInitials("@Buddy")).toBe("B");
    expect(chatInitials("Mary Ann Smith")).toBe("MA");
    expect(chatInitials("  ")).toBe("?");
  });
});
describe("chatAvatarColor", () => {
  it("is stable per person", () => {
    expect(chatAvatarColor("member-1")).toBe(chatAvatarColor("member-1"));
    expect(chatAvatarColor("member-1")).toMatch(/^hsl\(\d+ 42% 36%\)$/);
  });
});
