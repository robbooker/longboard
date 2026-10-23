/** How long a message reached from search (or a deep link) stays marked; CSS fades it out. */
export const CHAT_JUMP_HIGHLIGHT_MS = 2600;
export const CHAT_JUMP_HIGHLIGHT_ATTRIBUTE = "data-jump-highlight";

/**
 * Briefly marks the message a reader jumped to. The style (PublicChat.module.css) fades the mark
 * out; the attribute is removed afterwards so the next jump to the same row starts it again.
 * Returns a cleanup that removes the mark early (a newer jump, the pane closing).
 */
export function flashChatMessage(target: HTMLElement, ms = CHAT_JUMP_HIGHLIGHT_MS) {
  // Removing then re-adding restarts the CSS animation when the same row is reached again.
  target.removeAttribute(CHAT_JUMP_HIGHLIGHT_ATTRIBUTE);
  void target.offsetWidth;
  target.setAttribute(CHAT_JUMP_HIGHLIGHT_ATTRIBUTE, "true");
  let done = false;
  const clear = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    target.removeAttribute(CHAT_JUMP_HIGHLIGHT_ATTRIBUTE);
  };
  const timer = setTimeout(clear, ms);
  return clear;
}
