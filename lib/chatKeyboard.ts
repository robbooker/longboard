import type { KeyboardEvent } from "react";

/** Enter sends; Shift+Enter and input-method composition keep editing. */
export function handleChatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.form?.requestSubmit();
}
