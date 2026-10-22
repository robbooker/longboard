import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CHAT_JUMP_HIGHLIGHT_MS, flashChatMessage } from "../chatJumpHighlight";
const element = () => {
  const attrs = new Map<string, string>();
  return {
    offsetWidth: 100,
    getAttribute: (key: string) => attrs.get(key) ?? null,
    setAttribute: (key: string, value: string) => attrs.set(key, value),
    removeAttribute: (key: string) => attrs.delete(key),
  };
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("marks the message, then removes the mark once the fade has run", () => {
  const row = element();
  flashChatMessage(row as unknown as HTMLElement);
  expect(row.getAttribute("data-jump-highlight")).toBe("true");
  vi.advanceTimersByTime(CHAT_JUMP_HIGHLIGHT_MS - 1);
  expect(row.getAttribute("data-jump-highlight")).toBe("true");
  vi.advanceTimersByTime(1);
  expect(row.getAttribute("data-jump-highlight")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it("clears early, and an old timer never clears a newer jump to the same row", () => {
  const row = element();
  const first = flashChatMessage(row as unknown as HTMLElement);
  vi.advanceTimersByTime(2000);
  first();
  expect(row.getAttribute("data-jump-highlight")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  flashChatMessage(row as unknown as HTMLElement);
  vi.advanceTimersByTime(CHAT_JUMP_HIGHLIGHT_MS - 100);
  first();
  expect(row.getAttribute("data-jump-highlight")).toBe("true");
  vi.advanceTimersByTime(100);
  expect(row.getAttribute("data-jump-highlight")).toBeNull();
});
