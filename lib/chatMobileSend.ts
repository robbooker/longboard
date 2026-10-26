/** Keep a successful send ready for the next message without overriding later interaction. */
export function beginMobileSend(
  composer: HTMLTextAreaElement | null,
  pane: HTMLElement | null,
  isCurrent = () => true,
) {
  const noop = { confirmed: () => {}, cancel: () => {} };
  if (!composer || !pane) return noop;
  const mobile = window.matchMedia("(max-width:1099px)").matches;
  const active = document.activeElement;
  // Background retries do not acquire focus from another control.
  const ownsFocus =
    active === composer ||
    (active instanceof HTMLButtonElement &&
      active.type === "submit" &&
      active.form === composer.form &&
      !!composer.form);
  let cancelled = false,
    finished = false,
    frame = 0,
    focusFrame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const visible = (node: HTMLElement) =>
    node.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  const valid = () => !cancelled && isCurrent() && !document.hidden && visible(composer) && visible(pane);
  const reveal = () => {
    if (!mobile) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (valid() && !composer.value) pane.scrollTop = pane.scrollHeight;
    });
  };
  const cleanup = () => {
    cancelAnimationFrame(focusFrame);
    composer.removeEventListener("input", cancel);
    document.removeEventListener("pointerdown", cancel, true);
    document.removeEventListener("keydown", cancel, true);
    document.removeEventListener("focusin", focusChanged, true);
    pane.removeEventListener("wheel", cancel);
    pane.removeEventListener("touchmove", cancel);
    window.visualViewport?.removeEventListener("resize", reveal);
    window.removeEventListener("resize", reveal);
    if (timer) clearTimeout(timer);
  };
  const cancel = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(focusFrame);
    cleanup();
  };
  const focusChanged = (event: FocusEvent) => {
    if (event.target !== composer) cancel();
  };
  // Preserve the user-gesture focus on mobile before awaiting the network.
  if (ownsFocus && valid() && !composer.disabled) composer.focus({ preventScroll: true });
  composer.addEventListener("input", cancel);
  document.addEventListener("pointerdown", cancel, true);
  document.addEventListener("keydown", cancel, true);
  document.addEventListener("focusin", focusChanged, true);
  pane.addEventListener("wheel", cancel, { passive: true });
  pane.addEventListener("touchmove", cancel, { passive: true });
  timer = setTimeout(cancel, 45000);
  reveal();
  return {
    cancel,
    confirmed: () => {
      if (finished) return;
      finished = true;
      if (!valid()) {
        cancel();
        return;
      }
      if (timer) clearTimeout(timer);
      // React must first commit the cleared draft and unlock the room composer.
      focusFrame = requestAnimationFrame(() => {
        if (ownsFocus && valid() && !composer.disabled && !composer.readOnly) {
          composer.focus({ preventScroll: true });
          composer.setSelectionRange(composer.value.length, composer.value.length);
        }
      });
      reveal();
      if (mobile) {
        window.visualViewport?.addEventListener("resize", reveal);
        window.addEventListener("resize", reveal);
      }
      timer = setTimeout(cleanup, 1000);
    },
  };
}
/** Text fields that raise an on-screen keyboard. */
const editing = (node: Element | null) =>
  node instanceof HTMLTextAreaElement ||
  (node instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit", "file", "color"].includes(node.type)) ||
  (node instanceof HTMLElement && node.isContentEditable);

/**
 * Visual viewport follows the keyboard; dvh alone does not on several mobile browsers.
 * The shrunken height applies only while a text field has focus: with no field focused there
 * is no keyboard, so a resize the browser never reported (iPad) cannot leave the chat short.
 *
 * iPhone Safari (D-313) does not shrink the page for the keyboard: it keeps the full-height
 * layout and slides the visible part down (visualViewport.pageTop) to bring the field into
 * view. A page shortened to the visible height then sits above what is shown, so the composer
 * landed at the top of the screen over a blank gap. While typing, the page is moved down to
 * start where the visible part starts; the move is 0 wherever the browser shrinks the page.
 */
export function watchChatViewport(node: HTMLElement) {
  const media = window.matchMedia("(max-width:1099px)");
  const timers: ReturnType<typeof setTimeout>[] = [];
  let shift = 0;
  const update = () => {
    const viewport = window.visualViewport;
    // Unchanged values are not written again: a write restyles the whole chat.
    const typing = media.matches && viewport && viewport.scale === 1 && editing(document.activeElement);
    if (typing) {
      const height = `${viewport.height}px`;
      if (node.style.getPropertyValue("--chat-visual-height") !== height)
        node.style.setProperty("--chat-visual-height", height);
    } else if (node.style.getPropertyValue("--chat-visual-height"))
      node.style.removeProperty("--chat-visual-height");
    // Quad panes share one page with a toolbar above them, so they are never moved.
    let next = 0;
    if (typing && node.dataset.pane !== "true" && node.contains(document.activeElement)) {
      const rect = node.getBoundingClientRect();
      // Where the page starts in the document without the current move.
      const start = rect.top + window.scrollY - shift;
      next = Math.max(0, Math.round(viewport.pageTop - start));
    }
    if (next !== shift) {
      shift = next;
      if (shift) node.style.setProperty("transform", `translateY(${shift}px)`);
      else node.style.removeProperty("transform");
    }
  };
  // Focus moves before the keyboard finishes opening or closing; measure again once it settles.
  const settle = () => {
    update();
    for (const wait of [0, 350, 800]) timers.push(setTimeout(update, wait));
    if (timers.length > 12) timers.splice(0, timers.length - 12).forEach(clearTimeout);
  };
  update();
  window.visualViewport?.addEventListener("resize", update);
  // Safari slides the visible part without resizing it while the keyboard opens.
  window.visualViewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  document.addEventListener("focusin", settle);
  document.addEventListener("focusout", settle);
  return () => {
    window.visualViewport?.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    document.removeEventListener("focusin", settle);
    document.removeEventListener("focusout", settle);
    timers.forEach(clearTimeout);
    if (shift) node.style.removeProperty("transform");
    // The height stays: a chat hidden and shown again (SHELL-KEEP) measures again when shown.
  };
}
