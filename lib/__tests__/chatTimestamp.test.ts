import { describe, expect, it } from "vitest";
import { chatTimestamp } from "@/lib/chatTimestamp";

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
