export type PinnedMessageJump = { messageId: string; request: number; trigger: HTMLElement };

/** Instant pane-local reveal: no smooth motion, global selectors or new read state. */
export function revealPinnedMessage(container: HTMLElement, target: HTMLElement, trigger: HTMLElement) {
  if (document.hidden || document.querySelector('dialog[open],[aria-modal="true"]')) return () => {};
  container.scrollTop +=
    target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop;
  const tabIndex = target.getAttribute("tabindex");
  target.setAttribute("data-pin-highlight", "true");
  target.setAttribute("tabindex", "-1");
  // A delayed response must never pull focus out of a composer, edit or another pane.
  if (
    document.hasFocus() &&
    document.activeElement === trigger &&
    !document.querySelector('dialog[open],[aria-modal="true"]')
  )
    target.focus({ preventScroll: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer) clearTimeout(timer);
    target.removeAttribute("data-pin-highlight");
    if (tabIndex === null) target.removeAttribute("tabindex");
    else target.setAttribute("tabindex", tabIndex);
  };
  timer = setTimeout(clear, 3000);
  return clear;
}

/** Deliberate interaction anywhere supersedes a pending pane jump. Register after
 * the pin's click, so the activation that starts it cannot cancel itself. */
export function watchPinnedMessageIntent(cancel: () => void) {
  const events = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
  const unavailable = () => {
    if (document.hidden || document.querySelector('dialog[open],[aria-modal="true"]')) cancel();
  };
  events.forEach((event) => document.addEventListener(event, cancel, true));
  document.addEventListener("visibilitychange", unavailable);
  window.addEventListener("blur", cancel);
  const observer = new MutationObserver(unavailable);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open", "aria-modal"],
  });
  return () => {
    events.forEach((event) => document.removeEventListener(event, cancel, true));
    document.removeEventListener("visibilitychange", unavailable);
    window.removeEventListener("blur", cancel);
    observer.disconnect();
  };
}
