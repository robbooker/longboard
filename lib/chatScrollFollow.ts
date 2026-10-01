/** Scroll-follow is a property of a visible pane, never of keyboard focus. */
export function chatPaneVisible(node: HTMLElement): boolean {
 if (document.hidden || !node.isConnected || !node.clientHeight || !node.clientWidth || !node.getClientRects().length) return false;
 const rect = node.getBoundingClientRect();
 return getComputedStyle(node).visibility !== 'hidden' && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

export function chatPaneAtBottom(node: HTMLElement): boolean {
 return node.scrollHeight - node.scrollTop - node.clientHeight <= 2;
}

/** Observe late media/layout changes and visibility returns without acquiring focus. */
export function watchChatPaneLayout(node: HTMLElement, update: () => void): () => void {
 const visibleUpdate = () => { if (chatPaneVisible(node)) update(); };
 visibleUpdate();
 const resize = new ResizeObserver(visibleUpdate);
 resize.observe(node);
 for (const child of Array.from(node.children)) resize.observe(child);
 const intersection = new IntersectionObserver(visibleUpdate);
 intersection.observe(node);
 document.addEventListener('visibilitychange', visibleUpdate);
 return () => {
  resize.disconnect();
  intersection.disconnect();
  document.removeEventListener('visibilitychange', visibleUpdate);
 };
}

/** Late scroll events and forward browser anchoring preserve following; explicit user gestures cancel it first. */
export function chatPaneFollowingScroll(node: HTMLElement, following: boolean, lastAutomaticTop: number | null): boolean {
 return (following && lastAutomaticTop !== null && node.scrollTop >= lastAutomaticTop) || chatPaneAtBottom(node);
}
