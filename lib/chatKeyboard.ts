import type { KeyboardEvent } from "react";

/** Phones and tablets without a pointer: Return adds a line and the Send button sends. */
export const touchKeyboard = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse) and (hover: none)").matches;

// Tallest visible height seen at each window width, so an on-screen keyboard shows up as a
// shrink even where the browser also shrinks the layout (Android).
const tallest = new Map<number, number>();
function measure() {
  const view = window.visualViewport;
  if (!view || view.scale !== 1) return;
  const height = Math.max(view.height, tallest.get(window.innerWidth) ?? 0);
  tallest.set(window.innerWidth, height);
}
if (typeof window !== "undefined" && window.visualViewport) {
  measure();
  window.visualViewport.addEventListener("resize", measure);
}

/** An on-screen keyboard takes far more than the shortcut bar shown with a hardware keyboard. */
export function onScreenKeyboard(visible: number, full: number) {
  return full - visible > 150;
}

/**
 * Return adds a line only while an on-screen keyboard is up. A touch device with a hardware
 * keyboard (an iPad with a Magic Keyboard) or a trackpad sends with Enter like a desktop.
 */
export function enterAddsLine() {
  if (!touchKeyboard() || window.matchMedia?.("(any-pointer: fine)").matches) return false;
  const view = window.visualViewport;
  if (!view || view.scale !== 1) return true;
  measure();
  return onScreenKeyboard(view.height, Math.max(window.innerHeight, tallest.get(window.innerWidth) ?? 0));
}

/** Enter sends on desktop; Shift+Enter, input-method composition and touch keyboards keep editing. */
export function handleChatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    enterAddsLine()
  )
    return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.form?.requestSubmit();
}
