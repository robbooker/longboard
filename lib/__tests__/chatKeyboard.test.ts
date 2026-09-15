import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { handleChatKeyDown } from "../chatKeyboard";

function press(overrides = {}) {
  const requestSubmit = vi.fn();
  const preventDefault = vi.fn();
  handleChatKeyDown({ key: "Enter", shiftKey: false, repeat: false, nativeEvent: {}, currentTarget: { form: { requestSubmit } }, preventDefault, ...overrides } as unknown as KeyboardEvent<HTMLTextAreaElement>);
  return { requestSubmit, preventDefault };
}
describe("chat keyboard", () => {
  it("sends with Enter and prevents a newline", () => {
    const event = press();
    expect(event.requestSubmit).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it("preserves Shift+Enter and normal typing", () => {
    for (const keys of [{ shiftKey: true }, { key: "a" }]) {
      const event = press(keys);
      expect(event.requestSubmit).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
  it("does not send while composing text or repeating a held key", () => {
    for (const keys of [{ nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }, { repeat: true }]) expect(press(keys).requestSubmit).not.toHaveBeenCalled();
  });
});
