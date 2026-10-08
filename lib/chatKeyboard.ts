import type { KeyboardEvent } from "react";

/** Phones and tablets without a pointer: Return adds a line and the Send button sends. */
export const touchKeyboard = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse) and (hover: none)").matches;

/** Enter sends on desktop; Shift+Enter, input-method composition and touch keyboards keep editing. */
export function handleChatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    touchKeyboard()
  )
    return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.form?.requestSubmit();
}
