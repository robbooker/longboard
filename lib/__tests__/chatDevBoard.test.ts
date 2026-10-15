import { describe, expect, it } from "vitest";
import { DEV_BOARD_LINK, DEV_BOARD_URL, showFeaturesLink } from "@/lib/chatDevBoard";
describe("chat dev board link (D-242)", () => {
  it("points at the company dev board in a new tab", () => {
    expect(DEV_BOARD_URL).toBe("https://company.robbooker.com/dev");
    expect(DEV_BOARD_LINK).toEqual({ href: DEV_BOARD_URL, target: "_blank", rel: "noopener noreferrer" });
    expect(DEV_BOARD_LINK.href).not.toContain("/chat/features");
  });
  it("shows Features to chat admins only", () => {
    expect(showFeaturesLink(true)).toBe(true);
    expect(showFeaturesLink(false)).toBe(false);
    expect(showFeaturesLink(undefined)).toBe(false);
  });
});
