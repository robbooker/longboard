import { describe, expect, it } from "vitest";
import { chatDayLabel, chatMessagePlacement, chatTimestamp } from "@/lib/chatTimestamp";

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 14, 9, 30);

describe("chatTimestamp", () => {
  it("shows only the time today", () => expect(chatTimestamp(at(2026, 10, 14, 8, 5), now)).toBe("08:05"));
  it("says Yesterday across midnight", () => {
    expect(chatTimestamp(at(2026, 10, 13, 23, 59), now)).toBe("Yesterday 23:59");
    expect(chatTimestamp(at(2026, 10, 13, 0, 1), now)).toBe("Yesterday 00:01");
  });
  it("adds the date earlier this year", () => expect(chatTimestamp(at(2026, 10, 12, 14, 5), now)).toBe("Oct 12, 14:05"));
  it("adds the year for older messages", () => expect(chatTimestamp(at(2025, 12, 31, 14, 5), now)).toBe("Dec 31, 2025"));
  it("handles bad input", () => expect(chatTimestamp("nope", now)).toBe("Unknown date"));
});


describe("chatDayLabel", () => {
  it("names nearby days", () => {
    expect(chatDayLabel(at(2026, 10, 14, 0, 1), now)).toBe("Today");
    expect(chatDayLabel(at(2026, 10, 13, 23, 59), now)).toBe("Yesterday");
    expect(chatDayLabel(at(2026, 10, 12, 9, 0), now)).toBe("Mon, Oct 12");
    expect(chatDayLabel(at(2025, 12, 31, 9, 0), now)).toBe("Dec 31, 2025");
  });
});
describe("chatMessagePlacement", () => {
  const m = (who: string, h: number, min: number, d = 14) => ({ created_at: at(2026, 10, d, h, min), member_id: who, author_label: who });
  it("starts with a day divider", () => expect(chatMessagePlacement(undefined, m("bob", 9, 0)).day).not.toBeNull());
  it("groups the same person within 5 minutes", () => {
    expect(chatMessagePlacement(m("bob", 9, 0), m("bob", 9, 4))).toEqual({ day: null, continued: true });
    expect(chatMessagePlacement(m("bob", 9, 0), m("bob", 9, 6)).continued).toBe(false);
    expect(chatMessagePlacement(m("bob", 9, 0), m("ann", 9, 1)).continued).toBe(false);
  });
  it("breaks on a new day or when asked", () => {
    const p = chatMessagePlacement(m("bob", 23, 58, 13), m("bob", 0, 1, 14));
    expect(p.continued).toBe(false);
    expect(p.day).not.toBeNull();
    expect(chatMessagePlacement(m("bob", 9, 0), m("bob", 9, 1), { breakGroup: true }).continued).toBe(false);
  });
});
