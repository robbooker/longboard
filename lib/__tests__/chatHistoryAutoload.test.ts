import { describe, expect, it } from "vitest";
import { historyAutoload } from "../chatHistoryAutoload";

const node = (scrollTop: number) => ({ scrollTop, scrollHeight: 5000, clientHeight: 600 });
const page = { hasMore: true, hasNewer: true, busy: false };

describe("history autoload", () => {
  it("loads earlier messages when the reader scrolls up near the top", () => {
    expect(historyAutoload(node(500), "up", page)).toBe("before");
    expect(historyAutoload(node(1500), "up", page)).toBeNull();
  });
  it("loads newer messages when the reader scrolls down near the bottom of a history window", () => {
    expect(historyAutoload(node(3900), "down", page)).toBe("after");
    expect(historyAutoload(node(2000), "down", page)).toBeNull();
    expect(historyAutoload(node(3900), "down", { ...page, hasNewer: false })).toBeNull();
  });
  it("never loads without a scroll gesture, while busy, or past the ends", () => {
    expect(historyAutoload(node(0), null, page)).toBeNull();
    expect(historyAutoload(node(0), "up", { ...page, busy: true })).toBeNull();
    expect(historyAutoload(node(0), "up", { ...page, hasMore: false })).toBeNull();
  });
});
