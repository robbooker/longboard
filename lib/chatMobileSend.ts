/** Keep a successful send ready for the next message without overriding later interaction. */
export function beginMobileSend(composer: HTMLTextAreaElement | null, pane: HTMLElement | null, isCurrent = () => true) {
 const noop = { confirmed: () => {}, cancel: () => {} };
 if (!composer || !pane) return noop;
 const mobile = window.matchMedia('(max-width:1099px)').matches;
 const active = document.activeElement;
 // Background retries do not acquire focus from another control.
 const ownsFocus = active === composer || (active instanceof HTMLButtonElement && active.type === 'submit' && active.form === composer.form && !!composer.form);
 let cancelled = false, finished = false, frame = 0, focusFrame = 0;
 let timer: ReturnType<typeof setTimeout> | undefined;
 const visible = (node: HTMLElement) => node.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
 const valid = () => !cancelled && isCurrent() && !document.hidden && visible(composer) && visible(pane);
 const reveal = () => {
  if (!mobile) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { if (valid() && !composer.value) pane.scrollTop = pane.scrollHeight; });
 };
 const cleanup = () => {
  cancelAnimationFrame(focusFrame);
  composer.removeEventListener('input', cancel);
  document.removeEventListener('pointerdown', cancel, true);
  document.removeEventListener('keydown', cancel, true);
  document.removeEventListener('focusin', focusChanged, true);
  pane.removeEventListener('wheel', cancel);
  pane.removeEventListener('touchmove', cancel);
  window.visualViewport?.removeEventListener('resize', reveal);
  window.removeEventListener('resize', reveal);
  if (timer) clearTimeout(timer);
 };
 const cancel = () => { cancelled = true; cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); cleanup(); };
 const focusChanged = (event: FocusEvent) => { if (event.target !== composer) cancel(); };
 // Preserve the user-gesture focus on mobile before awaiting the network.
 if (ownsFocus && valid() && !composer.disabled) composer.focus({ preventScroll: true });
 composer.addEventListener('input', cancel);
 document.addEventListener('pointerdown', cancel, true);
 document.addEventListener('keydown', cancel, true);
 document.addEventListener('focusin', focusChanged, true);
 pane.addEventListener('wheel', cancel, { passive: true });
 pane.addEventListener('touchmove', cancel, { passive: true });
 timer = setTimeout(cancel, 45000);
 reveal();
 return { cancel, confirmed: () => {
  if (finished) return;
  finished = true;
  if (!valid()) { cancel(); return; }
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
   window.visualViewport?.addEventListener('resize', reveal);
   window.addEventListener('resize', reveal);
  }
  timer = setTimeout(cleanup, 1000);
 } };
}
/** Visual viewport follows the keyboard; dvh alone does not on several mobile browsers. */
export function watchChatViewport(node:HTMLElement){
 const media=window.matchMedia('(max-width:1099px)');
 const update=()=>{const viewport=window.visualViewport;if(media.matches&&viewport&&viewport.scale===1){node.style.setProperty('--chat-visual-height',`${viewport.height}px`);}else node.style.removeProperty('--chat-visual-height');};
 update();window.visualViewport?.addEventListener('resize',update);window.addEventListener('resize',update);
 return()=>{window.visualViewport?.removeEventListener('resize',update);window.removeEventListener('resize',update);node.style.removeProperty('--chat-visual-height');};
}
