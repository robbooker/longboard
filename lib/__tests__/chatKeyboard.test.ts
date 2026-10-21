import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { handleChatKeyDown, onScreenKeyboard } from "../chatKeyboard";

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
  afterEach(() => vi.unstubAllGlobals());
  it("lets Return add a new line on touch keyboards", () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === "(pointer: coarse) and (hover: none)" }));
    vi.stubGlobal("window", { matchMedia });
    const event = press();
    expect(event.requestSubmit).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(press().requestSubmit).toHaveBeenCalledOnce();
  });
  it("sends with Enter on a touch device using a hardware keyboard or trackpad (iPad)", () => {
    const touch = (fine: boolean) => vi.fn((query: string) => ({ matches: query === "(pointer: coarse) and (hover: none)" || (fine && query === "(any-pointer: fine)") }));
    // Hardware keyboard: only the shortcut bar covers the page.
    vi.stubGlobal("window", { matchMedia: touch(false), innerWidth: 1024, innerHeight: 1300, visualViewport: { height: 1245, scale: 1 } });
    expect(press().requestSubmit).toHaveBeenCalledOnce();
    // On-screen keyboard up: Return adds a line.
    vi.stubGlobal("window", { matchMedia: touch(false), innerWidth: 1024, innerHeight: 1300, visualViewport: { height: 900, scale: 1 } });
    expect(press().requestSubmit).not.toHaveBeenCalled();
    // A trackpad is attached: Enter sends even if the viewport looks short.
    vi.stubGlobal("window", { matchMedia: touch(true), innerWidth: 1024, innerHeight: 1300, visualViewport: { height: 900, scale: 1 } });
    expect(press().requestSubmit).toHaveBeenCalledOnce();
  });
  it("tells an on-screen keyboard from the hardware-keyboard shortcut bar", () => {
    expect(onScreenKeyboard(1245, 1300)).toBe(false);
    expect(onScreenKeyboard(500, 800)).toBe(true);
  });
});
